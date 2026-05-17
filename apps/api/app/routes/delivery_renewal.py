"""M23 — Delivery & Renewal endpoints.

  GET   /accounts/:id/delivery-renewal
        Returns the doc + derived state (track1 from M21 checkpoints,
        expand_paused from open red flags, readiness_score from the 3
        readiness answers).

  PATCH /accounts/:id/delivery-renewal
        Update expand pipeline lists + readiness. Refuses 409 when an
        outcome is already set (admin must re-open first).

  POST  /accounts/:id/delivery-renewal/red-flags
        Append one red flag. Generates id + raised_at server-side.

  POST  /accounts/:id/delivery-renewal/red-flags/:flag_id/resolve
        Mark one red flag resolved.

  POST  /accounts/:id/delivery-renewal/outcome
        Set the final outcome (renewed / at_risk / not_renewed /
        undecided). Stamps dr_outcome_set_at/by. Once set the document
        is read-only to non-admin writers.

  POST  /accounts/:id/delivery-renewal/reopen
        Admin-only. Clears the outcome stamp.

Lock-style asymmetry: write set can set outcome; admin-only re-open.
Matches M13/M19/M22.
"""

from __future__ import annotations

import copy
import uuid
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
from app.models.account import Account
from app.models.checkpoint import Checkpoint
from app.routes.accounts import _team_member_ids
from app.schemas.delivery_renewal import (
    DeliveryRenewalOut,
    DeliveryRenewalUpdate,
    OutcomeSet,
    Readiness,
    RedFlag,
    RedFlagCreate,
    Track1Derived,
)

router = APIRouter(prefix="/api/v1/accounts", tags=["delivery_renewal"])


_EXPAND_COL_KEYS = (
    "expand_value_proof",
    "expand_expand_ask",
    "expand_new_scope",
    "expand_close",
)


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


async def _derive_track1(db: AsyncSession, account_id: UUID) -> Track1Derived:
    """Derive renewal-track snapshot from M21 checkpoints."""
    rows = (
        await db.execute(
            select(Checkpoint)
            .where(Checkpoint.account_id == account_id)
            .order_by(Checkpoint.scheduled_date.asc().nulls_last())
        )
    ).scalars().all()
    if not rows:
        return Track1Derived()

    today = datetime.now(timezone.utc).date()
    overdue = 0
    signed = 0
    next_cp: Checkpoint | None = None
    for cp in rows:
        if cp.status == "signed_off":
            signed += 1
            continue
        if cp.scheduled_date and cp.scheduled_date < today:
            overdue += 1
        if next_cp is None and cp.scheduled_date and cp.scheduled_date >= today:
            next_cp = cp

    nx_days = None
    nx_sched = None
    nx_type = None
    if next_cp and next_cp.scheduled_date:
        nx_type = next_cp.type
        nx_sched = next_cp.scheduled_date.isoformat()
        nx_days = (next_cp.scheduled_date - today).days

    return Track1Derived(
        next_type=nx_type,
        next_scheduled=nx_sched,
        next_days_until=nx_days,
        overdue_count=overdue,
        signed_off_count=signed,
        total=len(rows),
    )


def _readiness_score(r: Readiness) -> int:
    return sum(
        1
        for a in (r.delivered_metric, r.proof_data, r.client_acknowledged)
        if a.answer == "yes"
    )


def _expand_paused(flags: list[RedFlag]) -> bool:
    return any(f.resolved_at is None for f in flags)


async def _serialise(
    db: AsyncSession,
    acc: Account,
    *,
    editable: bool,
) -> DeliveryRenewalOut:
    src = acc.delivery_renewal or {}
    flags = [RedFlag(**f) for f in (src.get("red_flags") or [])]
    readiness = Readiness(**(src.get("readiness") or {}))

    track1 = await _derive_track1(db, acc.id)

    return DeliveryRenewalOut(
        account_id=acc.id,
        expand_value_proof=src.get("expand_value_proof") or [],
        expand_expand_ask=src.get("expand_expand_ask") or [],
        expand_new_scope=src.get("expand_new_scope") or [],
        expand_close=src.get("expand_close") or [],
        red_flags=flags,
        readiness=readiness,
        track1=track1,
        expand_paused=_expand_paused(flags),
        readiness_score=_readiness_score(readiness),
        outcome=acc.dr_outcome,  # type: ignore[arg-type]
        outcome_set_at=acc.dr_outcome_set_at,
        outcome_set_by=acc.dr_outcome_set_by,
        is_editable=editable,
    )


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ============================================================
# GET /accounts/:id/delivery-renewal
# ============================================================


@router.get("/{account_id}/delivery-renewal", response_model=DeliveryRenewalOut)
async def get_dr(
    account_id: Annotated[UUID, Path()],
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> DeliveryRenewalOut:
    acc, is_assigned, is_team = await _scope(db, user, account_id)
    editable = (
        can_write_cs_onboarding(
            user.role, is_assigned=is_assigned, is_team=is_team
        )
        and acc.dr_outcome is None
    )
    return await _serialise(db, acc, editable=editable)


# ============================================================
# PATCH /accounts/:id/delivery-renewal
# ============================================================


@router.patch("/{account_id}/delivery-renewal", response_model=DeliveryRenewalOut)
async def patch_dr(
    account_id: Annotated[UUID, Path()],
    body: DeliveryRenewalUpdate,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> DeliveryRenewalOut:
    _, is_assigned, is_team = await _scope(db, user, account_id)
    if not can_write_cs_onboarding(
        user.role, is_assigned=is_assigned, is_team=is_team
    ):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Your role cannot edit Delivery & Renewal on this account",
        )

    real = (
        await db.execute(select(Account).where(Account.id == account_id))
    ).scalar_one()

    if real.dr_outcome is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Outcome is set. Admin must re-open before editing.",
        )

    payload = body.model_dump(exclude_unset=True, mode="json")
    if payload:
        merged = copy.deepcopy(real.delivery_renewal or {})
        for k, v in payload.items():
            if v is None:
                merged.pop(k, None)
            else:
                merged[k] = v
        real.delivery_renewal = merged

    real.updated_at = _now()
    await db.commit()
    await db.refresh(real)

    from app.core.scope import invalidate_account

    invalidate_account(account_id)
    return await _serialise(db, real, editable=True)


