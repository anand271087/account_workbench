"""M19 — Success Contract endpoints.

  GET   /accounts/:id/success-contract        Read (auto-drafts from handoff on first read if empty)
  PATCH /accounts/:id/success-contract        Update fields (refuses 409 if locked)
  POST  /accounts/:id/success-contract/lock   Validates all 3 locks satisfied → locks
  POST  /accounts/:id/success-contract/unlock Admin/director-only — clears lock fields

Lock model:
  * `locked_at` / `locked_by` both null → in-draft. PATCH allowed.
  * `locked_at` set → locked. PATCH returns 409. Unlock first.

Auto-draft:
  When the persisted `success_contract` is empty, the GET returns a
  *non-persisted* draft synthesized from:
    * account_solutioning.value_definition  → value_narrative
    * solutioning sh_successMetrics[0]      → metric1 + unit
    * solutioning sh_stakeholderSignoff     → measure_owner
  The frontend shows this as the form's initial state; saving via PATCH
  persists it. `auto_drafted: true` is the signal for the "from handoff"
  badge in the UI.
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
from app.models.solutioning import AccountSolutioning
from app.routes.accounts import _team_member_ids
from app.schemas.success_contract import (
    SuccessContractOut,
    SuccessContractUpdate,
)

router = APIRouter(prefix="/api/v1/accounts", tags=["success_contract"])


# Three-lock validation gates the POST /lock endpoint.
_MIN_NARRATIVE_LEN = 10


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


async def _auto_draft_from_solutioning(
    db: AsyncSession, account_id: UUID
) -> dict | None:
    """Build a draft contract from the solutioning row + sh_* fields.

    Returns None if nothing useful to seed from."""
    sol = (
        await db.execute(
            select(AccountSolutioning).where(
                AccountSolutioning.account_id == account_id
            )
        )
    ).scalar_one_or_none()
    if sol is None:
        return None

    draft: dict = {}
    if sol.value_definition:
        # Keep the narrative bounded so the UI doesn't render a wall of text.
        draft["value_narrative"] = sol.value_definition[:600]

    if sol.sh_value_from_solutioning and "value_narrative" not in draft:
        draft["value_narrative"] = sol.sh_value_from_solutioning[:600]

    if sol.sh_stakeholder_signoff:
        # "Jordan Mills, Dave Kowalski" → "Jordan Mills"
        first_owner = sol.sh_stakeholder_signoff.split(",")[0].strip()
        if first_owner:
            draft["measure_owner"] = first_owner

    if draft:
        # Reasonable defaults the user can override.
        draft.setdefault(
            "measure_source",
            f"Validated by {draft.get('measure_owner', 'procurement team')}"
            " using Beroe data vs actuals",
        )
        draft.setdefault("measure_freq", "Quarterly")

    return draft or None


def _serialise(
    acc: Account, *, editable: bool, auto_drafted: bool, override: dict | None = None
) -> SuccessContractOut:
    """Build the response from the persisted contract or a non-persisted draft."""
    source = override if override is not None else (acc.success_contract or {})
    return SuccessContractOut(
        account_id=acc.id,
        metric1=source.get("metric1"),
        metric1_unit=source.get("metric1_unit"),
        metric2=source.get("metric2"),
        measure_source=source.get("measure_source"),
        measure_freq=source.get("measure_freq"),
        measure_owner=source.get("measure_owner"),
        value_narrative=source.get("value_narrative"),
        locked_at=acc.success_contract_locked_at,
        locked_by=acc.success_contract_locked_by,
        auto_drafted=auto_drafted,
        is_editable=editable,
    )


# ============================================================
# GET /accounts/:id/success-contract
# ============================================================


@router.get(
    "/{account_id}/success-contract", response_model=SuccessContractOut
)
async def get_success_contract(
    account_id: Annotated[UUID, Path()],
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SuccessContractOut:
    acc, is_assigned, is_team = await _scope(db, user, account_id)
    editable = can_write_cs_onboarding(
        user.role, is_assigned=is_assigned, is_team=is_team
    )

    # If genuinely empty + not yet locked, try to draft from solutioning.
    # A dict of None-valued keys still counts as empty here.
    sc = acc.success_contract or {}
    has_data = any(v for v in sc.values())
    if not has_data and acc.success_contract_locked_at is None:
        draft = await _auto_draft_from_solutioning(db, account_id)
        if draft:
            return _serialise(
                acc, editable=editable, auto_drafted=True, override=draft
            )

    return _serialise(acc, editable=editable, auto_drafted=False)


# ============================================================
# PATCH /accounts/:id/success-contract
# ============================================================


@router.patch(
    "/{account_id}/success-contract", response_model=SuccessContractOut
)
async def patch_success_contract(
    account_id: Annotated[UUID, Path()],
    body: SuccessContractUpdate,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SuccessContractOut:
    _, is_assigned, is_team = await _scope(db, user, account_id)
    if not can_write_cs_onboarding(
        user.role, is_assigned=is_assigned, is_team=is_team
    ):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Your role cannot edit the Success Contract on this account",
        )

    real = (
        await db.execute(select(Account).where(Account.id == account_id))
    ).scalar_one()

    if real.success_contract_locked_at is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Success Contract is locked. Unlock first to edit.",
        )

    payload = body.model_dump(exclude_unset=True, mode="json")
    if payload:
        merged = dict(real.success_contract or {})
        # None means "clear this field" — pop the key so the contract stays
        # genuinely-empty when fully reset. Keeps the auto-draft branch in
        # GET reliable (it only fires when there's literally no data).
        for k, v in payload.items():
            if v is None:
                merged.pop(k, None)
            else:
                merged[k] = v
        real.success_contract = merged

    real.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(real)

    from app.core.scope import invalidate_account

    invalidate_account(account_id)
    return _serialise(real, editable=True, auto_drafted=False)


# ============================================================
# POST /accounts/:id/success-contract/lock
# ============================================================


@router.post(
    "/{account_id}/success-contract/lock",
    response_model=SuccessContractOut,
)
async def lock_success_contract(
    account_id: Annotated[UUID, Path()],
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SuccessContractOut:
    _, is_assigned, is_team = await _scope(db, user, account_id)
    if not can_write_cs_onboarding(
        user.role, is_assigned=is_assigned, is_team=is_team
    ):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Your role cannot lock the Success Contract on this account",
        )

    real = (
        await db.execute(select(Account).where(Account.id == account_id))
    ).scalar_one()

    if real.success_contract_locked_at is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Already locked"
        )

    sc = real.success_contract or {}

    # Validate the 3 locks.
    missing: list[str] = []
    if not (sc.get("metric1") and sc.get("metric1_unit")):
        missing.append("primary metric + unit")
    if not (sc.get("measure_source") and sc.get("measure_freq")):
        missing.append("measurement source + frequency")
    if (
        not sc.get("value_narrative")
        or len(sc["value_narrative"].strip()) < _MIN_NARRATIVE_LEN
    ):
        missing.append(f"value narrative (≥{_MIN_NARRATIVE_LEN} chars)")
    if missing:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"Cannot lock — missing: {'; '.join(missing)}",
        )

    real.success_contract_locked_at = datetime.now(timezone.utc)
    real.success_contract_locked_by = user.id
    real.updated_at = real.success_contract_locked_at
    await db.commit()
    await db.refresh(real)

    from app.core.scope import invalidate_account

    invalidate_account(account_id)
    return _serialise(real, editable=True, auto_drafted=False)


# ============================================================
# POST /accounts/:id/success-contract/unlock
# ============================================================


@router.post(
    "/{account_id}/success-contract/unlock",
    response_model=SuccessContractOut,
)
async def unlock_success_contract(
    account_id: Annotated[UUID, Path()],
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SuccessContractOut:
    # Unlock is admin-only (matches the M13 signing-unlock asymmetry). Reversing
    # a locked commitment should land under a director-grade user in the audit
    # trail, not the assigned CSM.
    if not is_global_admin(user.role):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Only admins can unlock the Success Contract",
        )

    _, _, _ = await _scope(db, user, account_id)
    real = (
        await db.execute(select(Account).where(Account.id == account_id))
    ).scalar_one()

    if real.success_contract_locked_at is None:
        # Idempotent — unlocking an already-draft contract is a no-op.
        return _serialise(
            real, editable=True, auto_drafted=False
        )

    real.success_contract_locked_at = None
    real.success_contract_locked_by = None
    real.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(real)

    from app.core.scope import invalidate_account

    invalidate_account(account_id)
    return _serialise(real, editable=True, auto_drafted=False)
