"""M13 — Sales Hand-off & Signing endpoints.

  GET    /accounts/:id/sign                  read the signing gate snapshot
  POST   /accounts/:id/sign                  Sales/CO confirms signing
  POST   /accounts/:id/sign/unlock           Admin re-opens (with reason)
  PATCH  /accounts/:id/handover-checklist    manual override of the auto-detected quality check
  PATCH  /accounts/:id/contract-doc          record a contract filename (after upload via storage)

Signing is a structured event, not a freeform PATCH — there's no /sign
PATCH route. Once signed, only /unlock can re-open the gate, and the
unlock is audited via gate_unlock_reason + gate_unlocked_by/_at.

Renewal + VDD due dates are derived from gate_signed_date + the term so
we never store stale values. Term parsing is forgiving: "1 year",
"2 years", "3 years", "Custom" — anything else just leaves renewal null.
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
    can_sign_account,
    can_unlock_signing,
    can_view_account,
    can_write_sales_handoff,
)
from app.db.session import get_db
from app.models.account import Account
from app.routes.accounts import _team_member_ids
from app.schemas.signing import (
    ContractDocUpdate,
    ContractExtrasUpdate,
    HandoverChecklistUpdate,
    ModuleConfigsUpdate,
    SignAccountIn,
    ShLockIn,
    ShUnlockIn,
    SigningGateOut,
    UnlockSigningIn,
)

router = APIRouter(prefix="/api/v1/accounts", tags=["signing"])


# ============================================================
# Helpers
# ============================================================


async def _scope(db: AsyncSession, user, account_id: UUID) -> tuple[Account, bool, bool]:
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


def _years_from_term(term: str) -> int | None:
    """Map the free-text contract term to a years count. Returns None for
    'Custom' or unrecognised values — those leave renewal_date null."""
    t = term.strip().lower()
    table = {
        "1 year": 1, "1y": 1, "1 yr": 1, "12 months": 1,
        "2 years": 2, "2y": 2, "2 yr": 2, "24 months": 2,
        "3 years": 3, "3y": 3, "3 yr": 3, "36 months": 3,
    }
    return table.get(t)


def _derive_dates(signed_date: date, term: str) -> tuple[date | None, date | None]:
    """Return (renewal_date, bvd_due_date) derived from the signing event.

    BVD due date is 6 months from go-live but never after renewal — if the
    contract is very short, we pull the VDD due to 30 days before renewal.
    """
    years = _years_from_term(term)
    if years is None:
        return None, None
    # naive year arithmetic — leap years roll forward to Feb 28/29 as usual.
    try:
        renewal = signed_date.replace(year=signed_date.year + years)
    except ValueError:
        # Feb 29 in a non-leap year → fall back to Feb 28.
        renewal = signed_date.replace(year=signed_date.year + years, day=28)
    bvd = signed_date + timedelta(days=183)  # ~6 months
    if bvd > renewal:
        bvd = renewal - timedelta(days=30)
    return renewal, bvd


async def _resolve_user_name(
    db: AsyncSession, user_id: UUID | None
) -> str | None:
    if user_id is None:
        return None
    from app.models.user import User

    row = (
        await db.execute(
            select(User.full_name).where(User.id == user_id, User.deleted_at.is_(None))
        )
    ).scalar_one_or_none()
    return row


def _serialise(acc: Account, *, can_sign: bool, can_unlock: bool) -> SigningGateOut:
    out = SigningGateOut.model_validate(acc)
    out.can_sign = can_sign
    out.can_unlock = can_unlock
    # 04-Jun — Sales Handoff stage-1 lock capabilities. Sales (or higher)
    # can lock; admin can unlock.
    out.can_sh_lock = can_sign  # whoever can sign can lock-for-onboarding too
    out.can_sh_unlock = can_unlock
    return out


async def _serialise_with_name(
    acc: Account,
    db: AsyncSession,
    *,
    can_sign: bool,
    can_unlock: bool,
) -> SigningGateOut:
    """Same as _serialise but resolves gate_confirmed_by → user.full_name
    (H41 — surfaces the Sales person's name on the signed display) +
    sh_locked_by → name (04-Jun)."""
    out = _serialise(acc, can_sign=can_sign, can_unlock=can_unlock)
    out.gate_confirmed_by_name = await _resolve_user_name(db, acc.gate_confirmed_by)
    out.sh_locked_by_name = await _resolve_user_name(db, acc.sh_locked_by)
    return out


# ============================================================
# GET /accounts/:id/sign
# ============================================================


@router.get("/{account_id}/sign", response_model=SigningGateOut)
async def get_signing_gate(
    account_id: Annotated[UUID, Path()],
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SigningGateOut:
    acc, is_assigned, is_team = await _scope(db, user, account_id)
    return await _serialise_with_name(
        acc,
        db,
        can_sign=can_sign_account(user.role, is_assigned=is_assigned, is_team=is_team),
        can_unlock=can_unlock_signing(user.role),
    )


# ============================================================
# POST /accounts/:id/sign
# ============================================================


@router.post("/{account_id}/sign", response_model=SigningGateOut)
async def sign_account(
    account_id: Annotated[UUID, Path()],
    body: SignAccountIn,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SigningGateOut:
    """Sales / CO confirms the deal is signed.

    Idempotent only in the strict sense: if the gate is already signed and
    not unlocked, returns 409 — re-signing requires /unlock first. This
    forces an audit trail when a signed contract's metadata changes.
    """
    acc, is_assigned, is_team = await _scope(db, user, account_id)
    if not can_sign_account(user.role, is_assigned=is_assigned, is_team=is_team):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Your role cannot confirm signing on this account"
        )

    real = (
        await db.execute(select(Account).where(Account.id == account_id))
    ).scalar_one()

    if real.gate_signed and not real.gate_unlocked:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Already signed. POST /sign/unlock first if the metadata is wrong.",
        )

    renewal, bvd = _derive_dates(body.gate_signed_date, body.gate_contract_term)

    real.gate_signed = True
    real.gate_signed_date = body.gate_signed_date
    real.gate_contract_acv = body.gate_contract_acv
    real.gate_contract_term = body.gate_contract_term
    real.gate_renewal_date = renewal
    real.gate_bvd_due_date = bvd
    real.gate_confirmed_by = user.id
    real.gate_confirmed_at = datetime.now(timezone.utc)
    # Re-confirming after an unlock clears the unlock state — the gate is
    # signed-and-current again.
    real.gate_unlocked = False
    if body.gate_contract_modules is not None:
        real.gate_contract_modules = body.gate_contract_modules
    if body.gate_platform_tier is not None:
        real.gate_platform_tier = body.gate_platform_tier
    if body.gate_account_segment is not None:
        real.gate_account_segment = body.gate_account_segment
    if body.gate_subscribers is not None:
        real.gate_subscribers = body.gate_subscribers

    await db.commit()
    await db.refresh(real)

    from app.core.scope import invalidate_account
    invalidate_account(account_id)

    return _serialise(
        real,
        can_sign=can_sign_account(user.role, is_assigned=is_assigned, is_team=is_team),
        can_unlock=can_unlock_signing(user.role),
    )


# ============================================================
# POST /accounts/:id/sign/unlock
# ============================================================


@router.post("/{account_id}/sign/unlock", response_model=SigningGateOut)
async def unlock_signing(
    account_id: Annotated[UUID, Path()],
    body: UnlockSigningIn,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SigningGateOut:
    """Admin re-opens the signing gate so the metadata can be corrected.

    Note: we leave gate_signed=true. The `gate_unlocked` flag is the signal
    that the contract metadata is being revised; once Sales re-confirms via
    /sign it flips back to false.
    """
    acc, is_assigned, is_team = await _scope(db, user, account_id)
    if not can_unlock_signing(user.role):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Only admins / directors can unlock signing"
        )

    real = (
        await db.execute(select(Account).where(Account.id == account_id))
    ).scalar_one()
    if not real.gate_signed:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Account is not signed — nothing to unlock.",
        )

    real.gate_unlocked = True
    real.gate_unlock_reason = body.reason
    real.gate_unlocked_by = user.id
    real.gate_unlocked_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(real)

    from app.core.scope import invalidate_account
    invalidate_account(account_id)

    return _serialise(
        real,
        can_sign=can_sign_account(user.role, is_assigned=is_assigned, is_team=is_team),
        can_unlock=True,
    )


# ============================================================
# PATCH /accounts/:id/handover-checklist
# ============================================================


@router.patch("/{account_id}/handover-checklist", response_model=SigningGateOut)
async def patch_handover_checklist(
    account_id: Annotated[UUID, Path()],
    body: HandoverChecklistUpdate,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SigningGateOut:
    """Manual overrides on the auto-detected handover quality check.

    Each key in `items` is one checklist line (e.g. "savings",
    "stakeholders", "categories", "success_metric"). Posting a key sets
    it; we merge into the existing dict rather than replace, so different
    users can adjust different items without a race.
    """
    acc, is_assigned, is_team = await _scope(db, user, account_id)
    if not can_write_sales_handoff(user.role, is_assigned=is_assigned, is_team=is_team):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Your role cannot edit the handover checklist"
        )

    real = (
        await db.execute(select(Account).where(Account.id == account_id))
    ).scalar_one()
    merged = dict(real.handover_quality_check or {})
    merged.update(body.items)
    real.handover_quality_check = merged
    await db.commit()
    await db.refresh(real)

    from app.core.scope import invalidate_account
    invalidate_account(account_id)

    return _serialise(
        real,
        can_sign=can_sign_account(user.role, is_assigned=is_assigned, is_team=is_team),
        can_unlock=can_unlock_signing(user.role),
    )


# ============================================================
# PATCH /accounts/:id/contract-doc
# ============================================================


@router.patch("/{account_id}/contract-doc", response_model=SigningGateOut)
async def patch_contract_doc(
    account_id: Annotated[UUID, Path()],
    body: ContractDocUpdate,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SigningGateOut:
    """Record the contract document filename. Actual upload goes through
    /api/v1/documents — this endpoint just stores the human-readable
    reference rendered in the signed-card."""
    acc, is_assigned, is_team = await _scope(db, user, account_id)
    if not can_write_sales_handoff(user.role, is_assigned=is_assigned, is_team=is_team):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Your role cannot edit the contract doc"
        )
    if not acc.gate_signed:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Account must be signed before attaching a contract doc.",
        )

    real = (
        await db.execute(select(Account).where(Account.id == account_id))
    ).scalar_one()
    real.gate_contract_doc = body.gate_contract_doc
    real.gate_contract_doc_at = date.today() if body.gate_contract_doc else None
    await db.commit()
    await db.refresh(real)

    from app.core.scope import invalidate_account
    invalidate_account(account_id)

    return _serialise(
        real,
        can_sign=can_sign_account(user.role, is_assigned=is_assigned, is_team=is_team),
        can_unlock=can_unlock_signing(user.role),
    )


# ============================================================
# 04-Jun — Sales Handoff stage-1 lock / unlock
# ============================================================


@router.post("/{account_id}/sh-lock", response_model=SigningGateOut)
async def lock_sales_handoff(
    account_id: Annotated[UUID, Path()],
    body: ShLockIn,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SigningGateOut:
    """Stage 1 → 2 — Sales locks the handoff for onboarding (Contract Ops
    audit phase begins). Idempotent if already locked."""
    del body  # empty body — locking is a state flip
    _scoped, is_assigned, is_team = await _scope(db, user, account_id)
    del _scoped  # only used for permission inputs
    if not can_sign_account(user.role, is_assigned=is_assigned, is_team=is_team):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Your role cannot lock the Sales Handoff")
    # Re-fetch as a session-tracked row (scope cache returns a detached
    # instance that SQLAlchemy can't commit + refresh through).
    real = (await db.execute(select(Account).where(Account.id == account_id))).scalar_one()
    if real.sh_locked_at is None:
        real.sh_locked_at = datetime.now(timezone.utc)
        real.sh_locked_by = user.id
        await db.commit()
        await db.refresh(real)
        from app.core.scope import invalidate_account
        invalidate_account(account_id)
    return await _serialise_with_name(
        real, db,
        can_sign=can_sign_account(user.role, is_assigned=is_assigned, is_team=is_team),
        can_unlock=can_unlock_signing(user.role),
    )


@router.post("/{account_id}/sh-unlock", response_model=SigningGateOut)
async def unlock_sales_handoff(
    account_id: Annotated[UUID, Path()],
    body: ShUnlockIn,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SigningGateOut:
    """Admin reopens the Sales Handoff. Reason logged via audit listener."""
    del body  # reason is audited by SQLAlchemy event listener via context
    _scoped, is_assigned, is_team = await _scope(db, user, account_id)
    del _scoped
    if not can_unlock_signing(user.role):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only admins can unlock the Sales Handoff")
    real = (await db.execute(select(Account).where(Account.id == account_id))).scalar_one()
    if real.sh_locked_at is not None:
        real.sh_locked_at = None
        real.sh_locked_by = None
        await db.commit()
        await db.refresh(real)
        from app.core.scope import invalidate_account
        invalidate_account(account_id)
    return await _serialise_with_name(
        real, db,
        can_sign=can_sign_account(user.role, is_assigned=is_assigned, is_team=is_team),
        can_unlock=can_unlock_signing(user.role),
    )


# ============================================================
# 04-Jun — Per-module configs + audit-only extras (Contract Ops)
# ============================================================


@router.patch("/{account_id}/module-configs", response_model=SigningGateOut)
async def patch_module_configs(
    account_id: Annotated[UUID, Path()],
    body: ModuleConfigsUpdate,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SigningGateOut:
    """Merge per-module configs into accounts.gate_module_configs.

    Top-level: modules absent from body are left untouched.
    Per-module: fields in body are MERGED into the existing module's
    config (not replaced). An empty dict {} is the explicit "clear
    this module" sentinel.

    09-Jun bug — previously did `merged[mod] = cfg` which replaced
    the whole module's config. Tester filled # of Commodities,
    blurred (saved {commodities: "9"}), then filled Forecast
    Horizon and blurred — the second save sent {horizonMonths: "6"}
    and the backend wiped commodities. Per-module checklist tile
    stayed red because one of the two fields was perpetually empty.
    """
    _scoped, is_assigned, is_team = await _scope(db, user, account_id)
    del _scoped
    if not can_sign_account(user.role, is_assigned=is_assigned, is_team=is_team):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Your role cannot edit module configs",
        )
    real = (await db.execute(select(Account).where(Account.id == account_id))).scalar_one()
    if real.gate_signed and not real.gate_unlocked:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Contract audit is locked. Admin must unlock signing before editing module configs.",
        )
    import copy
    merged = copy.deepcopy(real.gate_module_configs or {})
    for mod, cfg in body.configs.items():
        if cfg == {}:
            # Explicit clear — frontend passes {} when the module is
            # removed from gate_contract_modules to drop its config.
            merged[mod] = {}
        else:
            existing = merged.get(mod) or {}
            merged[mod] = {**existing, **cfg}
    real.gate_module_configs = merged
    await db.commit()
    await db.refresh(real)
    from app.core.scope import invalidate_account
    invalidate_account(account_id)
    return await _serialise_with_name(
        real, db,
        can_sign=can_sign_account(user.role, is_assigned=is_assigned, is_team=is_team),
        can_unlock=can_unlock_signing(user.role),
    )


@router.patch("/{account_id}/contract-extras", response_model=SigningGateOut)
async def patch_contract_extras(
    account_id: Annotated[UUID, Path()],
    body: ContractExtrasUpdate,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SigningGateOut:
    """Merge audit-only extras (billing_freq, payment_terms, discount,
    geography, module_caveats, audit_notes, other_terms, tcv_override,
    audited_by name) into accounts.gate_contract_extras."""
    _scoped, is_assigned, is_team = await _scope(db, user, account_id)
    del _scoped
    if not can_sign_account(user.role, is_assigned=is_assigned, is_team=is_team):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Your role cannot edit contract extras",
        )
    real = (await db.execute(select(Account).where(Account.id == account_id))).scalar_one()
    if real.gate_signed and not real.gate_unlocked:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Contract audit is locked. Admin must unlock signing before editing contract extras.",
        )
    import copy
    merged = copy.deepcopy(real.gate_contract_extras or {})
    for k, v in body.extras.items():
        if v is None:
            merged.pop(k, None)
        else:
            merged[k] = v
    real.gate_contract_extras = merged
    await db.commit()
    await db.refresh(real)
    from app.core.scope import invalidate_account
    invalidate_account(account_id)
    return await _serialise_with_name(
        real, db,
        can_sign=can_sign_account(user.role, is_assigned=is_assigned, is_team=is_team),
        can_unlock=can_unlock_signing(user.role),
    )
