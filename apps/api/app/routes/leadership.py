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
from app.models.play import AccountPlay
from app.models.signal import SoftSignal
from app.models.user import User
from app.schemas.leadership import (
    AccountRow,
    LeaderKPIs,
    LeadershipPortfolio,
    OpenRedFlag,
    OverdueCheckpointAccount,
    OverdueCheckpoints,
    PipelineCO,
    PipelinePlay,
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

    # ============================================================
    # Prototype-style additions: per-account list + KPI strip + Pipeline.
    # Matches prototype/beroe_awb_v20.html line 2491+ Leadership View.
    # ============================================================

    # Fetch CSM + CO name maps (one query each — small, fits in cache).
    user_rows = (
        await db.execute(select(User.id, User.full_name, User.email))
    ).all()
    user_name_by_id: dict = {
        uid: (full_name or email) for uid, full_name, email in user_rows
    }

    # Fetch every non-deleted account with the fields the table needs.
    acct_rows = (
        await db.execute(
            select(
                Account.id,
                Account.name,
                Account.slug,
                Account.csm_user_id,
                Account.co_user_id,
                Account.current_acv,
                Account.target_acv,
                Account.health_score,
                Account.plan_current_mode,
                Account.tier,
                Account.account_type,
                Account.dr_outcome,
                Account.gate_renewal_date,
                Account.renewal_date,
                Account.success_contract_locked_at,
                Account.vdd_locked_at,
            )
            .where(Account.deleted_at.is_(None))
        )
    ).all()

    # Pre-aggregate overdue checkpoint counts per account.
    overdue_by_acct: dict = {}
    today_for_dtr = date.today()
    overdue_count_rows = (
        await db.execute(
            select(
                Checkpoint.account_id,
                func.count().label("n"),
            )
            .where(
                and_(
                    Checkpoint.status != "signed_off",
                    Checkpoint.scheduled_date < today_for_dtr,
                )
            )
            .group_by(Checkpoint.account_id)
        )
    ).all()
    for aid, n in overdue_count_rows:
        overdue_by_acct[aid] = n

    # Pre-aggregate critical signal counts per account.
    critical_by_acct: dict = {}
    sig_rows = (
        await db.execute(
            select(SoftSignal.account_id, func.count())
            .where(
                and_(
                    SoftSignal.hidden.is_(False),
                    SoftSignal.status == "active",
                    SoftSignal.impact == "critical",
                )
            )
            .group_by(SoftSignal.account_id)
        )
    ).all()
    for aid, n in sig_rows:
        critical_by_acct[aid] = n

    # Pre-aggregate top expand play per account (max weighted value).
    top_play_by_acct: dict = {}
    play_rows = (
        await db.execute(
            select(
                AccountPlay.account_id,
                AccountPlay.title,
                AccountPlay.value_usd,
                AccountPlay.prob,
                AccountPlay.modes,
                AccountPlay.role,
                AccountPlay.added_by,
            )
            .where(AccountPlay.hidden.is_(False))
        )
    ).all()
    # All plays, keyed by account for per-account top + pipeline grouping.
    plays_by_acct: dict = {}
    for r in play_rows:
        aid = r.account_id
        plays_by_acct.setdefault(aid, []).append(r)
        # Track top play (max weighted value).
        try:
            wt = float(r.value_usd or 0) * (float(r.prob or 0) / 100.0)
        except (TypeError, ValueError):
            wt = 0.0
        prev = top_play_by_acct.get(aid)
        if prev is None or wt > prev[1]:
            top_play_by_acct[aid] = (r, wt)

    # Open red-flag counts per account (re-using the dr we already fetched).
    open_flag_by_acct: dict = {}
    for aid, _name, dr in flag_rows:
        if not isinstance(dr, dict):
            continue
        flags = dr.get("red_flags") or []
        n = sum(
            1
            for f in flags
            if isinstance(f, dict) and not f.get("resolved_at")
        )
        if n:
            open_flag_by_acct[aid] = n

    # Build per-account rows.
    accounts: list[AccountRow] = []
    kpi_current_acv = 0.0
    kpi_at_risk_acv = 0.0
    kpi_not_renewed_acv = 0.0
    kpi_critical_signals = 0
    kpi_expand_weighted = 0.0
    for row in acct_rows:
        acv = float(row.current_acv or 0)
        tgt = float(row.target_acv or 0)
        renewal = row.gate_renewal_date or row.renewal_date
        dtr = (renewal - today_for_dtr).days if renewal else None

        top_play = top_play_by_acct.get(row.id)
        top_title = top_play[0].title if top_play else None
        top_val = float(top_play[0].value_usd or 0) if top_play else 0.0
        top_prob = top_play[0].prob if top_play else None

        crit = critical_by_acct.get(row.id, 0)
        kpi_critical_signals += crit
        kpi_current_acv += acv
        if row.dr_outcome == "at_risk":
            kpi_at_risk_acv += acv
        elif row.dr_outcome == "not_renewed":
            kpi_not_renewed_acv += acv

        for p in plays_by_acct.get(row.id, []):
            modes = p.modes or []
            if "expand" in modes:
                try:
                    kpi_expand_weighted += float(p.value_usd or 0) * (
                        float(p.prob or 0) / 100.0
                    )
                except (TypeError, ValueError):
                    pass

        accounts.append(
            AccountRow(
                account_id=row.id,
                name=row.name,
                slug=row.slug,
                csm_name=user_name_by_id.get(row.csm_user_id),
                co_name=user_name_by_id.get(row.co_user_id),
                current_acv_usd=acv,
                target_acv_usd=tgt,
                health_score=row.health_score,
                mode=row.plan_current_mode,
                tier=row.tier,
                account_type=row.account_type,
                dr_outcome=row.dr_outcome,
                renewal_date=renewal,
                days_to_renewal=dtr,
                success_contract_locked=row.success_contract_locked_at is not None,
                vdd_locked=row.vdd_locked_at is not None,
                overdue_checkpoint_count=overdue_by_acct.get(row.id, 0),
                open_red_flag_count=open_flag_by_acct.get(row.id, 0),
                critical_signal_count=crit,
                top_play_title=top_title,
                top_play_value_usd=top_val,
                top_play_prob=top_prob,
            )
        )

    # Sort accounts by current_acv descending so big accounts surface first.
    accounts.sort(key=lambda a: a.current_acv_usd, reverse=True)

    kpis = LeaderKPIs(
        accounts_total=len(accounts),
        current_acv_total_usd=round(kpi_current_acv, 2),
        at_risk_acv_usd=round(kpi_at_risk_acv, 2),
        not_renewed_acv_usd=round(kpi_not_renewed_acv, 2),
        critical_signals=kpi_critical_signals,
        overdue_checkpoints_total=overdue.total_overdue,
        expand_weighted_pipeline_usd=round(kpi_expand_weighted, 2),
    )

    # ----- Pipeline by CO grouping -----
    # Group expand-mode plays by the account's commercial owner name.
    pipeline_by_co: dict = {}
    for row in acct_rows:
        co_name = user_name_by_id.get(row.co_user_id)
        if not co_name:
            continue
        for p in plays_by_acct.get(row.id, []):
            if "expand" not in (p.modes or []):
                continue
            try:
                wt = float(p.value_usd or 0) * (float(p.prob or 0) / 100.0)
            except (TypeError, ValueError):
                wt = 0.0
            bucket = pipeline_by_co.setdefault(
                co_name,
                {
                    "co_name": co_name,
                    "accounts": set(),
                    "total_weighted_usd": 0.0,
                    "plays": [],
                },
            )
            bucket["accounts"].add(row.name)
            bucket["total_weighted_usd"] += wt
            bucket["plays"].append(
                PipelinePlay(
                    account_id=row.id,
                    account_name=row.name,
                    title=p.title,
                    value_usd=float(p.value_usd or 0),
                    prob=int(p.prob or 0),
                    weighted_usd=round(wt, 2),
                    when_text=p.when_text if hasattr(p, "when_text") else None,
                    role=p.role,
                    added_by_name=user_name_by_id.get(p.added_by),
                )
            )

    pipeline_list: list[PipelineCO] = []
    for co_name, b in pipeline_by_co.items():
        b["plays"].sort(key=lambda x: x.weighted_usd, reverse=True)
        initials = "".join(
            w[0].upper() for w in co_name.split(" ") if w
        )[:2]
        pipeline_list.append(
            PipelineCO(
                co_name=co_name,
                co_initials=initials or "?",
                accounts=sorted(b["accounts"]),
                total_weighted_usd=round(b["total_weighted_usd"], 2),
                plays=b["plays"],
            )
        )
    pipeline_list.sort(key=lambda c: c.total_weighted_usd, reverse=True)

    return LeadershipPortfolio(
        renewals=renewals,
        value_delivered=value_delivered,
        overdue_checkpoints=overdue,
        open_red_flags=open_red_flags,
        generated_at=datetime.now(timezone.utc),
        kpis=kpis,
        accounts=accounts,
        pipeline_by_co=pipeline_list,
    )
