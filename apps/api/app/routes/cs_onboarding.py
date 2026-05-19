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
from app.core.rbac import can_view_account, can_write_cs_onboarding
from app.db.session import get_db
from app.models.account import Account
from app.routes.accounts import _team_member_ids
from app.schemas.cs_onboarding import (
    CSOnboardingOut,
    CSOnboardingUpdate,
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


def _dedup_check(stakeholders: dict) -> None:
    """Reject a stakeholder map where two roles share the same name or email.

    Comparison is case-insensitive on the trimmed value. Rows where both
    name and email are blank are skipped (an unfilled role isn't a dup).
    """
    seen_names: dict[str, str] = {}
    seen_emails: dict[str, str] = {}
    for role, info in stakeholders.items():
        if not isinstance(info, dict):
            continue
        raw_name = (info.get("name") or "").strip().lower()
        raw_email = (info.get("email") or "").strip().lower()
        if not raw_name and not raw_email:
            continue
        if raw_name and raw_name in seen_names:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"Stakeholder name \"{info.get('name')}\" is already used by the "
                f"{seen_names[raw_name].replace('_', ' ')} role. Pick a different person.",
            )
        if raw_email and raw_email in seen_emails:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"Stakeholder email \"{info.get('email')}\" is already used by the "
                f"{seen_emails[raw_email].replace('_', ' ')} role. Pick a different person.",
            )
        if raw_name:
            seen_names[raw_name] = role
        if raw_email:
            seen_emails[raw_email] = role


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

        # Dedup guard: the 3-role stakeholder map must not reuse the same
        # person (case-insensitive name OR email) across roles. CSMs were
        # accidentally listing the same Budget Owner as Champion which
        # rolled up as 2 distinct stakeholders downstream.
        _dedup_check(merged)
        real.cs_stakeholders = merged

    real.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(real)

    from app.core.scope import invalidate_account
    invalidate_account(account_id)

    return _serialise(real, editable=True)
