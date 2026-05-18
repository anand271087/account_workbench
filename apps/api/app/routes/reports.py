"""M31 — Reports endpoints.

  GET /accounts/:id/reports/qbr           QBR HTML
  GET /accounts/:id/reports/mbr           MBR HTML
  GET /accounts/:id/reports/utilization   Utilization HTML

Each returns a self-contained HTML document — the frontend renders it
inside an iframe preview + offers "Download HTML". PPT/PDF export is
deferred to v1.1.
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Path, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser
from app.core.rbac import can_view_account
from app.core.scope import get_account_row
from app.db.session import get_db
from app.models.account import Account
from app.models.checkpoint import Checkpoint
from app.models.metric import SuccessMetric
from app.models.play import AccountPlay
from app.routes.accounts import _team_member_ids
from app.services.reports import (
    generate_mbr_html,
    generate_qbr_html,
    generate_utilization_html,
)

router = APIRouter(prefix="/api/v1/accounts", tags=["reports"])


async def _scope(db: AsyncSession, user, account_id: UUID) -> Account:
    acc = await get_account_row(db, account_id)
    is_assigned = (acc.csm_user_id == user.id) or (acc.co_user_id == user.id)
    team_ids = (
        await _team_member_ids(db, user) if user.role == "cs_team_manager" else set()
    )
    is_team = acc.csm_user_id in team_ids if team_ids else False
    if not can_view_account(user.role, is_assigned=is_assigned, is_team=is_team):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Forbidden on this account")
    return acc


async def _load_checkpoints(db: AsyncSession, account_id: UUID) -> list[Checkpoint]:
    rows = (
        await db.execute(
            select(Checkpoint)
            .where(Checkpoint.account_id == account_id)
            .order_by(Checkpoint.scheduled_date.asc().nulls_last())
        )
    ).scalars().all()
    return list(rows)


async def _load_metrics(db: AsyncSession, account_id: UUID) -> list[SuccessMetric]:
    rows = (
        await db.execute(
            select(SuccessMetric)
            .where(SuccessMetric.account_id == account_id)
            .where(SuccessMetric.deleted_at.is_(None))
            .order_by(SuccessMetric.created_at.asc())
        )
    ).scalars().all()
    return list(rows)


async def _load_plays(db: AsyncSession, account_id: UUID) -> list[AccountPlay]:
    rows = (
        await db.execute(
            select(AccountPlay)
            .where(AccountPlay.account_id == account_id)
            .where(AccountPlay.hidden.is_(False))
            .order_by(AccountPlay.prob.desc())
        )
    ).scalars().all()
    return list(rows)


# ============================================================
# QBR
# ============================================================


@router.get("/{account_id}/reports/qbr")
async def get_qbr(
    account_id: Annotated[UUID, Path()],
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    acc = await _scope(db, user, account_id)
    cps = await _load_checkpoints(db, account_id)
    mets = await _load_metrics(db, account_id)
    plays = await _load_plays(db, account_id)
    html_str = generate_qbr_html(
        account=acc, checkpoints=cps, metrics=mets, plays=plays
    )
    return {"html": html_str, "filename": f"{acc.slug}-qbr.html", "type": "qbr"}


# ============================================================
# MBR
# ============================================================


@router.get("/{account_id}/reports/mbr")
async def get_mbr(
    account_id: Annotated[UUID, Path()],
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    acc = await _scope(db, user, account_id)
    cps = await _load_checkpoints(db, account_id)
    mets = await _load_metrics(db, account_id)
    html_str = generate_mbr_html(account=acc, checkpoints=cps, metrics=mets)
    return {"html": html_str, "filename": f"{acc.slug}-mbr.html", "type": "mbr"}


# ============================================================
# Utilization
# ============================================================


@router.get("/{account_id}/reports/utilization")
async def get_utilization(
    account_id: Annotated[UUID, Path()],
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    acc = await _scope(db, user, account_id)
    super_users = (acc.platform_intel or {}).get("super_users") or []
    html_str = generate_utilization_html(account=acc, super_users=super_users)
    return {
        "html": html_str,
        "filename": f"{acc.slug}-utilization.html",
        "type": "utilization",
    }
