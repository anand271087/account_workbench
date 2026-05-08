"""AK03.d — Solutioning structured fields + Handover-to-Solutioning action.

Per Roles_Access_Matrix_Reviewed_05072026.xlsx (Solutioning Documents row):
- F (all) for Solutioning Manager + global admins
- V for everyone else (CSM/CO/VPs/Inside Sales)

Auto-extract: when a VPD document finishes processing in the Celery worker,
it writes candidate values into account_solutioning. The user reviews and
saves them via PATCH; saving flips ai_edited=true.

Handover: any role with edit on the engagement record can mark the account
"handed off" — symbolic gate that flips a flag on `accounts`. The Solutioning
tab shows differently before/after handover.
"""

from datetime import datetime, timezone
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Path, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser
from app.core.rbac import can_view_account, can_write_engagement, can_write_solutioning
from app.db.session import get_db
from app.models.account import Account
from app.models.solutioning import AccountSolutioning
from app.routes.accounts import _team_member_ids
from app.schemas.solutioning import HandoverOut, SolutioningOut, SolutioningUpdate

router = APIRouter(prefix="/api/v1/accounts", tags=["solutioning"])


async def _scope(db: AsyncSession, user, account_id: UUID) -> tuple[Account, bool, bool]:
    from app.core.scope import get_account_row

    acc = await get_account_row(db, account_id)
    is_assigned = (acc.csm_user_id == user.id) or (acc.co_user_id == user.id)
    team_ids = await _team_member_ids(db, user) if user.role == "cs_team_manager" else set()
    is_team = acc.csm_user_id in team_ids if team_ids else False
    if not can_view_account(user.role, is_assigned=is_assigned, is_team=is_team):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Forbidden on this account")
    return acc, is_assigned, is_team


@router.get("/{account_id}/solutioning", response_model=SolutioningOut)
async def get_solutioning(
    account_id: Annotated[UUID, Path()],
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SolutioningOut:
    _, is_assigned, is_team = await _scope(db, user, account_id)

    row = (
        await db.execute(
            select(AccountSolutioning).where(AccountSolutioning.account_id == account_id)
        )
    ).scalar_one_or_none()

    if row is None:
        # Return a blank record so the form can render before the first save.
        row = AccountSolutioning(
            account_id=account_id,
            value_themes=[],
            ai_edited=False,
            updated_at=datetime.utcnow(),
        )

    out = SolutioningOut.model_validate(row)
    out.is_editable = can_write_solutioning(user.role, is_assigned=is_assigned, is_team=is_team)
    return out


@router.patch("/{account_id}/solutioning", response_model=SolutioningOut)
async def patch_solutioning(
    account_id: Annotated[UUID, Path()],
    body: SolutioningUpdate,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SolutioningOut:
    _, is_assigned, is_team = await _scope(db, user, account_id)
    if not can_write_solutioning(user.role, is_assigned=is_assigned, is_team=is_team):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Your role cannot edit solutioning fields on this account"
        )

    row = (
        await db.execute(
            select(AccountSolutioning).where(AccountSolutioning.account_id == account_id)
        )
    ).scalar_one_or_none()
    is_first_save = row is None
    if is_first_save:
        row = AccountSolutioning(account_id=account_id, value_themes=[])
        db.add(row)

    payload = body.model_dump(exclude_unset=True)
    # If the user changed any AI-extracted field, mark as AI-assisted (BRD §4.3.d).
    user_touched_ai_field = any(
        k in payload
        for k in (
            "proposed_solution",
            "engagement_type",
            "engagement_duration_months",
            "value_themes",
            "value_definition",
            "estimated_value_musd",
        )
    )
    for field, value in payload.items():
        setattr(row, field, value)
    if user_touched_ai_field and row.ai_extracted_at is not None:
        row.ai_edited = True
    row.updated_at = datetime.now(timezone.utc)
    row.updated_by = user.id

    await db.commit()
    await db.refresh(row)

    out = SolutioningOut.model_validate(row)
    out.is_editable = True
    return out


# ============================================================
# POST /accounts/:id/handover-to-solutioning
# ============================================================


@router.post("/{account_id}/handover-to-solutioning", response_model=HandoverOut)
async def handover(
    account_id: Annotated[UUID, Path()],
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> HandoverOut:
    """Pre-Sales → Solutioning gate (BRD §4.3.c).

    Anyone who can edit engagement info on the account can mark it handed
    off. Idempotent: re-calling on an already-handed-off account is a no-op
    (returns current state).
    """
    acc, is_assigned, is_team = await _scope(db, user, account_id)
    if not can_write_engagement(user.role, is_assigned=is_assigned, is_team=is_team):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "You cannot trigger handover on this account"
        )
    if acc.handed_off_to_solutioning:
        return HandoverOut(
            account_id=acc.id,
            handed_off_to_solutioning=True,
            handed_off_at=acc.handed_off_at,
            handed_off_by=acc.handed_off_by,
        )

    # The cached `acc` is transient — fetch a real attached row before mutating.
    real = (
        await db.execute(select(Account).where(Account.id == account_id))
    ).scalar_one()
    real.handed_off_to_solutioning = True
    real.handed_off_at = datetime.now(timezone.utc)
    real.handed_off_by = user.id
    await db.commit()
    await db.refresh(real)
    from app.core.scope import invalidate_account
    invalidate_account(account_id)
    return HandoverOut(
        account_id=real.id,
        handed_off_to_solutioning=real.handed_off_to_solutioning,
        handed_off_at=real.handed_off_at,
        handed_off_by=real.handed_off_by,
    )
