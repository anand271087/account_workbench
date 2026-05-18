"""M29 — Platform Intelligence endpoints.

  GET   /accounts/:id/platform-intel   Read the snapshot
  PATCH /accounts/:id/platform-intel   Partial update of any section
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
)
from app.core.scope import get_account_row
from app.db.session import get_db
from app.models.account import Account
from app.routes.accounts import _team_member_ids
from app.schemas.platform_intel import PlatformIntelOut, PlatformIntelUpdate

router = APIRouter(prefix="/api/v1/accounts", tags=["platform_intel"])


async def _scope(
    db: AsyncSession, user, account_id: UUID
) -> tuple[Account, bool, bool]:
    acc = await get_account_row(db, account_id)
    is_assigned = (acc.csm_user_id == user.id) or (acc.co_user_id == user.id)
    team_ids = (
        await _team_member_ids(db, user) if user.role == "cs_team_manager" else set()
    )
    is_team = acc.csm_user_id in team_ids if team_ids else False
    if not can_view_account(user.role, is_assigned=is_assigned, is_team=is_team):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Forbidden on this account")
    return acc, is_assigned, is_team


def _serialise(
    acc: Account, *, editable: bool, override: dict | None = None
) -> PlatformIntelOut:
    src = override if override is not None else (acc.platform_intel or {})
    has_data = bool(src) and any(v for v in src.values())
    return PlatformIntelOut(
        account_id=acc.id,
        cat_intel=src.get("cat_intel") or {},
        supplier_watch=src.get("supplier_watch") or {},
        abi=src.get("abi") or {},
        benchmark=src.get("benchmark") or {},
        engagement=src.get("engagement") or {},
        nps=src.get("nps") or {},
        usage=src.get("usage") or {},
        modules=src.get("modules") or {},
        super_users=src.get("super_users") or [],
        has_data=has_data,
        is_editable=editable,
    )


# ============================================================
# GET /accounts/:id/platform-intel
# ============================================================


@router.get("/{account_id}/platform-intel", response_model=PlatformIntelOut)
async def get_platform_intel(
    account_id: Annotated[UUID, Path()],
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> PlatformIntelOut:
    acc, is_assigned, is_team = await _scope(db, user, account_id)
    editable = can_write_cs_onboarding(
        user.role, is_assigned=is_assigned, is_team=is_team
    )
    return _serialise(acc, editable=editable)


# ============================================================
# PATCH /accounts/:id/platform-intel
# ============================================================


@router.patch("/{account_id}/platform-intel", response_model=PlatformIntelOut)
async def patch_platform_intel(
    account_id: Annotated[UUID, Path()],
    body: PlatformIntelUpdate,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> PlatformIntelOut:
    _, is_assigned, is_team = await _scope(db, user, account_id)
    if not can_write_cs_onboarding(
        user.role, is_assigned=is_assigned, is_team=is_team
    ):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Your role cannot edit Platform Intelligence on this account",
        )

    real = (
        await db.execute(select(Account).where(Account.id == account_id))
    ).scalar_one()

    payload = body.model_dump(exclude_unset=True, mode="json")
    if payload:
        merged = dict(real.platform_intel or {})
        # Each key replaces its sub-section atomically (no deep merge —
        # the prototype treats each section as one unit, e.g. updating
        # supplier_watch.suppliers means sending the whole list).
        for k, v in payload.items():
            if v is None:
                merged.pop(k, None)
            else:
                merged[k] = v
        real.platform_intel = merged

    real.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(real)

    from app.core.scope import invalidate_account

    invalidate_account(account_id)
    return _serialise(real, editable=True)
