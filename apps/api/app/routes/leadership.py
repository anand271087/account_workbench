"""M24 — Leadership view: cross-account portfolio dashboard.

Director / VP / Admin tier only. One endpoint, four roll-ups. Performance
target ≤500 ms on a 600-account portfolio — keep it to a small handful of
batched queries.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser
from app.core.rbac import can_view_leadership
from app.db.session import get_db
from app.models.account import Account
from app.models.checkpoint import Checkpoint
from app.schemas.leadership import (
    LeadershipPortfolio,
    OpenRedFlag,
    OverdueCheckpointAccount,
    OverdueCheckpoints,
    RenewalOutcomeCounts,
    ValueDeliveredTotals,
)

router = APIRouter(prefix="/api/v1/leadership", tags=["leadership"])


@router.get("/portfolio", response_model=LeadershipPortfolio)
async def get_leadership_portfolio(
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> LeadershipPortfolio:
    if not can_view_leadership(user.role):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Leadership view is restricted to director / VP / admin roles",
        )

    # --- 1. Renewal outcome counts ---
    # GROUP BY dr_outcome over non-deleted accounts. NULL outcome falls
    # into the `undecided` bucket.
    outcome_rows = (
        await db.execute(
            select(Account.dr_outcome, func.count())
            .where(Account.deleted_at.is_(None))
            .group_by(Account.dr_outcome)
        )
    ).all()

    renewals = RenewalOutcomeCounts()
    for outcome, n in outcome_rows:
        if outcome == "renewed":
            renewals.renewed = n
        elif outcome == "at_risk":
            renewals.at_risk = n
        elif outcome == "not_renewed":
            renewals.not_renewed = n
        else:
            renewals.undecided += n
        renewals.total += n

    # --- 2. Value-delivered totals ---
    # Single SELECT against accounts; iterate value_delivered[] in Python.
    # 600 accounts × ~5 line items each = trivial.
    vdd_rows = (
        await db.execute(
            select(Account.id, Account.value_delivery_document)
            .where(Account.deleted_at.is_(None))
        )
    ).all()

    value_delivered = ValueDeliveredTotals()
    for _aid, vdd in vdd_rows:
        if not isinstance(vdd, dict):
            continue
        items = vdd.get("value_delivered") or []
        if not items:
            continue
        contributed = False
        for it in items:
            if not isinstance(it, dict):
                continue
            ident = it.get("identified_musd") or 0
            com = it.get("committed_musd") or 0
            impl = it.get("implemented_musd") or 0
            try:
                value_delivered.identified_musd += float(ident)
                value_delivered.committed_musd += float(com)
                value_delivered.implemented_musd += float(impl)
            except (TypeError, ValueError):
                continue
            if ident or com or impl:
                contributed = True
        if contributed:
            value_delivered.contributing_accounts += 1

    # Round trailing junk away from floating-point sums.
    value_delivered.identified_musd = round(value_delivered.identified_musd, 2)
    value_delivered.committed_musd = round(value_delivered.committed_musd, 2)
    value_delivered.implemented_musd = round(value_delivered.implemented_musd, 2)

    # --- 3. Overdue checkpoints ---
    today = date.today()
    overdue_rows = (
        await db.execute(
            select(
                Checkpoint.account_id,
                Account.name,
                func.count().label("n"),
                func.min(Checkpoint.scheduled_date).label("oldest"),
            )
            .join(Account, Account.id == Checkpoint.account_id)
            .where(
                and_(
                    Account.deleted_at.is_(None),
                    Checkpoint.status != "signed_off",
                    Checkpoint.scheduled_date < today,
                )
            )
            .group_by(Checkpoint.account_id, Account.name)
            .order_by(func.count().desc())
            .limit(10)
        )
    ).all()

    overdue_accounts = [
        OverdueCheckpointAccount(
            account_id=aid,
            account_name=name,
            overdue_count=n,
            oldest_scheduled_date=oldest,
        )
        for aid, name, n, oldest in overdue_rows
    ]
    overdue = OverdueCheckpoints(
        total_overdue=sum(a.overdue_count for a in overdue_accounts),
        accounts=overdue_accounts,
    )

    # --- 4. Open red flags ---
    # delivery_renewal.red_flags[] — one row per account; filter resolved_at IS NULL.
    flag_rows = (
        await db.execute(
            select(Account.id, Account.name, Account.delivery_renewal)
            .where(Account.deleted_at.is_(None))
        )
    ).all()

    open_red_flags: list[OpenRedFlag] = []
    for aid, name, dr in flag_rows:
        if not isinstance(dr, dict):
            continue
        flags = dr.get("red_flags") or []
        for f in flags:
            if not isinstance(f, dict):
                continue
            if f.get("resolved_at"):
                continue
            raised = f.get("raised_at")
            raised_dt: datetime | None = None
            if raised:
                try:
                    raised_dt = datetime.fromisoformat(
                        raised.replace("Z", "+00:00")
                    )
                except (TypeError, ValueError):
                    raised_dt = None
            open_red_flags.append(
                OpenRedFlag(
                    account_id=aid,
                    account_name=name,
                    type=f.get("type") or "other",
                    note=f.get("note"),
                    raised_at=raised_dt,
                )
            )

    # Show the oldest first — those are the ones the CSM let slip longest.
    open_red_flags.sort(key=lambda f: f.raised_at or datetime.max.replace(tzinfo=timezone.utc))

    return LeadershipPortfolio(
        renewals=renewals,
        value_delivered=value_delivered,
        overdue_checkpoints=overdue,
        open_red_flags=open_red_flags,
        generated_at=datetime.now(timezone.utc),
    )
