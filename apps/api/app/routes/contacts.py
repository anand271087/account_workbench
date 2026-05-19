"""AK03.b — Client Contacts CRUD + soft delete with 30-day restore.

Per Roles_Access_Matrix_Reviewed_05072026.xlsx:
- F (own/team/all) for CSM / CS Team Manager / CS Director / VP-CSM / Admin
- F (all) for Solutioning Manager
- F (own) for Inside Sales Manager
- View only for Commercial Owner / VP-Sales / VP-Solutioning / VP-Inside Sales

Soft delete: `deleted_at` is set; row stays for 30 days for admin restore.
After 30 days a future scheduled job hard-deletes (Sprint 5 admin tooling).
"""

from datetime import datetime, timedelta, timezone
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser
from app.core.rbac import can_view_account, can_write_contacts, is_global_admin
from app.db.session import get_db
from app.models.account import Account
from app.models.contact import ClientContact
from app.routes.accounts import _team_member_ids
from app.schemas.contact import (
    ContactCreate,
    ContactListResponse,
    ContactOut,
    ContactUpdate,
)

# Two routers because the contact CRUD lives off both account-scoped and id-scoped paths.
account_router = APIRouter(prefix="/api/v1/accounts", tags=["contacts"])
contact_router = APIRouter(prefix="/api/v1/contacts", tags=["contacts"])

RESTORE_WINDOW_DAYS = 30


# ---------- helpers ----------


async def _scope_for_account(
    db: AsyncSession, user, account_id: UUID
) -> tuple[Account, bool, bool]:
    from app.core.scope import get_account_row

    acc = await get_account_row(db, account_id)
    is_assigned = (acc.csm_user_id == user.id) or (acc.co_user_id == user.id)
    team_ids = await _team_member_ids(db, user) if user.role == "cs_team_manager" else set()
    is_team = acc.csm_user_id in team_ids if team_ids else False
    if not can_view_account(user.role, is_assigned=is_assigned, is_team=is_team):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Forbidden on this account")
    return acc, is_assigned, is_team


async def _scope_for_contact(
    db: AsyncSession, user, contact_id: UUID, *, allow_deleted: bool = False
) -> tuple[ClientContact, Account, bool, bool]:
    """Resolve a contact + its account + caller's scope. 404 if missing."""
    stmt = select(ClientContact).where(ClientContact.id == contact_id)
    if not allow_deleted:
        stmt = stmt.where(ClientContact.deleted_at.is_(None))
    contact = (await db.execute(stmt)).scalar_one_or_none()
    if contact is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Contact not found")
    acc, is_assigned, is_team = await _scope_for_account(db, user, contact.account_id)
    return contact, acc, is_assigned, is_team


# ============================================================
# GET /accounts/:id/contacts
# ============================================================


_SORTABLE_CONTACT_COLS = {
    "name": ClientContact.name,
    "title": ClientContact.title,
    "function": ClientContact.function,
    "seniority": ClientContact.seniority,
    "decision_power": ClientContact.decision_power,
    "email": ClientContact.email,
    "created_at": ClientContact.created_at,
}


@account_router.get("/{account_id}/contacts", response_model=ContactListResponse)
async def list_contacts(
    account_id: Annotated[UUID, Path()],
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    include_deleted: bool = Query(False, description="Admin only — show recently soft-deleted"),
    sort_by: str | None = Query(None, description="Column to sort by"),
    sort_dir: str = Query("asc", pattern="^(asc|desc)$"),
) -> ContactListResponse:
    _, is_assigned, is_team = await _scope_for_account(db, user, account_id)

    stmt = select(ClientContact).where(ClientContact.account_id == account_id)
    if sort_by and sort_by in _SORTABLE_CONTACT_COLS:
        col = _SORTABLE_CONTACT_COLS[sort_by]
        stmt = stmt.order_by(col.asc() if sort_dir == "asc" else col.desc())
    else:
        # Default: SPOC > sponsor > name (preserves M6 behaviour).
        stmt = stmt.order_by(
            ClientContact.is_spoc.desc(),
            ClientContact.is_sponsor.desc(),
            ClientContact.name.asc(),
        )
    if include_deleted:
        if not is_global_admin(user.role):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, "Only admins can view deleted contacts"
            )
        # Only show deletions within the restore window
        cutoff = datetime.now(timezone.utc) - timedelta(days=RESTORE_WINDOW_DAYS)
        stmt = stmt.where(
            (ClientContact.deleted_at.is_(None)) | (ClientContact.deleted_at >= cutoff)
        )
    else:
        stmt = stmt.where(ClientContact.deleted_at.is_(None))

    rows = (await db.execute(stmt)).scalars().all()
    return ContactListResponse(
        items=[ContactOut.model_validate(c) for c in rows],
        total=len(rows),
        is_editable=can_write_contacts(user.role, is_assigned=is_assigned, is_team=is_team),
    )


