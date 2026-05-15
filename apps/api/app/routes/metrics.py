"""M20 — Success Metric endpoints.

  GET    /accounts/:id/metrics              List active metrics (admin can ?include_deleted)
  POST   /accounts/:id/metrics              Create a metric
  PATCH  /metrics/:metric_id                Partial update (name / target / type / override)
  POST   /metrics/:metric_id/log            Append a value-log entry (also updates current_value)
  DELETE /metrics/:metric_id                Soft delete with reason
  POST   /metrics/:metric_id/restore        Admin-only

Permission: same write set as CS Onboarding (`can_write_cs_onboarding`).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated
from uuid import UUID, uuid4

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
from app.models.metric import SuccessMetric
from app.routes.accounts import _team_member_ids
from app.schemas.metric import (
    MetricCreate,
    MetricDelete,
    MetricListOut,
    MetricOut,
    MetricUpdate,
    MetricValueLog,
    derive_status,
)

account_router = APIRouter(prefix="/api/v1/accounts", tags=["metrics"])
metric_router = APIRouter(prefix="/api/v1/metrics", tags=["metrics"])


# ============================================================
# Helpers
# ============================================================


async def _scope(
    db: AsyncSession, user, account_id: UUID
) -> tuple[bool, bool]:
    from app.core.scope import get_account_row

    acc = await get_account_row(db, account_id)
    is_assigned = (acc.csm_user_id == user.id) or (acc.co_user_id == user.id)
    team_ids = (
        await _team_member_ids(db, user) if user.role == "cs_team_manager" else set()
    )
    is_team = acc.csm_user_id in team_ids if team_ids else False
    if not can_view_account(user.role, is_assigned=is_assigned, is_team=is_team):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Forbidden on this account")
    return is_assigned, is_team


async def _scope_for_metric(
    db: AsyncSession, user, metric_id: UUID, *, allow_deleted: bool = False
) -> tuple[SuccessMetric, bool, bool]:
    stmt = select(SuccessMetric).where(SuccessMetric.id == metric_id)
    if not allow_deleted:
        stmt = stmt.where(SuccessMetric.deleted_at.is_(None))
    metric = (await db.execute(stmt)).scalar_one_or_none()
    if metric is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Metric not found")
    is_assigned, is_team = await _scope(db, user, metric.account_id)
    return metric, is_assigned, is_team


def _serialise(m: SuccessMetric, *, editable: bool) -> MetricOut:
    out = MetricOut.model_validate(m)
    out.status = derive_status(
        metric_type=m.metric_type,
        target_value=m.target_value,
        current_value=m.current_value,
        status_override=m.status_override,
    )
    out.is_editable = editable
    return out


# ============================================================
# GET /accounts/:id/metrics
# ============================================================


@account_router.get(
    "/{account_id}/metrics", response_model=MetricListOut
)
async def list_metrics(
    account_id: Annotated[UUID, Path()],
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    include_deleted: bool = Query(False, description="Admin only"),
) -> MetricListOut:
    is_assigned, is_team = await _scope(db, user, account_id)
    editable = can_write_cs_onboarding(
        user.role, is_assigned=is_assigned, is_team=is_team
    )

    stmt = (
        select(SuccessMetric)
        .where(SuccessMetric.account_id == account_id)
        .order_by(SuccessMetric.created_at.asc())
    )
    if include_deleted and is_global_admin(user.role):
        pass  # no extra filter
    else:
        stmt = stmt.where(SuccessMetric.deleted_at.is_(None))

    rows = (await db.execute(stmt)).scalars().all()
    items = [_serialise(m, editable=editable) for m in rows]
    return MetricListOut(items=items, total=len(items), is_editable=editable)


# ============================================================
# POST /accounts/:id/metrics
# ============================================================


@account_router.post(
    "/{account_id}/metrics", response_model=MetricOut, status_code=status.HTTP_201_CREATED
)
async def create_metric(
    account_id: Annotated[UUID, Path()],
    body: MetricCreate,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> MetricOut:
    is_assigned, is_team = await _scope(db, user, account_id)
    if not can_write_cs_onboarding(
        user.role, is_assigned=is_assigned, is_team=is_team
    ):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Cannot create metrics on this account"
        )

    metric = SuccessMetric(
        account_id=account_id,
        name=body.name,
        description=body.description,
        metric_type=body.metric_type,
        unit=body.unit,
        target_value=body.target_value,
        created_by=user.id,
    )
    db.add(metric)
    await db.commit()
    await db.refresh(metric)
    return _serialise(metric, editable=True)


# ============================================================
# PATCH /metrics/:metric_id
# ============================================================


@metric_router.patch("/{metric_id}", response_model=MetricOut)
async def patch_metric(
    metric_id: Annotated[UUID, Path()],
    body: MetricUpdate,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> MetricOut:
    metric, is_assigned, is_team = await _scope_for_metric(db, user, metric_id)
    if not can_write_cs_onboarding(
        user.role, is_assigned=is_assigned, is_team=is_team
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Cannot edit this metric")

    payload = body.model_dump(exclude_unset=True, mode="json")
    for k, v in payload.items():
        setattr(metric, k, v)
    metric.updated_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(metric)
    return _serialise(metric, editable=True)


# ============================================================
# POST /metrics/:metric_id/log — append a value-log entry
# ============================================================


@metric_router.post("/{metric_id}/log", response_model=MetricOut)
async def log_metric_value(
    metric_id: Annotated[UUID, Path()],
    body: MetricValueLog,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> MetricOut:
    metric, is_assigned, is_team = await _scope_for_metric(db, user, metric_id)
    if not can_write_cs_onboarding(
        user.role, is_assigned=is_assigned, is_team=is_team
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Cannot log values on this metric")

    now = datetime.now(timezone.utc)
    entry = {
        "id": str(uuid4()),
        "at": now.isoformat(),
        "by": str(user.id),
        "by_name": getattr(user, "full_name", None),
        "value": body.value,
        "source": body.source,
        "note": body.note,
    }

    # Rebind list — SQLAlchemy doesn't auto-detect mutation on JSONB arrays.
    metric.log_entries = (metric.log_entries or []) + [entry]
    metric.current_value = body.value
    metric.last_updated_at = now
    metric.last_updated_by = user.id
    metric.updated_at = now

    await db.commit()
    await db.refresh(metric)
    return _serialise(metric, editable=True)


# ============================================================
# DELETE /metrics/:metric_id  (soft, with reason)
# ============================================================


@metric_router.delete("/{metric_id}", response_model=MetricOut)
async def soft_delete_metric(
    metric_id: Annotated[UUID, Path()],
    body: MetricDelete,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> MetricOut:
    metric, is_assigned, is_team = await _scope_for_metric(db, user, metric_id)
    if not can_write_cs_onboarding(
        user.role, is_assigned=is_assigned, is_team=is_team
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Cannot delete this metric")

    metric.deleted_at = datetime.now(timezone.utc)
    metric.deleted_by = user.id
    metric.deleted_reason = body.reason
    metric.updated_at = metric.deleted_at

    await db.commit()
    await db.refresh(metric)
    return _serialise(metric, editable=True)


# ============================================================
# POST /metrics/:metric_id/restore  (admin only)
# ============================================================


@metric_router.post("/{metric_id}/restore", response_model=MetricOut)
async def restore_metric(
    metric_id: Annotated[UUID, Path()],
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> MetricOut:
    if not is_global_admin(user.role):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Only admins can restore metrics"
        )

    metric, _, _ = await _scope_for_metric(db, user, metric_id, allow_deleted=True)
    if metric.deleted_at is None:
        return _serialise(metric, editable=True)  # idempotent

    metric.deleted_at = None
    metric.deleted_by = None
    metric.deleted_reason = None
    metric.updated_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(metric)
    return _serialise(metric, editable=True)
