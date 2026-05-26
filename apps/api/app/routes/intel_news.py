"""M28 — External Intelligence endpoints.

  GET    /accounts/:id/intel-news              List non-hidden items
  POST   /accounts/:id/intel-news              Manual add
  POST   /accounts/:id/intel-news/refresh      Generate via Claude (or stub)
  PATCH  /intel-news/:id                       Update / hide / mark-read
  POST   /intel-news/:id/push-as-signal        Create a SoftSignal + back-link
  DELETE /intel-news/:id                       Admin-only hard delete
"""

from __future__ import annotations

from datetime import date, datetime, timezone
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
from app.core.scope import get_account_row
from app.db.session import get_db
from app.models.account import Account
from app.models.intel_news import IntelNewsItem
from app.models.signal import SoftSignal
from app.routes.accounts import _team_member_ids
from app.schemas.intel_news import (
    IntelNewsCreate,
    IntelNewsListResponse,
    IntelNewsOut,
    IntelNewsUpdate,
    IntelRefreshResponse,
    PushAsSignalBody,
)
from app.services.intel_news import generate_intel_news

account_router = APIRouter(prefix="/api/v1/accounts", tags=["intel_news"])
intel_router = APIRouter(prefix="/api/v1/intel-news", tags=["intel_news"])


# Push-as-signal category → soft_signal type mapping (mirrors prototype's
# typeMap in pushNewsAsSignal). Drives the M27 Signal Mix component when
# the CSM promotes a piece of market intel.
_CATEGORY_TO_SIGNAL_TYPE = {
    "financial_performance": "risk",
    "supply_chain": "critical",
    "supplier_strategy": "neutral",
    "expansion_capex": "expansion",
    "regulatory_compliance": "risk",
    "sustainability_esg": "positive",
    "digital_transformation": "positive",
    "risk_geopolitical": "risk",
    "product_innovation": "neutral",
    "m_and_a": "expansion",
}

_RELEVANCE_TO_IMPACT = {
    "high": "high",
    "medium": "medium",
    "low": "low",
}


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


async def _scope_for_item(
    db: AsyncSession, user, item_id: UUID
) -> tuple[IntelNewsItem, Account, bool, bool]:
    item = (
        await db.execute(select(IntelNewsItem).where(IntelNewsItem.id == item_id))
    ).scalar_one_or_none()
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Intel news item not found")
    acc, is_assigned, is_team = await _scope(db, user, item.account_id)
    return item, acc, is_assigned, is_team


# ============================================================
# GET /accounts/:id/intel-news
# ============================================================


