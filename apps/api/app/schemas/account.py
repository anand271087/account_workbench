"""Account-related response schemas."""

from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class AccountListItem(BaseModel):
    """One row in the AK01 account list."""

    id: UUID
    name: str
    slug: str
    industry: str | None
    country: str | None
    region: str | None

    csm_user_id: UUID | None
    co_user_id: UUID | None
    csm_full_name: str | None = None     # joined from users
    co_full_name: str | None = None      # joined from users

    category: str | None
    tier: str | None
    account_type: str | None
    segment: str | None

    current_acv: Decimal | None
    target_acv: Decimal | None

    renewal_date: date | None
    days_to_renewal: int | None = None   # computed in route

    health_score: int | None
    last_activity_at: datetime | None

    is_editable: bool = False            # derived from caller's role + assignment

    # M25 — portfolio rollups (derived, attached per-row by the list route).
    alignment_status: str | None = None  # green / amber / red / None — rollup of cs_goals
    goal_count: int = 0
    next_checkpoint_type: str | None = None
    next_checkpoint_date: date | None = None
    next_checkpoint_days_until: int | None = None
    overdue_checkpoint_count: int = 0
    dr_outcome: str | None = None        # M23 final outcome if set

    model_config = {"from_attributes": True}


class AccountListResponse(BaseModel):
    items: list[AccountListItem]
    total: int
    page: int
    page_size: int


class AccountCreate(BaseModel):
    """Body for POST /api/v1/accounts (admin/cs_director/vp_csm)."""

    name: str = Field(..., min_length=2, max_length=200)
    industry: str | None = Field(None, max_length=80)
    country: str | None = Field(None, max_length=80)
    region: str | None = Field(None, max_length=40)

    csm_user_id: UUID
    co_user_id: UUID | None = None

    category: str | None = Field(None, max_length=120)
    tier: str | None = Field(None, max_length=40)
    account_type: str | None = Field(None, max_length=40)
    segment: str | None = Field(None, max_length=40)

    current_acv: Decimal | None = Field(None, ge=0, le=Decimal("99999999.99"))
    target_acv: Decimal | None = Field(None, ge=0, le=Decimal("99999999.99"))
    contract_start: date | None = None
    contract_end: date | None = None
    renewal_date: date | None = None
    health_score: int | None = Field(None, ge=0, le=100)


class AccountHeaderUpdate(BaseModel):
    """M16.1 — PATCH /accounts/:id body for the 5 header chips that MoM
    extraction surfaces. All fields optional; only the keys present in the
    request body are applied (None is treated as a clear)."""

    model_config = ConfigDict(extra="forbid")

    industry: str | None = Field(None, max_length=120)
    country: str | None = Field(None, max_length=120)
    headquarters: str | None = Field(None, max_length=200)
    annual_revenue_text: str | None = Field(None, max_length=80)
    tier: str | None = Field(None, max_length=40)
    sf_link: str | None = Field(None, max_length=2000)


class AccountListFilters(BaseModel):
    q: str | None = None                  # search across name, country, industry
    csm_user_id: UUID | None = None
    industry: str | None = None
    tier: str | None = None
    category: str | None = None
    region: str | None = None
    page: int = 1
    page_size: int = 50
    sort: str = "name"                    # name | renewal_date | current_acv | health_score | last_activity_at
    sort_dir: str = "asc"                 # asc | desc
