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


class LeaderKPIs(BaseModel):
    """4-KPI strip at the top of the Leadership View."""

    accounts_total: int = 0
    current_acv_total_usd: float = 0.0
    at_risk_acv_usd: float = 0.0          # ACV of dr_outcome='at_risk' accounts
    not_renewed_acv_usd: float = 0.0      # ACV of dr_outcome='not_renewed'
    critical_signals: int = 0             # count of impact='critical' signals across portfolio
    overdue_checkpoints_total: int = 0
    expand_weighted_pipeline_usd: float = 0.0  # Σ(play.value × play.prob/100) for expand-mode plays


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
