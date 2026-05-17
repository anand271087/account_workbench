"""M22 — Value Delivery Document endpoints.

  GET   /accounts/:id/value-delivery-document        Read (auto-drafts on first read if empty)
  PATCH /accounts/:id/value-delivery-document        Update (refuses 409 if locked)
  POST  /accounts/:id/value-delivery-document/lock   Validates required minimums → locks
  POST  /accounts/:id/value-delivery-document/unlock Admin-only — clears lock fields

Lock model — same as M19 Success Contract:
  * `vdd_locked_at` / `vdd_locked_by` null → in-draft. PATCH allowed.
  * `vdd_locked_at` set → locked. PATCH returns 409.

Auto-draft (on first read when the document is genuinely empty):
  * client_strategic_priorities ← parsed from success_contract.value_narrative
                                  (newline-split) as a starter seed
  * agreed_success_metrics      ← snapshot of success_metrics (M20) — every
                                  non-deleted row carried as MetricSnapshot
  * beroes_approach             ← cs_goals.initiatives (M15) — one row per
                                  initiative across non-deleted goals
  * value_delivered             ← parallel rows from cs_goals.initiatives
                                  (CSM fills in the $-amounts later)
  Non-persisted — saving via PATCH persists. `auto_drafted: true` is the
  badge signal for the UI.
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
from app.models.account import Account
from app.models.cs_goal import CSGoal
from app.models.metric import SuccessMetric
from app.routes.accounts import _team_member_ids
from app.schemas.vdd import VddOut, VddUpdate

router = APIRouter(prefix="/api/v1/accounts", tags=["vdd"])


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


async def _auto_draft(
    db: AsyncSession, account_id: UUID, acc: Account
) -> dict | None:
    """Build a starter VDD from existing Success Mgmt artifacts.

    Returns None if there's nothing useful to seed from."""
    draft: dict = {}

    # 1. Strategic priorities seeded from contract narrative (newline-split).
    sc = acc.success_contract or {}
    narrative = (sc.get("value_narrative") or "").strip()
    if narrative:
        lines = [ln.strip(" -•·\t") for ln in narrative.splitlines()]
        priorities = [ln for ln in lines if ln][:6]
        if priorities:
            draft["client_strategic_priorities"] = priorities

    # 2. Agreed metrics ← live snapshot of M20 success_metrics.
    metrics = (
        await db.execute(
            select(SuccessMetric)
            .where(SuccessMetric.account_id == account_id)
            .where(SuccessMetric.deleted_at.is_(None))
            .order_by(SuccessMetric.created_at.asc())
        )
    ).scalars().all()
    if metrics:
        draft["agreed_success_metrics"] = [
            {
                "id": str(m.id),
                "name": m.name,
                "target": m.target_value,
                "current": m.current_value,
                "status": m.status_override,  # raw — derived status lives on the metric API
            }
            for m in metrics
        ]

    # 3+4. Approach & value_delivered from cs_goals.initiatives.
    goals = (
        await db.execute(
            select(CSGoal)
            .where(CSGoal.account_id == account_id)
            .where(CSGoal.deleted_at.is_(None))
        )
    ).scalars().all()

    approach: list[dict] = []
    value_rows: list[dict] = []
    for g in goals:
        inits = (g.initiatives or []) if isinstance(g.initiatives, list) else []
        for init in inits:
            if not isinstance(init, dict):
                continue
            iid = init.get("id")
            name = init.get("name") or "Untitled initiative"
            approach.append(
                {
                    "initiative_id": iid,
                    "initiative_name": name,
                    "approach": init.get("approach") or init.get("description"),
                    "levers": init.get("levers") or [],
                    "stage": init.get("stage"),
                }
            )
            value_rows.append(
                {
                    "initiative_id": iid,
                    "initiative_name": name,
                    "identified_musd": init.get("identified_musd"),
                    "committed_musd": init.get("committed_musd"),
                    "implemented_musd": init.get("implemented_musd"),
                }
            )
    if approach:
        draft["beroes_approach"] = approach
    if value_rows:
        draft["value_delivered"] = value_rows

    return draft or None


def _serialise(
    acc: Account,
    *,
    editable: bool,
    auto_drafted: bool,
    override: dict | None = None,
) -> VddOut:
    source = override if override is not None else (acc.value_delivery_document or {})
    return VddOut(
        account_id=acc.id,
        client_strategic_priorities=source.get("client_strategic_priorities") or [],
        agreed_success_metrics=source.get("agreed_success_metrics") or [],
        beroes_approach=source.get("beroes_approach") or [],
        value_delivered=source.get("value_delivered") or [],
        exec_summary=source.get("exec_summary"),
        locked_at=acc.vdd_locked_at,
        locked_by=acc.vdd_locked_by,
        auto_drafted=auto_drafted,
        is_editable=editable,
    )