# ============================================================
# POST /accounts/:id/contacts
# ============================================================


@account_router.post(
    "/{account_id}/contacts", response_model=ContactOut, status_code=status.HTTP_201_CREATED
)
async def create_contact(
    account_id: Annotated[UUID, Path()],
    body: ContactCreate,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ContactOut:
    _, is_assigned, is_team = await _scope_for_account(db, user, account_id)
    if not can_write_contacts(user.role, is_assigned=is_assigned, is_team=is_team):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Your role cannot edit contacts on this account",
        )

    # Bug 4 — preflight name dedup (email is covered by the DB unique index,
    # but the stakeholder bug specifies "same name OR email"). Name match is
    # case-insensitive over non-deleted rows.
    name_key = (body.name or "").strip().lower()
    if name_key:
        from sqlalchemy import func

        clash = (
            await db.execute(
                select(ClientContact)
                .where(ClientContact.account_id == account_id)
                .where(ClientContact.deleted_at.is_(None))
                .where(func.lower(func.trim(ClientContact.name)) == name_key)
            )
        ).scalar_one_or_none()
        if clash is not None:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f'A contact with this name already exists on this account: "{clash.name}".',
            )

    new_contact = ClientContact(
        account_id=account_id,
        name=body.name,
        title=body.title,
        email=body.email,
        phone=body.phone,
        function=body.function,
        seniority=body.seniority,
        decision_power=body.decision_power,
        notes=body.notes,
        is_spoc=body.is_spoc,
        is_sponsor=body.is_sponsor,
    )
    db.add(new_contact)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        msg = str(exc)
        if "ux_client_contacts_account_email" in msg:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "A contact with this email already exists on this account.",
            ) from exc
        if "ux_client_contacts_account_name" in msg:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "A contact with this name already exists on this account.",
            ) from exc
        raise
    await db.refresh(new_contact)
    return ContactOut.model_validate(new_contact)


# ============================================================
# PATCH /contacts/:id
# ============================================================


@contact_router.patch("/{contact_id}", response_model=ContactOut)
async def update_contact(
    contact_id: Annotated[UUID, Path()],
    body: ContactUpdate,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ContactOut:
    contact, _, is_assigned, is_team = await _scope_for_contact(db, user, contact_id)
    if not can_write_contacts(user.role, is_assigned=is_assigned, is_team=is_team):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Cannot edit this contact")

    payload = body.model_dump(exclude_unset=True)
    for field, value in payload.items():
        setattr(contact, field, value)
    contact.updated_at = datetime.utcnow()
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        msg = str(exc)
        if "ux_client_contacts_account_email" in msg:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "A contact with this email already exists on this account.",
            ) from exc
        if "ux_client_contacts_account_name" in msg:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "A contact with this name already exists on this account.",
            ) from exc
        raise
    await db.refresh(contact)
    return ContactOut.model_validate(contact)


# ============================================================
# DELETE /contacts/:id  (soft)
# ============================================================


@contact_router.delete("/{contact_id}", status_code=status.HTTP_204_NO_CONTENT)
async def soft_delete_contact(
    contact_id: Annotated[UUID, Path()],
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    contact, _, is_assigned, is_team = await _scope_for_contact(db, user, contact_id)
    if not can_write_contacts(user.role, is_assigned=is_assigned, is_team=is_team):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Cannot delete this contact")

    contact.deleted_at = datetime.now(timezone.utc)
    await db.commit()


# ============================================================
# POST /contacts/:id/restore  (admin only, within 30 days)
# ============================================================


@contact_router.post("/{contact_id}/restore", response_model=ContactOut)
async def restore_contact(
    contact_id: Annotated[UUID, Path()],
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ContactOut:
    if not is_global_admin(user.role):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only admins can restore contacts")

    contact, _, _, _ = await _scope_for_contact(db, user, contact_id, allow_deleted=True)
    if contact.deleted_at is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Contact is not deleted")

    age = datetime.now(timezone.utc) - contact.deleted_at
    if age > timedelta(days=RESTORE_WINDOW_DAYS):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Restore window ({RESTORE_WINDOW_DAYS} days) has expired",
        )

    contact.deleted_at = None
    contact.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(contact)
    return ContactOut.model_validate(contact)
