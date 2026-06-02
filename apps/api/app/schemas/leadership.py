"""M24 — Leadership view schemas.

Single endpoint `GET /api/v1/leadership/portfolio` returns four roll-ups:

1. Renewal outcome counts (renewed / at_risk / not_renewed / undecided)
   sourced from `accounts.dr_outcome` (M23).
2. Value-delivered totals ($identified / $committed / $implemented) summed
   across every account's `value_delivery_document.value_delivered[]`
   (M22).
3. Overdue checkpoint count + the top accounts driving it (M21).
4. Open red flags across the portfolio — sourced from
   `accounts.delivery_renewal.red_flags[]` (M23), resolved_at null.
"""

from __future__ import annotations

from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel


class RenewalOutcomeCounts(BaseModel):
    renewed: int = 0
    at_risk: int = 0
    not_renewed: int = 0
    undecided: int = 0  # dr_outcome IS NULL
    total: int = 0


class ValueDeliveredTotals(BaseModel):
    identified_musd: float = 0.0
    committed_musd: float = 0.0
    implemented_musd: float = 0.0
    # Number of accounts that contributed at least one VDD line item.
    contributing_accounts: int = 0


class OverdueCheckpointAccount(BaseModel):
    account_id: UUID
    account_name: str
    overdue_count: int
    oldest_scheduled_date: date | None


class OverdueCheckpoints(BaseModel):
    total_overdue: int
    accounts: list[OverdueCheckpointAccount]


class OpenRedFlag(BaseModel):
    account_id: UUID
    account_name: str
    type: str
    note: str | None
    raised_at: datetime | None


# ============================================================
# Prototype-style additions: per-account list + KPI strip + Pipeline view.
# Matches prototype/beroe_awb_v20.html line 2491+ "Leadership View".
# ============================================================


class AccountRow(BaseModel):
    """One row of the Leadership portfolio table."""

    account_id: UUID
    name: str
    slug: str
    csm_name: str | None = None
    co_name: str | None = None
    current_acv_usd: float = 0.0
    target_acv_usd: float = 0.0
    health_score: int | None = None
    mode: str | None = None  # rescue / retain / expand
    tier: str | None = None
    account_type: str | None = None
    dr_outcome: str | None = None  # renewed / at_risk / not_renewed / undecided
    renewal_date: date | None = None
    days_to_renewal: int | None = None
    success_contract_locked: bool = False
    vdd_locked: bool = False
    overdue_checkpoint_count: int = 0
    open_red_flag_count: int = 0
    critical_signal_count: int = 0
    top_play_title: str | None = None
    top_play_value_usd: float = 0.0
    top_play_prob: int | None = None
    # Prototype additions for the screenshot match.
    last_activity_at: datetime | None = None
    activity_days_ago: int | None = None
    sc_status: str = "pending"   # "pending" | "ack" | "done" | "warn"
    next_checkpoint_signoff_pending: bool = False


class LeaderKPIs(BaseModel):
    """7-KPI strip at the top of the Leadership View (prototype match).

    Tiles, in display order:
        Accounts · Healthy (≥65) · At Risk (48-64) ·
        Attention (DTR ≤90) · Critical Signals ·
        Renewal Pipeline (weighted) · Expansion Pipeline (weighted)
    """

    accounts_total: int = 0
    healthy_count: int = 0                # health_score ≥ 65
    at_risk_band_count: int = 0           # 48 ≤ health < 65 (the visual band, not dr_outcome)
    attention_count: int = 0              # days_to_renewal ≤ 90 (urgency surface)
    critical_signals: int = 0
    renewal_pipeline_weighted_usd: float = 0.0   # Σ weighted for rescue + retain plays
    expansion_pipeline_weighted_usd: float = 0.0 # Σ weighted for expand plays
    # Kept for backwards-compatibility with earlier consumers.
    current_acv_total_usd: float = 0.0
    at_risk_acv_usd: float = 0.0
    not_renewed_acv_usd: float = 0.0
    overdue_checkpoints_total: int = 0


class PipelinePlay(BaseModel):
    account_id: UUID
    account_name: str
    title: str
    value_usd: float
    prob: int
    weighted_usd: float
    when_text: str | None = None
    role: str | None = None
    added_by_name: str | None = None


class PipelineCO(BaseModel):
    """One Commercial Owner card on the Pipeline view."""

    co_name: str
    co_initials: str
    accounts: list[str]
    total_weighted_usd: float = 0.0
    plays: list[PipelinePlay] = []


class LeadershipPortfolio(BaseModel):
    """Single aggregated payload behind /leadership/portfolio."""

    renewals: RenewalOutcomeCounts
    value_delivered: ValueDeliveredTotals
    overdue_checkpoints: OverdueCheckpoints
    open_red_flags: list[OpenRedFlag]
    generated_at: datetime
    # Prototype-style additions.
    kpis: LeaderKPIs = LeaderKPIs()
    accounts: list[AccountRow] = []
    pipeline_by_co: list[PipelineCO] = []