# ============================================================
# GET /accounts/:id/value-delivery-document
# ============================================================


@router.get(
    "/{account_id}/value-delivery-document", response_model=VddOut
)
async def get_vdd(
    account_id: Annotated[UUID, Path()],
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> VddOut:
    acc, is_assigned, is_team = await _scope(db, user, account_id)
    editable = can_write_cs_onboarding(
        user.role, is_assigned=is_assigned, is_team=is_team
    )

    vdd = acc.value_delivery_document or {}
    has_data = any(v for v in vdd.values())
    if not has_data and acc.vdd_locked_at is None:
        draft = await _auto_draft(db, account_id, acc)
        if draft:
            return _serialise(
                acc, editable=editable, auto_drafted=True, override=draft
            )

    return _serialise(acc, editable=editable, auto_drafted=False)


# ============================================================
# PATCH /accounts/:id/value-delivery-document
# ============================================================


@router.patch(
    "/{account_id}/value-delivery-document", response_model=VddOut
)
async def patch_vdd(
    account_id: Annotated[UUID, Path()],
    body: VddUpdate,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> VddOut:
    _, is_assigned, is_team = await _scope(db, user, account_id)
    if not can_write_cs_onboarding(
        user.role, is_assigned=is_assigned, is_team=is_team
    ):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Your role cannot edit the Value Delivery Document on this account",
        )

    real = (
        await db.execute(select(Account).where(Account.id == account_id))
    ).scalar_one()

    if real.vdd_locked_at is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Value Delivery Document is locked. Unlock first to edit.",
        )

    payload = body.model_dump(exclude_unset=True, mode="json")
    if payload:
        merged = dict(real.value_delivery_document or {})
        for k, v in payload.items():
            if v is None:
                merged.pop(k, None)
            else:
                merged[k] = v
        real.value_delivery_document = merged

    real.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(real)

    from app.core.scope import invalidate_account

    invalidate_account(account_id)
    return _serialise(real, editable=True, auto_drafted=False)


# ============================================================
# POST /accounts/:id/value-delivery-document/lock
# ============================================================


@router.post(
    "/{account_id}/value-delivery-document/lock", response_model=VddOut
)
async def lock_vdd(
    account_id: Annotated[UUID, Path()],
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> VddOut:
    _, is_assigned, is_team = await _scope(db, user, account_id)
    if not can_write_cs_onboarding(
        user.role, is_assigned=is_assigned, is_team=is_team
    ):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Your role cannot lock the Value Delivery Document on this account",
        )

    real = (
        await db.execute(select(Account).where(Account.id == account_id))
    ).scalar_one()

    if real.vdd_locked_at is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Already locked")

    vdd = real.value_delivery_document or {}

    # Required minimums: each of the four sections must have ≥1 item.
    missing: list[str] = []
    if not (vdd.get("client_strategic_priorities") or []):
        missing.append("client strategic priorities (≥1)")
    if not (vdd.get("agreed_success_metrics") or []):
        missing.append("agreed success metrics (≥1)")
    if not (vdd.get("beroes_approach") or []):
        missing.append("Beroe's approach per initiative (≥1)")
    if not (vdd.get("value_delivered") or []):
        missing.append("value delivered rollup (≥1)")
    if missing:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"Cannot lock — missing: {'; '.join(missing)}",
        )

    real.vdd_locked_at = datetime.now(timezone.utc)
    real.vdd_locked_by = user.id
    real.updated_at = real.vdd_locked_at
    await db.commit()
    await db.refresh(real)

    from app.core.scope import invalidate_account

    invalidate_account(account_id)
    return _serialise(real, editable=True, auto_drafted=False)


# ============================================================
# POST /accounts/:id/value-delivery-document/unlock
# ============================================================


@router.post(
    "/{account_id}/value-delivery-document/unlock", response_model=VddOut
)
async def unlock_vdd(
    account_id: Annotated[UUID, Path()],
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> VddOut:
    # Admin-only — matches the M13 signing-unlock and M19 contract-unlock
    # asymmetry. Reversing a locked deliverable lands under a director.
    if not is_global_admin(user.role):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Only admins can unlock the Value Delivery Document",
        )

    _, _, _ = await _scope(db, user, account_id)
    real = (
        await db.execute(select(Account).where(Account.id == account_id))
    ).scalar_one()

    if real.vdd_locked_at is None:
        return _serialise(real, editable=True, auto_drafted=False)

    real.vdd_locked_at = None
    real.vdd_locked_by = None
    real.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(real)

    from app.core.scope import invalidate_account

    invalidate_account(account_id)
    return _serialise(real, editable=True, auto_drafted=False)
