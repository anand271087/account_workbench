"""M21 — Checkpoint endpoints.

  GET    /accounts/:id/checkpoints                  List in scheduled order
  POST   /accounts/:id/checkpoints                  Create a checkpoint
  POST   /accounts/:id/checkpoints/auto-schedule    Standard 4-checkpoint cadence
  PATCH  /checkpoints/:id                           Update fields
  POST   /checkpoints/:id/sign-off                  Sign-off with snapshot → status=signed_off
  DELETE /checkpoints/:id                           Hard delete (not signed off)

Auto-schedule cadence — only fires if no checkpoints exist yet for the
account. Uses gate_signed_date as Day 0:
  * Kickoff  — gate_signed_date
  * MBR      — gate_signed_date + 90d
  * QBR      — gate_signed_date + 180d
  * Renewal  — gate_renewal_date − 14d (or signed_date + 335d fallback)
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Path, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser
from app.core.rbac import (
    can_view_account,
    can_write_cs_onboarding,
)
from app.db.session import get_db
from app.models.account import Account
from app.models.checkpoint import Checkpoint
from app.routes.accounts import _team_member_ids
from app.schemas.checkpoint import (
    CheckpointCreate,
    CheckpointListOut,
    CheckpointOut,
    CheckpointSignOff,
    CheckpointUpdate,
)

account_router = APIRouter(prefix="/api/v1/accounts", tags=["checkpoints"])
checkpoint_router = APIRouter(prefix="/api/v1/checkpoints", tags=["checkpoints"])


# ============================================================
# Helpers
# ============================================================


async def _scope(
    db: AsyncSession, user, account_id: UUID
) -> tuple[Account, bool, bool]:
    from app.core.scope import get_account_row

    acc = await get_account_row(db, account_id)
    is_assigned = (acc.csm_user_id == user.id) or (acc.co_user_id == user.id)
    team_ids = (
        await _team_member_ids(db, user) if user.role == "cs_team_manager" else set()
    )
    is_team = acc.csm_user_id in team_ids if team_ids else False
    if not can_view_account(user.role, is_assigned=is_assigned, is_team=is_team):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Forbidden on this account")
    return acc, is_assigned, is_team


async def _scope_for_checkpoint(
    db: AsyncSession, user, checkpoint_id: UUID
) -> tuple[Checkpoint, bool, bool]:
    cp = (
        await db.execute(
            select(Checkpoint).where(Checkpoint.id == checkpoint_id)
        )
    ).scalar_one_or_none()
    if cp is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Checkpoint not found")
    _, is_assigned, is_team = await _scope(db, user, cp.account_id)
    return cp, is_assigned, is_team


def _serialise(cp: Checkpoint, *, editable: bool) -> CheckpointOut:
    out = CheckpointOut.model_validate(cp)
    out.is_editable = editable
    return out


# ============================================================
# GET /accounts/:id/checkpoints
# ============================================================


@account_router.get(
    "/{account_id}/checkpoints", response_model=CheckpointListOut
)
async def list_checkpoints(
    account_id: Annotated[UUID, Path()],
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> CheckpointListOut:
    _, is_assigned, is_team = await _scope(db, user, account_id)
    editable = can_write_cs_onboarding(
        user.role, is_assigned=is_assigned, is_team=is_team
    )

    # Standard cadence order: Kickoff → MBR → QBR → Renewal. We sort by
    # scheduled_date first (nulls last) so the natural cadence shows up
    # even if scheduled_date isn't set yet on later checkpoints.
    stmt = (
        select(Checkpoint)
        .where(Checkpoint.account_id == account_id)
        .order_by(Checkpoint.scheduled_date.asc().nulls_last(), Checkpoint.created_at.asc())
    )
    rows = (await db.execute(stmt)).scalars().all()
    items = [_serialise(cp, editable=editable) for cp in rows]
    return CheckpointListOut(items=items, total=len(items), is_editable=editable)


# ============================================================
# POST /accounts/:id/checkpoints
# ============================================================


@account_router.post(
    "/{account_id}/checkpoints",
    response_model=CheckpointOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_checkpoint(
    account_id: Annotated[UUID, Path()],
    body: CheckpointCreate,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> CheckpointOut:
    _, is_assigned, is_team = await _scope(db, user, account_id)
    if not can_write_cs_onboarding(
        user.role, is_assigned=is_assigned, is_team=is_team
    ):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Cannot create checkpoints on this account"
        )

    cp = Checkpoint(
        account_id=account_id,
        type=body.type,
        scheduled_date=body.scheduled_date,
        created_by=user.id,
    )
    db.add(cp)
    await db.commit()
    await db.refresh(cp)
    return _serialise(cp, editable=True)


# ============================================================
# POST /accounts/:id/checkpoints/auto-schedule
# ============================================================


@account_router.post(
    "/{account_id}/checkpoints/auto-schedule",
    response_model=CheckpointListOut,
)
async def auto_schedule_checkpoints(
    account_id: Annotated[UUID, Path()],
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> CheckpointListOut:
    """Idempotent — only creates missing standard checkpoints."""
    acc, is_assigned, is_team = await _scope(db, user, account_id)
    if not can_write_cs_onboarding(
        user.role, is_assigned=is_assigned, is_team=is_team
    ):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Cannot auto-schedule on this account"
        )

    if not acc.gate_signed or not acc.gate_signed_date:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Account must be signed (gate_signed=true) before auto-scheduling checkpoints",
        )

    signed = acc.gate_signed_date
    renewal = acc.gate_renewal_date

    # Compute the standard 4-checkpoint cadence.
    plan: dict[str, date] = {
        "Kickoff": signed,
        "MBR": signed + timedelta(days=90),
        "QBR": signed + timedelta(days=180),
        "Renewal": (renewal - timedelta(days=14)) if renewal else signed + timedelta(days=335),
    }

    # Skip types we already have rows for (idempotent re-run).
    existing = (
        await db.execute(
            select(Checkpoint.type).where(Checkpoint.account_id == account_id)
        )
    ).scalars().all()
    existing_set = set(existing)

    for ctype, sched in plan.items():
        if ctype in existing_set:
            continue
        db.add(
            Checkpoint(
                account_id=account_id,
                type=ctype,
                scheduled_date=sched,
                created_by=user.id,
            )
        )
    await db.commit()

    # Return the full list for the caller's convenience.
    stmt = (
        select(Checkpoint)
        .where(Checkpoint.account_id == account_id)
        .order_by(Checkpoint.scheduled_date.asc().nulls_last(), Checkpoint.created_at.asc())
    )
    rows = (await db.execute(stmt)).scalars().all()
    items = [_serialise(cp, editable=True) for cp in rows]
    return CheckpointListOut(items=items, total=len(items), is_editable=True)


# ============================================================
# PATCH /checkpoints/:id
# ============================================================


@checkpoint_router.patch("/{checkpoint_id}", response_model=CheckpointOut)
async def patch_checkpoint(
    checkpoint_id: Annotated[UUID, Path()],
    body: CheckpointUpdate,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> CheckpointOut:
    cp, is_assigned, is_team = await _scope_for_checkpoint(db, user, checkpoint_id)
    if not can_write_cs_onboarding(
        user.role, is_assigned=is_assigned, is_team=is_team
    ):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Cannot edit this checkpoint"
        )

    if cp.status == "signed_off":
        # Signed-off checkpoints are immutable evidence. Block edits.
        # If a director needs to revise, we'd add a /reopen endpoint
        # later — out of scope for M21.
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Checkpoint is signed off and cannot be edited",
        )

    payload = body.model_dump(exclude_unset=True)
    for k, v in payload.items():
        setattr(cp, k, v)
    cp.updated_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(cp)
    return _serialise(cp, editable=True)


# ============================================================
# POST /checkpoints/:id/sign-off
# ============================================================


@checkpoint_router.post(
    "/{checkpoint_id}/sign-off", response_model=CheckpointOut
)
async def sign_off_checkpoint(
    checkpoint_id: Annotated[UUID, Path()],
    body: CheckpointSignOff,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> CheckpointOut:
    cp, is_assigned, is_team = await _scope_for_checkpoint(db, user, checkpoint_id)
    if not can_write_cs_onboarding(
        user.role, is_assigned=is_assigned, is_team=is_team
    ):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Cannot sign off this checkpoint"
        )

    if cp.status == "signed_off":
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Checkpoint already signed off"
        )

    snapshot = body.model_dump(mode="json", exclude={"held_date"})
    now = datetime.now(timezone.utc)

    cp.status = "signed_off"
    cp.signed_off_at = now
    cp.signed_off_by = user.id
    cp.signed_off_snapshot = snapshot
    if body.held_date:
        cp.held_date = body.held_date
    elif cp.held_date is None:
        cp.held_date = now.date()  # default to today if caller didn't set it
    cp.updated_at = now

    await db.commit()
    await db.refresh(cp)
    return _serialise(cp, editable=True)


# ============================================================
# DELETE /checkpoints/:id
# ============================================================


@checkpoint_router.delete(
    "/{checkpoint_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def delete_checkpoint(
    checkpoint_id: Annotated[UUID, Path()],
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    cp, is_assigned, is_team = await _scope_for_checkpoint(db, user, checkpoint_id)
    if not can_write_cs_onboarding(
        user.role, is_assigned=is_assigned, is_team=is_team
    ):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Cannot delete this checkpoint"
        )
    if cp.status == "signed_off":
        # Same invariant as PATCH — signed-off is permanent evidence.
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Signed-off checkpoints cannot be deleted",
        )
    await db.delete(cp)
    await db.commit()
