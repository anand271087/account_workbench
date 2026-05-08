"""Admin user management — list, invite, update, deactivate.

Per Roles_Access_Matrix_Reviewed_05072026.xlsx ("Admin - User Management" =
F for admin only) — every endpoint here requires `role == 'admin'`.

Phase-1 auth uses Supabase email-invite (link expires 30 min). Phase-2 plans
to swap to Beroe SSO; the same `public.users` row + admin-managed role still
applies — only the authentication mechanism changes. See `docs/architecture/
auth-and-rbac.md` § Phase 2.

Self-edit guards:
- An admin cannot demote themselves (would lock the workspace out of admin
  access immediately on the next /me roundtrip).
- An admin cannot deactivate themselves.
- Cache invalidation: `invalidate_user_cache(user.id)` after every PATCH
  so the 60s identity-cache TTL doesn't paper over a role change.
"""

from datetime import datetime, timezone
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.deps import CurrentUser, invalidate_user_cache
from app.core.rbac import ALL_ROLES, require_admin
from app.db.session import get_db
from app.models.user import User
from app.schemas.user import UserInvite, UserOut, UserUpdate

router = APIRouter(prefix="/api/v1/users", tags=["users"])


@router.get(
    "",
    response_model=list[UserOut],
    dependencies=[Depends(require_admin())],
)
async def list_users(
    db: Annotated[AsyncSession, Depends(get_db)],
    role: str | None = Query(None, description="Filter by role_key"),
    include_deactivated: bool = Query(False),
) -> list[UserOut]:
    stmt = select(User).order_by(User.full_name.asc())
    if not include_deactivated:
        stmt = stmt.where(User.deleted_at.is_(None))
    if role:
        if role not in ALL_ROLES:
            return []
        stmt = stmt.where(User.role == role)
    rows = (await db.execute(stmt)).scalars().all()
    return [UserOut.model_validate(u) for u in rows]


# ============================================================
# POST /users — admin invites a teammate
# ============================================================


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def invite_user(
    body: UserInvite,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_admin())],
) -> UserOut:
    """Invite a new user.

    - Sends a Supabase email invite (link expires 30 min) via the Admin API
      using the service-role key. The user clicks the link and sets a
      password (Phase 1) or signs in via Beroe SSO (Phase 2).
    - Creates the public.users row with role + team + status='pending'.
    - Idempotent on email: re-invite resends the email and updates the row.
    """
    settings = get_settings()
    email_lower = body.email.lower()

    # Lazy-import the Supabase client so tests + dev without a real key still boot.
    from supabase import create_client  # type: ignore

    supabase = create_client(
        settings.supabase_url, settings.supabase_service_role_key.get_secret_value()
    )

    # 1) Trigger Supabase Auth invite. Captures the auth user_id.
    try:
        invite_resp = supabase.auth.admin.invite_user_by_email(
            email_lower,
            {"data": {"full_name": body.full_name, "role": body.role}},
        )
        auth_user = invite_resp.user
        if auth_user is None:
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Supabase invite returned no user")
        new_id = UUID(str(auth_user.id))
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001 — defensive boundary
        # If the email already exists in Supabase Auth, surface a 409 + reuse path.
        msg = str(exc)
        if "User already registered" in msg or "already exists" in msg:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "A user with this email already exists. Edit them from the list instead.",
            ) from exc
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Supabase invite failed: {msg}") from exc

    # 2) Mirror into public.users.
    existing = (
        await db.execute(select(User).where(User.email == email_lower))
    ).scalar_one_or_none()
    now = datetime.now(timezone.utc)
    if existing is not None:
        # Re-invite path: reset to pending, refresh metadata.
        existing.deleted_at = None
        existing.full_name = body.full_name
        existing.role = body.role
        existing.team_id = body.team_id
        existing.status = "pending"
        existing.invited_at = now
        existing.invited_by = user.id
        await db.commit()
        await db.refresh(existing)
        invalidate_user_cache(existing.id)
        return UserOut.model_validate(existing)

    new_user = User(
        id=new_id,
        email=email_lower,
        full_name=body.full_name,
        role=body.role,
        team_id=body.team_id,
        status="pending",
        invited_at=now,
        invited_by=user.id,
    )
    db.add(new_user)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, f"User already exists: {exc}") from exc
    await db.refresh(new_user)
    return UserOut.model_validate(new_user)


# ============================================================
# PATCH /users/:id — admin edits role/team/full_name
# ============================================================


@router.patch("/{user_id}", response_model=UserOut)
async def update_user(
    user_id: Annotated[UUID, Path()],
    body: UserUpdate,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_admin())],
) -> UserOut:
    target = (
        await db.execute(select(User).where(User.id == user_id))
    ).scalar_one_or_none()
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")

    payload = body.model_dump(exclude_unset=True)

    # Self-demotion guard — caller cannot drop themselves out of admin.
    if target.id == user.id and payload.get("role") not in (None, "admin"):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "You cannot demote yourself from admin. Have another admin do it.",
        )

    for field, value in payload.items():
        setattr(target, field, value)
    target.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(target)
    invalidate_user_cache(target.id)
    return UserOut.model_validate(target)


# ============================================================
# DELETE /users/:id — admin deactivates (soft delete)
# ============================================================


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def deactivate_user(
    user_id: Annotated[UUID, Path()],
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_admin())],
) -> None:
    if user_id == user.id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "You cannot deactivate yourself. Have another admin do it.",
        )
    target = (
        await db.execute(select(User).where(User.id == user_id))
    ).scalar_one_or_none()
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    target.deleted_at = datetime.now(timezone.utc)
    target.status = "deactivated"
    await db.commit()
    invalidate_user_cache(target.id)


# ============================================================
# POST /users/:id/resend-invite — admin re-triggers email
# ============================================================


@router.post("/{user_id}/resend-invite", response_model=UserOut)
async def resend_invite(
    user_id: Annotated[UUID, Path()],
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_admin())],
) -> UserOut:
    target = (
        await db.execute(select(User).where(User.id == user_id, User.deleted_at.is_(None)))
    ).scalar_one_or_none()
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    if target.status == "active":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "User has already activated their account; no need to resend invite.",
        )

    settings = get_settings()
    from supabase import create_client  # type: ignore

    supabase = create_client(
        settings.supabase_url, settings.supabase_service_role_key.get_secret_value()
    )
    try:
        supabase.auth.admin.invite_user_by_email(target.email)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, f"Supabase invite failed: {exc}"
        ) from exc

    target.invited_at = datetime.now(timezone.utc)
    target.invited_by = user.id
    await db.commit()
    await db.refresh(target)
    return UserOut.model_validate(target)
