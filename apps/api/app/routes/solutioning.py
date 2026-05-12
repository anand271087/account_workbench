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
from app.schemas.solutioning import (
    HandoverOut,
    SolutioningLockOut,
    SolutioningOut,
    SolutioningUpdate,
)

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
    # Two paths to is_editable: pre-lock solutioning write, or Sales Hand-off
    # write (sh_* fields). Front-end uses is_editable as a coarse signal;
    # the PATCH handler enforces per-field permission for the strict cut.
    from app.core.rbac import can_write_sales_handoff
    role_can_write_sol = can_write_solutioning(
        user.role, is_assigned=is_assigned, is_team=is_team
    )
    role_can_write_sh = can_write_sales_handoff(
        user.role, is_assigned=is_assigned, is_team=is_team
    )
    out.is_editable = (role_can_write_sol and row.locked_at is None) or role_can_write_sh
    return out


@router.patch("/{account_id}/solutioning", response_model=SolutioningOut)
async def patch_solutioning(
    account_id: Annotated[UUID, Path()],
    body: SolutioningUpdate,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SolutioningOut:
    _, is_assigned, is_team = await _scope(db, user, account_id)

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

    # Split the payload by ownership:
    #   * Solutioning fields — the value definition itself. Locked once
    #     sales hand-off begins; only solutioning_manager + admins write
    #     these pre-lock.
    #   * Sales hand-off fields (sh_*) — filled in by Sales / CO AFTER lock.
    #     A different RBAC predicate (can_write_sales_handoff) gates them.
    SH_FIELDS = {
        "sh_value_validation",
        "sh_validation_notes",
        "sh_go_live_date",
        "sh_first_checkpoint",
        "sh_stakeholder_signoff",
        "sh_commercial_context",
        "sales_watchouts",
        "handoff_file_name",
    }
    sol_fields = {k: v for k, v in payload.items() if k not in SH_FIELDS}
    sh_fields = {k: v for k, v in payload.items() if k in SH_FIELDS}

    # ---- Solutioning fields: lock-aware, solutioning-write permission ----
    if sol_fields:
        if not can_write_solutioning(user.role, is_assigned=is_assigned, is_team=is_team):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Your role cannot edit solutioning fields on this account",
            )
        if row.locked_at is not None and not is_first_save:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "Solutioning is locked for Sales Hand-off — unlock before editing.",
            )
        # Mark as AI-assisted when an AI-extracted field is touched.
        from app.core.rbac import can_write_sales_handoff  # local import to avoid cycle
        user_touched_ai_field = any(
            k in sol_fields
            for k in (
                "proposed_solution",
                "engagement_type",
                "engagement_duration_months",
                "value_themes",
                "value_definition",
                "estimated_value_musd",
            )
        )
        for field, value in sol_fields.items():
            setattr(row, field, value)
        if user_touched_ai_field and row.ai_extracted_at is not None:
            row.ai_edited = True
        # silence unused-import linter
        _ = can_write_sales_handoff

    # ---- sh_* fields: separate permission, no lock check ----
    if sh_fields:
        from app.core.rbac import can_write_sales_handoff
        if not can_write_sales_handoff(
            user.role, is_assigned=is_assigned, is_team=is_team
        ):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Your role cannot edit Sales Hand-off fields on this account",
            )
        for field, value in sh_fields.items():
            setattr(row, field, value)

    row.updated_at = datetime.now(timezone.utc)
    row.updated_by = user.id
    await db.commit()
    await db.refresh(row)

    out = SolutioningOut.model_validate(row)
    # Compute is_editable from the union — if either side can edit, true.
    from app.core.rbac import can_write_sales_handoff
    out.is_editable = (
        can_write_solutioning(user.role, is_assigned=is_assigned, is_team=is_team)
        and row.locked_at is None
    ) or can_write_sales_handoff(
        user.role, is_assigned=is_assigned, is_team=is_team
    )
    return out


# ============================================================
# POST /accounts/:id/solutioning/lock  +  /unlock
# ============================================================


async def _get_or_create_solutioning_row(
    db: AsyncSession, account_id: UUID
) -> AccountSolutioning:
    row = (
        await db.execute(
            select(AccountSolutioning).where(AccountSolutioning.account_id == account_id)
        )
    ).scalar_one_or_none()
    if row is None:
        row = AccountSolutioning(account_id=account_id, value_themes=[])
        db.add(row)
        await db.flush()
    return row


@router.post("/{account_id}/solutioning/lock", response_model=SolutioningLockOut)
async def lock_solutioning(
    account_id: Annotated[UUID, Path()],
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SolutioningLockOut:
    """Solutioning → Sales Hand-off lock.

    Anyone with edit on solutioning can lock. Idempotent: re-calling on a
    locked row is a no-op (returns current state). Requires a value definition
    so we don't hand an empty contract to Sales.
    """
    _, is_assigned, is_team = await _scope(db, user, account_id)
    if not can_write_solutioning(user.role, is_assigned=is_assigned, is_team=is_team):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "You cannot lock solutioning on this account"
        )

    row = await _get_or_create_solutioning_row(db, account_id)
    if row.locked_at is not None:
        return SolutioningLockOut(
            account_id=account_id, locked_at=row.locked_at, locked_by=row.locked_by
        )

    if not (row.value_definition and row.value_definition.strip()):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Cannot lock without a value definition — fill it before passing to Sales.",
        )

    now = datetime.now(timezone.utc)
    row.locked_at = now
    row.locked_by = user.id
    # Snapshot the value definition + themes into the sh_* fields so Sales
    # sees exactly what Solutioning passed at lock-time. Don't overwrite if
    # they've already been populated (re-lock after unlock leaves the prior
    # snapshot in place — Sales's edits to sh_* shouldn't be clobbered).
    if not row.sh_value_from_solutioning:
        row.sh_value_from_solutioning = row.value_definition
    if not row.sh_value_themes_from_solutioning:
        row.sh_value_themes_from_solutioning = ", ".join(row.value_themes or [])
    if not row.sh_value_received_at:
        row.sh_value_received_at = now
    row.updated_at = now
    row.updated_by = user.id
    await db.commit()
    await db.refresh(row)
    return SolutioningLockOut(
        account_id=account_id, locked_at=row.locked_at, locked_by=row.locked_by
    )


@router.post("/{account_id}/solutioning/unlock", response_model=SolutioningLockOut)
async def unlock_solutioning(
    account_id: Annotated[UUID, Path()],
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SolutioningLockOut:
    """Re-open a locked solutioning record. Same write permission as lock."""
    _, is_assigned, is_team = await _scope(db, user, account_id)
    if not can_write_solutioning(user.role, is_assigned=is_assigned, is_team=is_team):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "You cannot unlock solutioning on this account"
        )

    row = await _get_or_create_solutioning_row(db, account_id)
    if row.locked_at is None:
        return SolutioningLockOut(account_id=account_id, locked_at=None, locked_by=None)

    row.locked_at = None
    row.locked_by = None
    row.updated_at = datetime.now(timezone.utc)
    row.updated_by = user.id
    await db.commit()
    await db.refresh(row)
    return SolutioningLockOut(account_id=account_id, locked_at=None, locked_by=None)


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
