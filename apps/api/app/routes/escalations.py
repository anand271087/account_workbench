"""28-May — Escalations on accounts (prototype port).

  GET   /accounts/:id/escalations          List + capability flags + notify emails
  POST  /accounts/:id/escalations          Raise a new escalation
  POST  /escalations/:id/resolve           Mark resolved (admin/CS Director only)

Storage: jsonb array on accounts.escalations. Single-jsonb pattern same
as M22 VDD / M23 D&R red_flags so reads/writes follow the same deepcopy
+ flag_modified pattern.
"""

from __future__ import annotations

import copy
from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Path, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.core.deps import CurrentUser
from app.core.rbac import can_write_cs_onboarding, is_global_admin
from app.core.scope import get_account_row
from app.db.session import get_db
from app.models.account import Account
from app.models.user import User
from app.routes.accounts import _team_member_ids
from app.schemas.escalation import (
    EscalationCreate,
    EscalationListResponse,
    EscalationOut,
    EscalationResolve,
)

account_router = APIRouter(prefix="/api/v1/accounts", tags=["escalations"])
escalation_router = APIRouter(prefix="/api/v1/escalations", tags=["escalations"])


async def _scope_account(
    db: AsyncSession, user: User, account_id: UUID
) -> tuple[Account, bool, bool]:
    """Load + view-gate. Returns (account, is_assigned, is_team)."""
    acc = await get_account_row(db, account_id)
    is_assigned = (acc.csm_user_id == user.id) or (acc.co_user_id == user.id)
    team_ids = (
        await _team_member_ids(db, user) if user.role == "cs_team_manager" else set()
    )
    is_team = acc.csm_user_id in team_ids if team_ids else False
    return acc, is_assigned, is_team


async def _notify_emails(db: AsyncSession, acc: Account) -> list[str]:
    """CSM + Commercial Owner emails — used by the frontend mailto:."""
    emails: list[str] = []
    for uid in (acc.csm_user_id, acc.co_user_id):
        if not uid:
            continue
        row = (
            await db.execute(select(User.email).where(User.id == uid))
        ).scalar_one_or_none()
        if row:
            emails.append(row)
    return emails


# ─────────────────────────────────────────────────────────────────────
# GET /accounts/:id/escalations
# ─────────────────────────────────────────────────────────────────────


@account_router.get(
    "/{account_id}/escalations", response_model=EscalationListResponse
)
async def list_escalations(
    account_id: Annotated[UUID, Path()],
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> EscalationListResponse:
    acc, is_assigned, is_team = await _scope_account(db, user, account_id)
    items_raw = list(acc.escalations or [])
    items = [EscalationOut.model_validate(e) for e in items_raw]
    open_count = sum(
        1 for e in items if e.status in ("open", "in_progress")
    )
    return EscalationListResponse(
        items=items,
        total=len(items),
        open_count=open_count,
        is_editable=can_write_cs_onboarding(
            user.role, is_assigned=is_assigned, is_team=is_team
        ),
        can_resolve=is_global_admin(user.role),
        notify_emails=await _notify_emails(db, acc),
    )


# ─────────────────────────────────────────────────────────────────────
# POST /accounts/:id/escalations
# ─────────────────────────────────────────────────────────────────────


@account_router.post(
    "/{account_id}/escalations",
    response_model=EscalationOut,
    status_code=status.HTTP_201_CREATED,
)
async def raise_escalation(
    account_id: Annotated[UUID, Path()],
    body: EscalationCreate,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> EscalationOut:
    acc, is_assigned, is_team = await _scope_account(db, user, account_id)
    if not can_write_cs_onboarding(
        user.role, is_assigned=is_assigned, is_team=is_team
    ):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Your role cannot raise an escalation on this account",
        )

    entry = {
        "id": str(uuid4()),
        "raised_at": datetime.now(UTC).isoformat(),
        "raised_by_user_id": str(user.id),
        "raised_by_name": user.full_name or user.email,
        "reason": body.reason.strip(),
        "escalation_type": body.escalation_type,
        "owner": body.owner.strip(),
        "next_action": (body.next_action or "").strip() or None,
        "status": "open",
        "resolved_at": None,
        "resolved_by_user_id": None,
        "resolved_note": None,
    }

    real = (
        await db.execute(select(Account).where(Account.id == account_id))
    ).scalar_one()
    # Same deepcopy pattern as M22/M23 — shallow mutate doesn't flag dirty.
    new_list = copy.deepcopy(list(real.escalations or []))
    new_list.append(entry)
    real.escalations = new_list
    flag_modified(real, "escalations")
    await db.commit()

    return EscalationOut.model_validate(entry)


# ─────────────────────────────────────────────────────────────────────
# POST /escalations/:id/resolve
# ─────────────────────────────────────────────────────────────────────


@escalation_router.post("/{escalation_id}/resolve", response_model=EscalationOut)
async def resolve_escalation(
    escalation_id: Annotated[UUID, Path()],
    body: EscalationResolve,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> EscalationOut:
    # Resolve is admin/cs_director/vp_csm only — same asymmetric lock
    # pattern as M13 unlock / M19 unlock / M21 reopen / etc.
    if not is_global_admin(user.role):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Only admins can resolve escalations",
        )
    # Find the account whose escalations[] contains this id.
    eid = str(escalation_id)
    rows = (
        await db.execute(
            select(Account).where(
                Account.escalations.op("@>")(  # noqa: S608
                    f'[{{"id": "{eid}"}}]'
                )
            )
        )
    ).scalars().all()
    if not rows:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "Escalation not found"
        )
    real = rows[0]
    new_list = copy.deepcopy(list(real.escalations or []))
    target: dict | None = None
    for e in new_list:
        if e.get("id") == eid:
            target = e
            break
    if target is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "Escalation not found"
        )
    if target.get("status") == "resolved":
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Escalation already resolved"
        )
    target["status"] = "resolved"
    target["resolved_at"] = datetime.now(UTC).isoformat()
    target["resolved_by_user_id"] = str(user.id)
    target["resolved_note"] = body.resolved_note.strip()
    real.escalations = new_list
    flag_modified(real, "escalations")
    await db.commit()
    return EscalationOut.model_validate(target)
