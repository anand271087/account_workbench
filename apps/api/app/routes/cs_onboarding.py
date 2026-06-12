"""M14 — CS Onboarding (Phase 5a) endpoints.

  GET   /accounts/:id/cs-onboarding   Read the entry + checklist + stakeholders block
  PATCH /accounts/:id/cs-onboarding   Whole-document update

PATCH semantics:
  * cs_handover_checklist + cs_stakeholders MERGE into the existing dict.
    Posting a partial dict updates only those keys.
  * cs_entry_type / cs_entry_b_context / cs_entry_b_goals are scalar — set
    or omit.

The tab itself becomes available once any one of these is true:
  * gate_signed = true       (Entry A — clean handover from Sales)
  * cs_entry_type = 'B'      (Entry B — CSM picked up mid-contract)
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
from app.routes.accounts import _team_member_ids
from app.schemas.cs_onboarding import (
    CSOnboardingOut,
    CSOnboardingUpdate,
    RealignClearIn,
    RealignOpenIn,
    UnlockCSHandoffIn,
)

router = APIRouter(prefix="/api/v1/accounts", tags=["cs_onboarding"])


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


# 12-Jun bug 239 — `_dedup_check` removed. Stakeholder feedback: POC,
# Budget Owner, and Primary Contact can legitimately be the same person
# at the client (e.g. small-team accounts where one director wears all
# three hats). The 409 was rejecting valid configurations.


def _serialise(acc: Account, *, editable: bool) -> CSOnboardingOut:
    out = CSOnboardingOut.model_validate(acc)
    # `activated` mirrors the prototype's view-gate: tab content is alive
    # once we have either a signed account or an explicit Entry-B opt-in.
    out.activated = bool(acc.gate_signed) or acc.cs_entry_type == "B"
    out.is_editable = editable
    return out


# ============================================================
# GET /accounts/:id/cs-onboarding
# ============================================================


@router.get("/{account_id}/cs-onboarding", response_model=CSOnboardingOut)
async def get_cs_onboarding(
    account_id: Annotated[UUID, Path()],
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> CSOnboardingOut:
    acc, is_assigned, is_team = await _scope(db, user, account_id)
    return _serialise(
        acc,
        editable=can_write_cs_onboarding(
            user.role, is_assigned=is_assigned, is_team=is_team
        ),
    )


# ============================================================
# PATCH /accounts/:id/cs-onboarding
# ============================================================


@router.patch("/{account_id}/cs-onboarding", response_model=CSOnboardingOut)
async def patch_cs_onboarding(
    account_id: Annotated[UUID, Path()],
    body: CSOnboardingUpdate,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> CSOnboardingOut:
    _, is_assigned, is_team = await _scope(db, user, account_id)
    if not can_write_cs_onboarding(
        user.role, is_assigned=is_assigned, is_team=is_team
    ):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Your role cannot edit CS Onboarding on this account",
        )

    real = (
        await db.execute(select(Account).where(Account.id == account_id))
    ).scalar_one()

    payload = body.model_dump(exclude_unset=True, mode="json")

    # Scalars: assign directly.
    for key in ("cs_entry_type", "cs_entry_b_context", "cs_entry_b_goals"):
        if key in payload:
            setattr(real, key, payload[key])

    # Dict columns: merge so partial updates don't blow away unrelated keys.
    if "cs_handover_checklist" in payload:
        merged = dict(real.cs_handover_checklist or {})
        merged.update(payload["cs_handover_checklist"])
        real.cs_handover_checklist = merged

    if "cs_stakeholders" in payload:
        merged = dict(real.cs_stakeholders or {})
        for role, value in payload["cs_stakeholders"].items():
            # value is a dict {name, email, phone} or fully-null dict to clear.
            existing = merged.get(role, {})
            if isinstance(existing, dict):
                existing = dict(existing)
            else:
                existing = {}
            existing.update(value or {})
            merged[role] = existing

        # 12-Jun bug 239 — Dedup guard removed. POC / Budget Owner / Primary
        # Contact CAN legitimately be the same person on small-team accounts.
        real.cs_stakeholders = merged

    # 03-Jun — cs_handoff is REPLACED whole (state machine), not merged.
    # The caller PATCHes the entire new state including null-ing the
    # realignment when resolved.
    if "cs_handoff" in payload:
        real.cs_handoff = payload["cs_handoff"] or {}

    real.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(real)

    from app.core.scope import invalidate_account
    invalidate_account(account_id)

    return _serialise(real, editable=True)


# ============================================================
# Realignment flow
#
# `/realign`         — CSM sends a block back upstream.
# `/realign/clear`   — Either Resolve (upstream fixed it) or Cancel
#                       (CSM rescinded). Audit-distinct via `mode`.
#
# Opening a realignment cascades an unlock on BOTH the Sales Handoff
# lock (sh_locked_at → null) AND the Signing gate (gate_unlocked = true).
# This bypasses the admin-only gate on /sign/unlock because the CSM's
# realignment IS the authorisation event — the note becomes the unlock
# reason on both locks so the audit trail stays single-sourced.
#
# Resolve and Cancel both leave the locks open — re-locking is the
# upstream owner's job via their normal flows.
# ============================================================


_BLOCK_OWNERS = {
    "Commercial": "Contract Ops",
    "Client": "Sales",
    "Commitment": "Sales",
}


@router.post("/{account_id}/cs-onboarding/realign", response_model=CSOnboardingOut)
async def open_realignment(
    account_id: Annotated[UUID, Path()],
    body: RealignOpenIn,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> CSOnboardingOut:
    _, is_assigned, is_team = await _scope(db, user, account_id)
    if not can_write_cs_onboarding(
        user.role, is_assigned=is_assigned, is_team=is_team
    ):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Your role cannot open a re-alignment on this account",
        )

    real = (
        await db.execute(select(Account).where(Account.id == account_id))
    ).scalar_one()

    handoff = dict(real.cs_handoff or {})
    existing = handoff.get("realignment") or None
    now_iso = datetime.now(timezone.utc).isoformat()

    handoff["realignment"] = {
        "block": body.block,
        "note": body.note.strip(),
        # Preserve the original sent_at when editing an in-flight realignment.
        "sent_at": (existing or {}).get("sent_at") or now_iso,
        "sent_to": _BLOCK_OWNERS[body.block],
    }
    real.cs_handoff = handoff

    # Cascade unlock — only on first open (not on edit-of-existing) so we
    # don't keep stamping new unlock metadata on every note tweak.
    if not existing:
        unlock_reason = f"Re-aligned by CSM: {body.note.strip()[:300]}"
        if real.gate_signed and not real.gate_unlocked:
            real.gate_unlocked = True
            real.gate_unlock_reason = unlock_reason
            real.gate_unlocked_by = user.id
            real.gate_unlocked_at = datetime.now(timezone.utc)
        if real.sh_locked_at is not None:
            real.sh_locked_at = None
            real.sh_locked_by = None

    real.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(real)

    from app.core.scope import invalidate_account
    invalidate_account(account_id)

    return _serialise(real, editable=True)


@router.post(
    "/{account_id}/cs-onboarding/realign/clear", response_model=CSOnboardingOut
)
async def clear_realignment(
    account_id: Annotated[UUID, Path()],
    body: RealignClearIn,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> CSOnboardingOut:
    """Resolve OR Cancel a pending realignment.

    Does NOT auto-re-lock Sales Handoff or Signing. Upstream owners
    handle that via their own lock flows when they're ready.
    """
    _, is_assigned, is_team = await _scope(db, user, account_id)
    if not can_write_cs_onboarding(
        user.role, is_assigned=is_assigned, is_team=is_team
    ):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Your role cannot clear this re-alignment",
        )

    real = (
        await db.execute(select(Account).where(Account.id == account_id))
    ).scalar_one()

    handoff = dict(real.cs_handoff or {})
    existing = handoff.get("realignment") or None
    if not existing:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "No re-alignment is currently in flight.",
        )

    # Audit trail: stash the cleared realignment + mode in a small log
    # so leadership can later see resolved-vs-cancelled stats. Bounded
    # to last 20 entries to avoid jsonb bloat.
    log = list(handoff.get("realignment_log") or [])
    log.append({
        **existing,
        "cleared_mode": body.mode,
        "cleared_at": datetime.now(timezone.utc).isoformat(),
        "cleared_by": str(user.id),
    })
    handoff["realignment_log"] = log[-20:]
    handoff["realignment"] = None
    real.cs_handoff = handoff

    real.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(real)

    from app.core.scope import invalidate_account
    invalidate_account(account_id)

    return _serialise(real, editable=True)


# ============================================================
# POST /accounts/:id/cs-onboarding/unlock — admin only
#
# Reverts a started Success Journey back to Stage 1. Clears
# cs_handoff.started + started_at. Stamps the reason into
# cs_handoff.unlock_log so the audit trail survives.
#
# Admin-only by design — same asymmetry as M13 signing unlock,
# M19 contract unlock, M22 VDD unlock, M23 outcome reopen.
# CSMs can start; only directors can walk it back.
# ============================================================


@router.post(
    "/{account_id}/cs-onboarding/unlock", response_model=CSOnboardingOut
)
async def unlock_cs_handoff(
    account_id: Annotated[UUID, Path()],
    body: UnlockCSHandoffIn,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> CSOnboardingOut:
    _, is_assigned, is_team = await _scope(db, user, account_id)
    if not is_global_admin(user.role):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Only admins / directors can unlock CS Handoff",
        )

    real = (
        await db.execute(select(Account).where(Account.id == account_id))
    ).scalar_one()

    handoff = dict(real.cs_handoff or {})
    if not handoff.get("started"):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "CS Handoff hasn't been started — nothing to unlock.",
        )

    log = list(handoff.get("unlock_log") or [])
    log.append({
        "reason": body.reason.strip(),
        "unlocked_at": datetime.now(timezone.utc).isoformat(),
        "unlocked_by": str(user.id),
        "previous_started_at": handoff.get("started_at"),
    })
    handoff["unlock_log"] = log[-20:]
    handoff["started"] = False
    handoff["started_at"] = None
    real.cs_handoff = handoff

    real.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(real)

    from app.core.scope import invalidate_account
    invalidate_account(account_id)

    return _serialise(
        real,
        editable=can_write_cs_onboarding(
            user.role, is_assigned=is_assigned, is_team=is_team
        ),
    )