@account_router.get(
    "/{account_id}/intel-news", response_model=IntelNewsListResponse
)
async def list_intel_news(
    account_id: Annotated[UUID, Path()],
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> IntelNewsListResponse:
    _, is_assigned, is_team = await _scope(db, user, account_id)
    editable = can_write_cs_onboarding(
        user.role, is_assigned=is_assigned, is_team=is_team
    )
    rows = (
        await db.execute(
            select(IntelNewsItem)
            .where(IntelNewsItem.account_id == account_id)
            .where(IntelNewsItem.hidden.is_(False))
            # Most-recently-inserted first so a freshly-refreshed batch lands
            # at the top regardless of the article's publication date (real
            # GDELT articles often date back a few days; that shouldn't
            # bury them under older stub-seeded items with news_date=today).
            # news_date breaks ties within the same insertion batch.
            .order_by(IntelNewsItem.created_at.desc(),
                      IntelNewsItem.news_date.desc().nulls_last())
        )
    ).scalars().all()
    items = [IntelNewsOut.model_validate(r) for r in rows]
    return IntelNewsListResponse(items=items, total=len(items), is_editable=editable)


# ============================================================
# POST /accounts/:id/intel-news (manual add)
# ============================================================


@account_router.post(
    "/{account_id}/intel-news",
    response_model=IntelNewsOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_intel_news(
    account_id: Annotated[UUID, Path()],
    body: IntelNewsCreate,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> IntelNewsOut:
    _, is_assigned, is_team = await _scope(db, user, account_id)
    if not can_write_cs_onboarding(
        user.role, is_assigned=is_assigned, is_team=is_team
    ):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Cannot add intel news on this account"
        )
    item = IntelNewsItem(
        account_id=account_id,
        category=body.category,
        headline=body.headline,
        summary=body.summary,
        source=body.source,
        source_url=body.source_url,
        news_date=body.news_date,
        signal_relevance=body.signal_relevance,
        ai_generated=False,
        added_by=user.id,
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return IntelNewsOut.model_validate(item)


# ============================================================
# POST /accounts/:id/intel-news/refresh (AI generate)
# ============================================================


@account_router.post(
    "/{account_id}/intel-news/refresh",
    response_model=IntelRefreshResponse,
)
async def refresh_intel_news(
    account_id: Annotated[UUID, Path()],
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> IntelRefreshResponse:
    acc, is_assigned, is_team = await _scope(db, user, account_id)
    if not can_write_cs_onboarding(
        user.role, is_assigned=is_assigned, is_team=is_team
    ):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Cannot refresh intel news on this account"
        )

    # The Refresh button is an explicit user action — always force a fresh
    # GDELT pull. The 24h cache still serves the auto/seed callers via the
    # default force_refresh=False path.
    items, is_stub = generate_intel_news(
        account_name=acc.name, industry=acc.industry, force_refresh=True
    )

    # Dedup on (account_id, headline): skip headlines we already have.
    existing_heads = {
        h.lower()
        for h in (
            (
                await db.execute(
                    select(IntelNewsItem.headline).where(
                        IntelNewsItem.account_id == account_id
                    )
                )
            ).scalars().all()
        )
    }

    created = 0
    for it in items:
        head = (it.get("headline") or "").strip()
        if not head or head.lower() in existing_heads:
            continue
        # news_date arrives as an ISO string from the stub/Claude — coerce
        # to date so asyncpg can bind it to the DATE column.
        raw_news_date = it.get("news_date")
        news_date: date | None = None
        if isinstance(raw_news_date, date):
            news_date = raw_news_date
        elif isinstance(raw_news_date, str) and raw_news_date.strip():
            try:
                news_date = date.fromisoformat(raw_news_date.strip())
            except ValueError:
                news_date = None
        db.add(
            IntelNewsItem(
                account_id=account_id,
                category=it["category"],
                headline=head,
                summary=it.get("summary"),
                source=it.get("source"),
                source_url=it.get("source_url"),
                news_date=news_date,
                signal_relevance=it.get("signal_relevance", "medium"),
                ai_generated=True,
                added_by=user.id,
            )
        )
        existing_heads.add(head.lower())
        created += 1
    await db.commit()
    return IntelRefreshResponse(created=created, is_stub=is_stub)


# ============================================================
# PATCH /intel-news/:id
# ============================================================


@intel_router.patch("/{item_id}", response_model=IntelNewsOut)
async def patch_intel_news(
    item_id: Annotated[UUID, Path()],
    body: IntelNewsUpdate,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> IntelNewsOut:
    item, _, is_assigned, is_team = await _scope_for_item(db, user, item_id)
    if not can_write_cs_onboarding(
        user.role, is_assigned=is_assigned, is_team=is_team
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Cannot edit this item")

    payload = body.model_dump(exclude_unset=True, mode="json")
    for k, v in payload.items():
        setattr(item, k, v)
    item.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(item)
    return IntelNewsOut.model_validate(item)


# ============================================================
# POST /intel-news/:id/push-as-signal
# ============================================================


@intel_router.post(
    "/{item_id}/push-as-signal", response_model=IntelNewsOut
)
async def push_as_signal(
    item_id: Annotated[UUID, Path()],
    body: PushAsSignalBody,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> IntelNewsOut:
    """Promote a news item into a SoftSignal. Idempotent — second call
    returns the existing back-linked item without creating a new signal."""
    _ = body  # silence unused-arg; body is optional/empty
    item, _acc, is_assigned, is_team = await _scope_for_item(db, user, item_id)
    if not can_write_cs_onboarding(
        user.role, is_assigned=is_assigned, is_team=is_team
    ):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Cannot push intel as signal on this account"
        )

    if item.signal_created and item.signal_id is not None:
        # Idempotent — already promoted.
        return IntelNewsOut.model_validate(item)

    sig_type = _CATEGORY_TO_SIGNAL_TYPE.get(item.category, "neutral")
    impact = _RELEVANCE_TO_IMPACT.get(item.signal_relevance, "medium")

    signal = SoftSignal(
        account_id=item.account_id,
        type=sig_type,
        category="strategic",
        signal=item.headline[:240],
        description=item.summary,
        impact=impact,
        source=item.source,
        ai_extracted=item.ai_generated,
        added_by=user.id,
    )
    db.add(signal)
    await db.flush()  # populate signal.id without committing

    item.signal_created = True
    item.signal_id = signal.id
    item.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(item)
    return IntelNewsOut.model_validate(item)


# ============================================================
# DELETE /intel-news/:id  (admin-only hard delete)
# ============================================================


@intel_router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_intel_news(
    item_id: Annotated[UUID, Path()],
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    if not is_global_admin(user.role):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Only admins can hard-delete intel news"
        )
    item, _, _, _ = await _scope_for_item(db, user, item_id)
    await db.delete(item)
    await db.commit()
