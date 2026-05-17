"""M26 — Growth & Pipeline · Account Plan endpoints.

  GET    /accounts/:id/plays                List non-hidden plays
  POST   /accounts/:id/plays                Add a play
  PATCH  /plays/:id                         Update fields (incl. hidden)
  DELETE /plays/:id                         Soft-delete (set hidden=true)
  GET    /accounts/:id/appetite-score       Mode recommendation + breakdown
  POST   /accounts/:id/plan-mode            Set/clear the mode override

RBAC: same write set as cs_onboarding (admin / cs_director / vp_csm /
assigned CSM / cs_team_manager on team). View follows can_view_account.
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
from app.db.session import get_db
from app.models.account import Account
from app.models.play import AccountPlay
from app.models.signal import SoftSignal
from app.routes.accounts import _team_member_ids
from app.schemas.play import (
    AppetiteOut,
    ModeOverrideUpdate,
    PlayCreate,
    PlayListResponse,
    PlayOut,
    PlayUpdate,
)
from app.services.appetite import compute_appetite

account_router = APIRouter(prefix="/api/v1/accounts", tags=["plays"])
play_router = APIRouter(prefix="/api/v1/plays", tags=["plays"])


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


async def _scope_for_play(
    db: AsyncSession, user, play_id: UUID
) -> tuple[AccountPlay, bool, bool]:
    play = (
        await db.execute(select(AccountPlay).where(AccountPlay.id == play_id))
    ).scalar_one_or_none()
    if play is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Play not found")
    _, is_assigned, is_team = await _scope(db, user, play.account_id)
    return play, is_assigned, is_team


# ============================================================
# GET /accounts/:id/plays
# ============================================================


@account_router.get("/{account_id}/plays", response_model=PlayListResponse)
async def list_plays(
    account_id: Annotated[UUID, Path()],
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> PlayListResponse:
    _, is_assigned, is_team = await _scope(db, user, account_id)
    editable = can_write_cs_onboarding(
        user.role, is_assigned=is_assigned, is_team=is_team
    )

    rows = (
        await db.execute(
            select(AccountPlay)
            .where(AccountPlay.account_id == account_id)
            .where(AccountPlay.hidden.is_(False))
            .order_by(AccountPlay.prob.desc(), AccountPlay.created_at.asc())
        )
    ).scalars().all()
    items = [PlayOut.model_validate(p) for p in rows]
    return PlayListResponse(items=items, total=len(items), is_editable=editable)


# ============================================================
# POST /accounts/:id/plays
# ============================================================


@account_router.post(
    "/{account_id}/plays",
    response_model=PlayOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_play(
    account_id: Annotated[UUID, Path()],
    body: PlayCreate,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> PlayOut:
    _, is_assigned, is_team = await _scope(db, user, account_id)
    if not can_write_cs_onboarding(
        user.role, is_assigned=is_assigned, is_team=is_team
    ):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Cannot add plays on this account"
        )

    play = AccountPlay(
        account_id=account_id,
        title=body.title,
        value_usd=body.value_usd,
        prob=body.prob,
        when_text=body.when_text,
        trigger_text=body.trigger_text,
        modes=body.modes,
        role=body.role,
        added_by=user.id,
    )
    db.add(play)
    await db.commit()
    await db.refresh(play)
    return PlayOut.model_validate(play)


# ============================================================
# PATCH /plays/:id
# ============================================================


@play_router.patch("/{play_id}", response_model=PlayOut)
async def patch_play(
    play_id: Annotated[UUID, Path()],
    body: PlayUpdate,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> PlayOut:
    play, is_assigned, is_team = await _scope_for_play(db, user, play_id)
    if not can_write_cs_onboarding(
        user.role, is_assigned=is_assigned, is_team=is_team
    ):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Cannot edit this play"
        )

    payload = body.model_dump(exclude_unset=True, mode="json")
    for k, v in payload.items():
        setattr(play, k, v)
    play.updated_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(play)
    return PlayOut.model_validate(play)


# ============================================================
# DELETE /plays/:id  (soft — sets hidden=true)
# ============================================================


@play_router.delete("/{play_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_play(
    play_id: Annotated[UUID, Path()],
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    play, is_assigned, is_team = await _scope_for_play(db, user, play_id)
    if not can_write_cs_onboarding(
        user.role, is_assigned=is_assigned, is_team=is_team
    ):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Cannot delete this play"
        )
    play.hidden = True
    play.updated_at = datetime.now(timezone.utc)
    await db.commit()


# ============================================================
# GET /accounts/:id/appetite-score
# ============================================================


@account_router.get(
    "/{account_id}/appetite-score", response_model=AppetiteOut
)
async def get_appetite(
    account_id: Annotated[UUID, Path()],
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AppetiteOut:
    acc, _, _ = await _scope(db, user, account_id)
    plays = (
        await db.execute(
            select(AccountPlay)
            .where(AccountPlay.account_id == account_id)
            .where(AccountPlay.hidden.is_(False))
        )
    ).scalars().all()
    signals = (
        await db.execute(
            select(SoftSignal)
            .where(SoftSignal.account_id == account_id)
            .where(SoftSignal.hidden.is_(False))
        )
    ).scalars().all()
    return compute_appetite(acc=acc, plays=list(plays), signals=list(signals))


# ============================================================
# POST /accounts/:id/plan-mode
# ============================================================


@account_router.post(
    "/{account_id}/plan-mode", response_model=AppetiteOut
)
async def set_plan_mode(
    account_id: Annotated[UUID, Path()],
    body: ModeOverrideUpdate,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AppetiteOut:
    _, is_assigned, is_team = await _scope(db, user, account_id)
    if not can_write_cs_onboarding(
        user.role, is_assigned=is_assigned, is_team=is_team
    ):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Cannot set play mode on this account"
        )

    real = (
        await db.execute(select(Account).where(Account.id == account_id))
    ).scalar_one()
    real.plan_current_mode = body.mode  # None clears override → auto
    real.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(real)

    from app.core.scope import invalidate_account

    invalidate_account(account_id)

    plays = (
        await db.execute(
            select(AccountPlay)
            .where(AccountPlay.account_id == account_id)
            .where(AccountPlay.hidden.is_(False))
        )
    ).scalars().all()
    signals = (
        await db.execute(
            select(SoftSignal)
            .where(SoftSignal.account_id == account_id)
            .where(SoftSignal.hidden.is_(False))
        )
    ).scalars().all()
    return compute_appetite(
        acc=real, plays=list(plays), signals=list(signals)
    )
