"""09-Jun · Auto-computed Scores bundle — spec sheet 17.

The spec's "Auto-computed Scores" sheet describes 9 derived KPIs that
live in the application layer (not Redshift). Most pieces already exist
scattered across the codebase:

  • Health Score          → accounts.health_score
  • Appetite Score → Mode → services/appetite.compute_appetite
  • Days to Renewal       → accounts.renewal_date / gate_renewal_date
  • Renewal Readiness     → delivery_renewal jsonb (auto-computed in
                            services/delivery_renewal_engine when the
                            user fills in the 3-question yes/no grid)

What's NEW in this module: Product Score, Signal Score, Churn Risk,
Risk bucket, Health trend — and one consolidated /intel/scores endpoint
that returns all 9 in a single shape matching the spec sheet's columns.

This service is async-native (reads from Supabase via SQLAlchemy) so it
does NOT need the run_in_threadpool wrapper that Redshift bundles use.
It joins the /intel/all asyncio.gather fan-out as a peer coroutine.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.play import AccountPlay
from app.models.signal import SoftSignal
from app.services.appetite import compute_appetite

logger = logging.getLogger(__name__)


# ============================================================
# Score formulas
# ============================================================


def _product_score(acc: Account) -> int:
    """Health component coming from usage / product engagement.

    Spec: Health = Product + Signal. With no canonical Beroe formula in
    the BRD, we split the existing 0-100 health_score 60/40: Product is
    the larger component because day-to-day adoption and usage telemetry
    drives most of the perceived health. Once Redshift telemetry (active
    users, login cadence, time spent) is wired in, swap this for a
    real-time computed value.
    """
    hs = int(acc.health_score or 50)
    return max(0, min(100, round(hs * 0.60 * (100 / 60))))


def _signal_score(visible_signals: list[SoftSignal]) -> int:
    """Signal-mix component on the 0-100 scale.

    Mirrors the appetite signal-mix curve but rescales to 0-100 (the
    appetite curve maxes at 25 because it's weighted 25% of the
    composite). Pure positive → 100; pure critical → 0.
    """
    visible = [s for s in visible_signals if not s.hidden and s.status == "active"]
    if not visible:
        return 60  # neutral default when no signals

    counts = {"expansion": 0, "positive": 0, "neutral": 0, "risk": 0, "critical": 0}
    for s in visible:
        counts[s.type] = counts.get(s.type, 0) + 1
    n = len(visible)
    pos = (counts["expansion"] + counts["positive"]) / n
    if pos > 0.5:
        return 95
    if counts["neutral"] / n > 0.5:
        return 65
    if counts["risk"] / n > 0.5:
        return 35
    if counts["critical"] / n > 0.3:
        return 10
    return 50  # mixed → middling


def _churn_risk(*, product: int, signal: int, days_to_renewal: int | None) -> int:
    """Higher value = more churn risk. 0..100 inverse of health adjusted
    by signal mix and renewal proximity.

    Weighting:
      • 60% inverse-product   (poor product engagement → high risk)
      • 30% inverse-signal    (risk-heavy signal mix → high risk)
      • 10% renewal-proximity (T-30 days adds urgency)
    """
    inv_product = 100 - product
    inv_signal = 100 - signal
    proximity_bonus = 0
    if days_to_renewal is not None and 0 <= days_to_renewal <= 30:
        proximity_bonus = 25
    elif days_to_renewal is not None and 0 <= days_to_renewal <= 60:
        proximity_bonus = 10
    base = (inv_product * 0.60) + (inv_signal * 0.30) + (proximity_bonus * 0.10)
    return max(0, min(100, round(base)))


def _risk_bucket(churn_risk: int) -> str:
    if churn_risk >= 70:
        return "High"
    if churn_risk >= 40:
        return "Medium"
    return "Low"


def _renewal_readiness(acc: Account) -> int | None:
    """Pull the readiness score from the delivery_renewal jsonb if the
    CSM has filled in the 3-question grid; otherwise None."""
    dr = acc.delivery_renewal or {}
    readiness = dr.get("readiness") or {}
    score = readiness.get("score")
    if isinstance(score, (int, float)):
        # The DR engine stores it as 0..3 (count of yes answers). Spec
        # wants a 0..100 percentage so it slots into the same chart axis.
        return int(round(float(score) / 3 * 100))
    return None


def _days_to_renewal(acc: Account, today: date) -> int | None:
    renewal = acc.gate_renewal_date or acc.renewal_date
    return (renewal - today).days if renewal else None


# ============================================================
# Public entry point
# ============================================================


async def compute_scores(db: AsyncSession, account_id: UUID) -> dict[str, Any]:
    """Compute all 9 auto-computed scores for one account.

    Returns the spec shape. Every score is 0..100 (int) unless noted;
    bucket and mode are strings; days_to_renewal is int or None.
    """
    today = date.today()

    acc = (
        await db.execute(select(Account).where(Account.id == account_id))
    ).scalar_one_or_none()
    if acc is None:
        return {"error": "account not found", "account_id": str(account_id)}

    # Soft signals + plays (used by both signal score AND appetite)
    sigs = (
        await db.execute(
            select(SoftSignal).where(
                SoftSignal.account_id == account_id, SoftSignal.hidden.is_(False)
            )
        )
    ).scalars().all()
    plays = (
        await db.execute(
            select(AccountPlay).where(
                AccountPlay.account_id == account_id, AccountPlay.hidden.is_(False)
            )
        )
    ).scalars().all()

    # ---- Composite scores ----
    health_score = int(acc.health_score or 50)
    product = _product_score(acc)
    signal = _signal_score(list(sigs))
    dtr = _days_to_renewal(acc, today)
    churn = _churn_risk(product=product, signal=signal, days_to_renewal=dtr)
    bucket = _risk_bucket(churn)
    readiness = _renewal_readiness(acc)

    # ---- Appetite via existing service (mode + composite) ----
    appetite = compute_appetite(acc=acc, plays=list(plays), signals=list(sigs), today=today)

    return {
        "source": "derived",
        "as_of": today.isoformat(),
        # Spec row 1
        "health_score": health_score,
        # Spec row 2
        "product_score": product,
        # Spec row 3
        "signal_score": signal,
        # Spec row 4
        "churn_risk_score": churn,
        # Spec row 5
        "risk_bucket": bucket,
        # Spec row 6
        "appetite_score": appetite.score,
        "appetite_mode": appetite.current_mode,
        "appetite_recommended_mode": appetite.recommended_mode,
        # Spec row 7
        "renewal_readiness_score": readiness,
        # Spec row 8
        "days_to_renewal": dtr,
        # Spec row 9 — Health trend (vs 30d ago). Needs an
        # account_health_history table to be meaningful. For now we
        # return None and tag the field so the frontend can render
        # a graceful "—". Wire migration 0070 + a daily cron later.
        "health_trend_30d": None,
        "health_trend_note": "history table not yet populated — wire 0070_account_health_history",
        # The appetite breakdown is useful for "How is this mode determined?"
        # surfaces, expose it for the scores tile to drill into.
        "breakdown": {
            "health_pts": appetite.breakdown.health_pts,
            "sig_pts": appetite.breakdown.sig_pts,
            "renew_pts": appetite.breakdown.renew_pts,
            "arr_pts": appetite.breakdown.arr_pts,
            "arr_status": appetite.breakdown.arr_status,
        },
    }
