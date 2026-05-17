"""M27 — Signals & Activities endpoints.

  GET    /accounts/:id/signals                List non-hidden signals
  POST   /accounts/:id/signals                Add a signal
  PATCH  /signals/:id                         Update metadata / hidden
  POST   /signals/:id/resolve                 Mark resolved (note required)
  POST   /signals/:id/reopen                  Flip back to active (admin-only)
  DELETE /signals/:id                         Hard delete (admin-only)

  GET    /accounts/:id/activities             List non-hidden activities
  POST   /accounts/:id/activities             Log activity
  PATCH  /activities/:id                      Update fields
  DELETE /activities/:id                      Soft delete (sets hidden=true)
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Path, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser
from app.core.rbac import (
    can_view_account,
    can_write_cs_onboarding,
    is_global_admin,
)
from app.db.session import get_db
from app.models.signal import AccountActivity, SoftSignal
from app.routes.accounts import _team_member_ids
from app.schemas.signal import (
    ActivityCreate,
    ActivityListResponse,
    ActivityOut,
    ActivityUpdate,
    SoftSignalCreate,
    SoftSignalListResponse,
    SoftSignalOut,
    SoftSignalResolve,
    SoftSignalUpdate,
)

account_router = APIRouter(prefix="/api/v1/accounts", tags=["signals"])
signal_router = APIRouter(prefix="/api/v1/signals", tags=["signals"])
activity_router = APIRouter(prefix="/api/v1/activities", tags=["activities"])


async def _scope(
    db: AsyncSession, user, account_id: UUID
) -> tuple[bool, bool]:
    from app.core.scope import get_account_row

    acc = await get_account_row(db, account_id)
    is_assigned = (acc.csm_user_id == user.id) or (acc.co_user_id == user.id)
    team_ids = (
        await _team_member_ids(db, user) if user.role == "cs_team_manager" else set()
    )
    is_team = acc.csm_user_id in team_ids if team_ids else False
    if not can_view_account(user.role, is_assigned=is_assigned, is_team=is_team):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Forbidden on this account")
    return is_assigned, is_team


# ============================================================
# Signals
# ============================================================


@account_router.get("/{account_id}/signals", response_model=SoftSignalListResponse)
async def list_signals(
    account_id: Annotated[UUID, Path()],
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SoftSignalListResponse:
    is_assigned, is_team = await _scope(db, user, account_id)
    editable = can_write_cs_onboarding(
        user.role, is_assigned=is_assigned, is_team=is_team
    )
    rows = (
        await db.execute(
            select(SoftSignal)
            .where(SoftSignal.account_id == account_id)
            .where(SoftSignal.hidden.is_(False))
            .order_by(SoftSignal.created_at.desc())
        )
    ).scalars().all()
    items = [SoftSignalOut.model_validate(r) for r in rows]
    return SoftSignalListResponse(items=items, total=len(items), is_editable=editable)


@account_router.post(
    "/{account_id}/signals",
    response_model=SoftSignalOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_signal(
    account_id: Annotated[UUID, Path()],
    body: SoftSignalCreate,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SoftSignalOut:
    is_assigned, is_team = await _scope(db, user, account_id)
    if not can_write_cs_onboarding(
        user.role, is_assigned=is_assigned, is_team=is_team
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Cannot add signals on this account")

    sig = SoftSignal(
        account_id=account_id,
        type=body.type,
        category=body.category,
        signal=body.signal,
        description=body.description,
        impact=body.impact,
        valid_until=body.valid_until,
        source=body.source,
        added_by=user.id,
    )
    db.add(sig)
    await db.commit()
    await db.refresh(sig)
    return SoftSignalOut.model_validate(sig)


async def _scope_for_signal(
    db: AsyncSession, user, signal_id: UUID
) -> tuple[SoftSignal, bool, bool]:
    sig = (
        await db.execute(select(SoftSignal).where(SoftSignal.id == signal_id))
    ).scalar_one_or_none()
    if sig is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Signal not found")
    is_assigned, is_team = await _scope(db, user, sig.account_id)
    return sig, is_assigned, is_team


@signal_router.patch("/{signal_id}", response_model=SoftSignalOut)
async def patch_signal(
    signal_id: Annotated[UUID, Path()],
    body: SoftSignalUpdate,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SoftSignalOut:
    sig, is_assigned, is_team = await _scope_for_signal(db, user, signal_id)
    if not can_write_cs_onboarding(
        user.role, is_assigned=is_assigned, is_team=is_team
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Cannot edit this signal")

    payload = body.model_dump(exclude_unset=True, mode="json")
    for k, v in payload.items():
        setattr(sig, k, v)
    sig.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(sig)
    return SoftSignalOut.model_validate(sig)


@signal_router.post("/{signal_id}/resolve", response_model=SoftSignalOut)
async def resolve_signal(
    signal_id: Annotated[UUID, Path()],
    body: SoftSignalResolve,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SoftSignalOut:
    sig, is_assigned, is_team = await _scope_for_signal(db, user, signal_id)
    if not can_write_cs_onboarding(
        user.role, is_assigned=is_assigned, is_team=is_team
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Cannot resolve this signal")
    if sig.status == "resolved":
        raise HTTPException(status.HTTP_409_CONFLICT, "Signal already resolved")
    now = datetime.now(timezone.utc)
    sig.status = "resolved"
    sig.resolved_at = now
    sig.resolved_by = user.id
    sig.resolved_note = body.resolved_note.strip()
    sig.updated_at = now
    await db.commit()
    await db.refresh(sig)
    return SoftSignalOut.model_validate(sig)


@signal_router.post("/{signal_id}/reopen", response_model=SoftSignalOut)
async def reopen_signal(
    signal_id: Annotated[UUID, Path()],
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SoftSignalOut:
    # Admin-only — reversing a resolution should land under a director-grade
    # user (mirrors M13/M19/M22/M23 unlock asymmetry).
    if not is_global_admin(user.role):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Only admins can re-open a resolved signal"
        )
    sig, _, _ = await _scope_for_signal(db, user, signal_id)
    if sig.status == "active":
        return SoftSignalOut.model_validate(sig)
    sig.status = "active"
    sig.resolved_at = None
    sig.resolved_by = None
    sig.resolved_note = None
    sig.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(sig)
    return SoftSignalOut.model_validate(sig)


@signal_router.delete("/{signal_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_signal(
    signal_id: Annotated[UUID, Path()],
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    # Hard delete — admin-only. Most users should set hidden=true via PATCH.
    if not is_global_admin(user.role):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only admins can hard-delete a signal")
    sig, _, _ = await _scope_for_signal(db, user, signal_id)
    await db.delete(sig)
    await db.commit()


# ============================================================
# Activities
# ============================================================


@account_router.get("/{account_id}/activities", response_model=ActivityListResponse)
async def list_activities(
    account_id: Annotated[UUID, Path()],
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ActivityListResponse:
    is_assigned, is_team = await _scope(db, user, account_id)
    editable = can_write_cs_onboarding(
        user.role, is_assigned=is_assigned, is_team=is_team
    )
    rows = (
        await db.execute(
            select(AccountActivity)
            .where(AccountActivity.account_id == account_id)
            .where(AccountActivity.hidden.is_(False))
            .order_by(AccountActivity.created_at.desc())
        )
    ).scalars().all()
    items = [ActivityOut.model_validate(r) for r in rows]
    return ActivityListResponse(items=items, total=len(items), is_editable=editable)


@account_router.post(
    "/{account_id}/activities",
    response_model=ActivityOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_activity(
    account_id: Annotated[UUID, Path()],
    body: ActivityCreate,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ActivityOut:
    is_assigned, is_team = await _scope(db, user, account_id)
    if not can_write_cs_onboarding(
        user.role, is_assigned=is_assigned, is_team=is_team
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Cannot log activity on this account")

    act = AccountActivity(
        account_id=account_id,
        type=body.type,
        title=body.title,
        summary=body.summary,
        items=body.items,
        attendees=body.attendees,
        linked_metrics=body.linked_metrics,
        file_name=body.file_name,
        added_by=user.id,
    )
    db.add(act)
    await db.commit()
    await db.refresh(act)
    return ActivityOut.model_validate(act)


async def _scope_for_activity(
    db: AsyncSession, user, activity_id: UUID
) -> tuple[AccountActivity, bool, bool]:
    act = (
        await db.execute(select(AccountActivity).where(AccountActivity.id == activity_id))
    ).scalar_one_or_none()
    if act is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Activity not found")
    is_assigned, is_team = await _scope(db, user, act.account_id)
    return act, is_assigned, is_team


@activity_router.patch("/{activity_id}", response_model=ActivityOut)
async def patch_activity(
    activity_id: Annotated[UUID, Path()],
    body: ActivityUpdate,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ActivityOut:
    act, is_assigned, is_team = await _scope_for_activity(db, user, activity_id)
    if not can_write_cs_onboarding(
        user.role, is_assigned=is_assigned, is_team=is_team
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Cannot edit this activity")

    payload = body.model_dump(exclude_unset=True, mode="json")
    for k, v in payload.items():
        setattr(act, k, v)
    act.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(act)
    return ActivityOut.model_validate(act)


@activity_router.delete("/{activity_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_activity(
    activity_id: Annotated[UUID, Path()],
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    act, is_assigned, is_team = await _scope_for_activity(db, user, activity_id)
    if not can_write_cs_onboarding(
        user.role, is_assigned=is_assigned, is_team=is_team
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Cannot delete this activity")
    act.hidden = True
    act.updated_at = datetime.now(timezone.utc)
    await db.commit()