# ============================================================
# POST /accounts/:id/delivery-renewal/red-flags
# ============================================================


@router.post(
    "/{account_id}/delivery-renewal/red-flags",
    response_model=DeliveryRenewalOut,
    status_code=status.HTTP_201_CREATED,
)
async def add_red_flag(
    account_id: Annotated[UUID, Path()],
    body: RedFlagCreate,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> DeliveryRenewalOut:
    _, is_assigned, is_team = await _scope(db, user, account_id)
    if not can_write_cs_onboarding(
        user.role, is_assigned=is_assigned, is_team=is_team
    ):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Cannot raise red flags on this account"
        )

    real = (
        await db.execute(select(Account).where(Account.id == account_id))
    ).scalar_one()

    flag = {
        "id": str(uuid.uuid4()),
        "type": body.type,
        "note": body.note,
        "raised_at": _now().isoformat(),
        "raised_by": str(user.id),
        "resolved_at": None,
        "resolved_by": None,
    }
    merged = copy.deepcopy(real.delivery_renewal or {})
    flags = list(merged.get("red_flags") or [])
    flags.append(flag)
    merged["red_flags"] = flags
    real.delivery_renewal = merged
    real.updated_at = _now()
    await db.commit()
    await db.refresh(real)

    from app.core.scope import invalidate_account

    invalidate_account(account_id)
    return await _serialise(db, real, editable=True)


# ============================================================
# POST /accounts/:id/delivery-renewal/red-flags/:flag_id/resolve
# ============================================================


@router.post(
    "/{account_id}/delivery-renewal/red-flags/{flag_id}/resolve",
    response_model=DeliveryRenewalOut,
)
async def resolve_red_flag(
    account_id: Annotated[UUID, Path()],
    flag_id: Annotated[str, Path()],
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> DeliveryRenewalOut:
    _, is_assigned, is_team = await _scope(db, user, account_id)
    if not can_write_cs_onboarding(
        user.role, is_assigned=is_assigned, is_team=is_team
    ):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Cannot resolve red flags on this account"
        )

    real = (
        await db.execute(select(Account).where(Account.id == account_id))
    ).scalar_one()

    # Deep copy so SQLAlchemy sees a distinct dict-graph and flushes.
    # Mutating the shared inner dict in place can leave the old/new graphs
    # value-equal and SA skips the UPDATE.
    merged = copy.deepcopy(real.delivery_renewal or {})
    flags = merged.get("red_flags") or []
    hit = next((f for f in flags if f.get("id") == flag_id), None)
    if hit is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Red flag not found")
    if hit.get("resolved_at"):
        return await _serialise(db, real, editable=True)
    hit["resolved_at"] = _now().isoformat()
    hit["resolved_by"] = str(user.id)
    merged["red_flags"] = flags
    real.delivery_renewal = merged
    real.updated_at = _now()
    await db.commit()
    await db.refresh(real)

    from app.core.scope import invalidate_account

    invalidate_account(account_id)
    return await _serialise(db, real, editable=True)


# ============================================================
# POST /accounts/:id/delivery-renewal/outcome
# ============================================================


@router.post(
    "/{account_id}/delivery-renewal/outcome", response_model=DeliveryRenewalOut
)
async def set_outcome(
    account_id: Annotated[UUID, Path()],
    body: OutcomeSet,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> DeliveryRenewalOut:
    _, is_assigned, is_team = await _scope(db, user, account_id)
    if not can_write_cs_onboarding(
        user.role, is_assigned=is_assigned, is_team=is_team
    ):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Cannot set outcome on this account"
        )

    real = (
        await db.execute(select(Account).where(Account.id == account_id))
    ).scalar_one()

    if real.dr_outcome is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Outcome already set. Admin must re-open to change.",
        )

    real.dr_outcome = body.outcome
    real.dr_outcome_set_at = _now()
    real.dr_outcome_set_by = user.id
    real.updated_at = real.dr_outcome_set_at
    await db.commit()
    await db.refresh(real)

    from app.core.scope import invalidate_account

    invalidate_account(account_id)
    return await _serialise(db, real, editable=False)


# ============================================================
# POST /accounts/:id/delivery-renewal/reopen
# ============================================================


@router.post(
    "/{account_id}/delivery-renewal/reopen", response_model=DeliveryRenewalOut
)
async def reopen_outcome(
    account_id: Annotated[UUID, Path()],
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> DeliveryRenewalOut:
    # Admin-only — matches M13/M19/M22 unlock asymmetry. Reversing a
    # final outcome should land under a director-grade user.
    if not is_global_admin(user.role):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Only admins can re-open the outcome"
        )

    _, _, _ = await _scope(db, user, account_id)
    real = (
        await db.execute(select(Account).where(Account.id == account_id))
    ).scalar_one()

    if real.dr_outcome is None:
        return await _serialise(db, real, editable=True)

    real.dr_outcome = None
    real.dr_outcome_set_at = None
    real.dr_outcome_set_by = None
    real.updated_at = _now()
    await db.commit()
    await db.refresh(real)

    from app.core.scope import invalidate_account

    invalidate_account(account_id)
    return await _serialise(db, real, editable=True)
