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


class LeadershipPortfolio(BaseModel):
    """Single aggregated payload behind /leadership/portfolio."""

    renewals: RenewalOutcomeCounts
    value_delivered: ValueDeliveredTotals
    overdue_checkpoints: OverdueCheckpoints
    open_red_flags: list[OpenRedFlag]
    generated_at: datetime
