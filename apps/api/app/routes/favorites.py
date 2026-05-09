"""GET / POST / DELETE /api/v1/me/favorites — pinned-account list per user.

Persists across devices (replaces the localStorage Phase-1 implementation).
Cap of 10: pinning the 11th drops the oldest pin server-side so the table
never balloons.

RLS at the DB layer ensures users can't see/touch each other's pins; this
route is also user-scoped so the application boundary doubles as the policy.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Path, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser
from app.db.session import get_db
from app.models.account import Account
from app.models.user_favorite import UserFavorite

router = APIRouter(prefix="/api/v1/me/favorites", tags=["favorites"])

MAX_FAVORITES = 10


class FavoriteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str
    slug: str
    pinned_at: datetime


@router.get("", response_model=list[FavoriteOut])
async def list_favorites(
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[FavoriteOut]:
    """Caller's pinned accounts, newest first."""
    rows = (
        await db.execute(
            select(Account.id, Account.name, Account.slug, UserFavorite.pinned_at)
            .join(UserFavorite, UserFavorite.account_id == Account.id)
            .where(
                UserFavorite.user_id == user.id,
                Account.deleted_at.is_(None),
            )
            .order_by(UserFavorite.pinned_at.desc())
            .limit(MAX_FAVORITES)
        )
    ).all()
    return [
        FavoriteOut(id=r[0], name=r[1], slug=r[2], pinned_at=r[3]) for r in rows
    ]


@router.post(
    "/{account_id}", response_model=list[FavoriteOut], status_code=status.HTTP_201_CREATED
)
async def pin_account(
    account_id: Annotated[UUID, Path()],
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[FavoriteOut]:
    """Pin an account. Idempotent. Drops oldest pin if cap is exceeded."""
    # Account must exist + not be deleted.
    acc = (
        await db.execute(
            select(Account.id).where(Account.id == account_id, Account.deleted_at.is_(None))
        )
    ).first()
    if acc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Account not found")

    # Insert (or no-op if already pinned).
    try:
        db.add(UserFavorite(user_id=user.id, account_id=account_id))
        await db.commit()
    except IntegrityError:
        # Already pinned — that's fine, idempotent.
        await db.rollback()

    # Enforce cap of 10 — drop oldest if we just exceeded.
    count = (
        await db.execute(
            select(func.count())
            .select_from(UserFavorite)
            .where(UserFavorite.user_id == user.id)
        )
    ).scalar_one()
    if count > MAX_FAVORITES:
        excess = count - MAX_FAVORITES
        oldest_ids = (
            await db.execute(
                select(UserFavorite.account_id)
                .where(UserFavorite.user_id == user.id)
                .order_by(UserFavorite.pinned_at.asc())
                .limit(excess)
            )
        ).scalars().all()
        if oldest_ids:
            await db.execute(
                delete(UserFavorite).where(
                    UserFavorite.user_id == user.id,
                    UserFavorite.account_id.in_(oldest_ids),
                )
            )
            await db.commit()

    return await list_favorites(user, db)


@router.delete("/{account_id}", response_model=list[FavoriteOut])
async def unpin_account(
    account_id: Annotated[UUID, Path()],
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[FavoriteOut]:
    """Unpin an account. Idempotent — returns the (possibly unchanged) list."""
    await db.execute(
        delete(UserFavorite).where(
            UserFavorite.user_id == user.id,
            UserFavorite.account_id == account_id,
        )
    )
    await db.commit()
    return await list_favorites(user, db)
