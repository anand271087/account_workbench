"""M14b — CS Goal Validation & Alignment endpoints.

Account-scoped:
  GET    /accounts/:id/cs-goals                List goals on an account
  POST   /accounts/:id/cs-goals                Create a new goal

Goal-scoped:
  GET    /cs-goals/:goal_id                    Single goal (incl history)
  PATCH  /cs-goals/:goal_id                    Whole-document update
  DELETE /cs-goals/:goal_id                    Soft delete (reason required)
  POST   /cs-goals/:goal_id/restore            Restore (admin only)

History append: every successful PATCH / DELETE / restore appends one
business-level event to `cs_goals.history`. This is distinct from the
field-level diffs the audit_writer service captures in `audit_log` —
both coexist and serve different consumers.

Alignment status auto-derivation: when PATCH includes phase_a / phase_b
/ phase_c, we re-derive alignment_status from the `*_complete` flags
(none → not_started, some → partial, all → aligned). The caller can
override via an explicit alignment_status in the same PATCH.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
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
from app.routes.accounts import _team_member_ids
from app.schemas.cs_goal import (
    CSGoalCreate,
    CSGoalDelete,
    CSGoalListOut,
    CSGoalOut,
    CSGoalUpdate,
)

# Two routers — one account-scoped, one goal-scoped. Same handlers
# wouldn't compose cleanly otherwise (prefix conflict).
account_router = APIRouter(prefix="/api/v1/accounts", tags=["cs_goals"])
goal_router = APIRouter(prefix="/api/v1/cs-goals", tags=["cs_goals"])


# ============================================================
# Scope helpers
# ============================================================


async def _account_scope(
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


async def _goal_scope(
    db: AsyncSession, user, goal_id: UUID
) -> tuple[CSGoal, bool, bool]:
    """Load the goal + run RBAC against its parent account."""
    goal = (
        await db.execute(select(CSGoal).where(CSGoal.id == goal_id))
    ).scalar_one_or_none()
    if goal is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Goal not found")
    _, is_assigned, is_team = await _account_scope(db, user, goal.account_id)
    return goal, is_assigned, is_team


def _serialise(goal: CSGoal, *, editable: bool) -> CSGoalOut:
    out = CSGoalOut.model_validate(goal)
    out.is_editable = editable
    return out


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _derive_alignment(phase_a: dict, phase_b: dict, phase_c: dict) -> str:
    """not_started / partial / aligned from the three phase_complete flags."""
    flags = [
        bool((phase_a or {}).get("phase_a_complete")),
        bool((phase_b or {}).get("phase_b_complete")),
        bool((phase_c or {}).get("phase_c_complete")),
    ]
    if all(flags):
        return "aligned"
    if any(flags):
        return "partial"
    return "not_started"


def _push_history(goal: CSGoal, **entry) -> None:
    """Append one entry to goal.history. Always sets `at` and `by`."""
    record = {"at": _now().isoformat(), **entry}
    # SQLAlchemy doesn't auto-detect mutations on JSONB lists — rebind.
    goal.history = list(goal.history or []) + [record]


# ============================================================
# Account-scoped: list + create
# ============================================================


@account_router.get(
    "/{account_id}/cs-goals", response_model=CSGoalListOut
)
async def list_cs_goals(
    account_id: Annotated[UUID, Path()],
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    include_deleted: Annotated[bool, Query()] = False,
) -> CSGoalListOut:
    _, is_assigned, is_team = await _account_scope(db, user, account_id)

    stmt = select(CSGoal).where(CSGoal.account_id == account_id)
    if not include_deleted:
        stmt = stmt.where(CSGoal.deleted_at.is_(None))
    stmt = stmt.order_by(CSGoal.created_at.asc())
    rows = (await db.execute(stmt)).scalars().all()

    editable = can_write_cs_onboarding(
        user.role, is_assigned=is_assigned, is_team=is_team
    )
    return CSGoalListOut(items=[_serialise(g, editable=editable) for g in rows])


@account_router.post(
    "/{account_id}/cs-goals", response_model=CSGoalOut, status_code=201
)
async def create_cs_goal(
    account_id: Annotated[UUID, Path()],
    body: CSGoalCreate,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> CSGoalOut:
    _, is_assigned, is_team = await _account_scope(db, user, account_id)
    if not can_write_cs_onboarding(
        user.role, is_assigned=is_assigned, is_team=is_team
    ):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Your role cannot create goals on this account"
        )

    goal = CSGoal(
        account_id=account_id,
        title=body.title,
        category=body.category,
        target_value=body.target_value,
        target_date=body.target_date,
        owner=body.owner,
        alignment_status="not_started",
        phase_a={},
        phase_b={},
        phase_c={},
        initiatives=[],
        history=[],
        created_by=user.id,
        updated_by=user.id,
    )
    _push_history(
        goal,
        by=str(user.id),
        action="created",
        new_value={"title": body.title, "category": body.category},
    )
    db.add(goal)
    await db.commit()
    await db.refresh(goal)
    return _serialise(goal, editable=True)


# ============================================================
# Goal-scoped: get / update / delete / restore
# ============================================================


@goal_router.get("/{goal_id}", response_model=CSGoalOut)
async def get_cs_goal(
    goal_id: Annotated[UUID, Path()],
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> CSGoalOut:
    goal, is_assigned, is_team = await _goal_scope(db, user, goal_id)
    return _serialise(
        goal,
        editable=can_write_cs_onboarding(
            user.role, is_assigned=is_assigned, is_team=is_team
        ),
    )


@goal_router.patch("/{goal_id}", response_model=CSGoalOut)
async def patch_cs_goal(
    goal_id: Annotated[UUID, Path()],
    body: CSGoalUpdate,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> CSGoalOut:
    goal, is_assigned, is_team = await _goal_scope(db, user, goal_id)
    if not can_write_cs_onboarding(
        user.role, is_assigned=is_assigned, is_team=is_team
    ):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Your role cannot edit this goal"
        )
    if goal.deleted_at is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Goal is soft-deleted — restore it before editing.",
        )

    payload = body.model_dump(exclude_unset=True, mode="json")

    # Track which phase transitioned from incomplete → complete so the
    # history entry is informative.
    completed_phases: list[str] = []
    for phase_key in ("phase_a", "phase_b", "phase_c"):
        if phase_key not in payload:
            continue
        flag_key = f"{phase_key}_complete"
        was_complete = bool((getattr(goal, phase_key) or {}).get(flag_key))
        now_complete = bool(payload[phase_key].get(flag_key))
        if now_complete and not was_complete:
            completed_phases.append(phase_key)

    # Apply scalars + phases + initiatives.
    for key in (
        "title", "category", "target_value", "target_date", "owner",
        "alignment_status", "phase_a", "phase_b", "phase_c", "initiatives",
    ):
        if key in payload:
            setattr(goal, key, payload[key])

    # Auto-derive alignment if the caller didn't explicitly set it.
    if "alignment_status" not in payload and any(
        k in payload for k in ("phase_a", "phase_b", "phase_c")
    ):
        goal.alignment_status = _derive_alignment(
            goal.phase_a, goal.phase_b, goal.phase_c
        )

    # Append history. One entry per phase completion, plus one generic
    # 'updated' entry if there are other changes.
    for phase in completed_phases:
        _push_history(goal, by=str(user.id), action=f"{phase}_completed")
    non_phase_changes = {
        k: v
        for k, v in payload.items()
        if k not in ("phase_a", "phase_b", "phase_c")
    }
    if non_phase_changes:
        _push_history(
            goal,
            by=str(user.id),
            action="updated",
            new_value=non_phase_changes,
        )

    goal.updated_at = _now()
    goal.updated_by = user.id
    await db.commit()
    await db.refresh(goal)
    return _serialise(goal, editable=True)


@goal_router.delete("/{goal_id}", response_model=CSGoalOut)
async def soft_delete_cs_goal(
    goal_id: Annotated[UUID, Path()],
    body: CSGoalDelete,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> CSGoalOut:
    """Soft delete — reason required. The row stays in the table so the
    audit trail (incl this delete event) survives."""
    goal, is_assigned, is_team = await _goal_scope(db, user, goal_id)
    if not can_write_cs_onboarding(
        user.role, is_assigned=is_assigned, is_team=is_team
    ):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Your role cannot delete this goal"
        )
    if goal.deleted_at is not None:
        return _serialise(goal, editable=False)

    goal.deleted_at = _now()
    goal.deleted_reason = body.reason
    goal.deleted_by = user.id
    goal.updated_at = goal.deleted_at
    goal.updated_by = user.id
    _push_history(
        goal,
        by=str(user.id),
        action="soft_deleted",
        reason=body.reason,
    )
    await db.commit()
    await db.refresh(goal)
    return _serialise(goal, editable=False)


@goal_router.post("/{goal_id}/restore", response_model=CSGoalOut)
async def restore_cs_goal(
    goal_id: Annotated[UUID, Path()],
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> CSGoalOut:
    """Admin only — clears soft-delete state. Captures a history entry so
    the trail records who restored when."""
    goal, is_assigned, is_team = await _goal_scope(db, user, goal_id)
    if not is_global_admin(user.role):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Only admins can restore deleted goals"
        )
    if goal.deleted_at is None:
        return _serialise(
            goal,
            editable=can_write_cs_onboarding(
                user.role, is_assigned=is_assigned, is_team=is_team
            ),
        )

    goal.deleted_at = None
    goal.deleted_reason = None
    goal.deleted_by = None
    goal.updated_at = _now()
    goal.updated_by = user.id
    _push_history(goal, by=str(user.id), action="restored")
    await db.commit()
    await db.refresh(goal)
    return _serialise(
        goal,
        editable=can_write_cs_onboarding(
            user.role, is_assigned=is_assigned, is_team=is_team
        ),
    )
