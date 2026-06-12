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

    # 12-Jun · migration 0075 — real-data fields surfaced on the list.
    sector: str | None = None
    revenue_bucket: str | None = None
    renewal_risk: str | None = None      # Low | Medium | High | None
    category_count: int | None = None
    supplier_count: int | None = None
    platform_status: str | None = None   # Active | Inactive | None
    subscription_plan: str | None = None
    is_fortune_500: bool = False
    is_focus_region: bool = False
    is_focus_industry: bool = False
    procurement_maturity: str | None = None
    genai_adoption: str | None = None

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

    # 03-Jun bug — csm_user_id is now optional. The new Add Account modal
    # stores the named owners as text (csm_owner_name / commercial_owner_name)
    # for display while the assignee user IDs may be backfilled later when
    # the named Beroe staff are invited as real users.
    csm_user_id: UUID | None = None
    co_user_id: UUID | None = None
    commercial_owner_name: str | None = Field(None, max_length=200)
    csm_owner_name: str | None = Field(None, max_length=200)

    category: str | None = Field(None, max_length=120)
    tier: str | None = Field(None, max_length=40)
    account_type: str | None = Field(None, max_length=40)
    segment: str | None = Field(None, max_length=40)

    # 10-Jun · Upper bound dropped (was 99,999,999.99 ~= $100M). Any
    # positive Decimal accepted — accounts at billions+ ACV no longer
    # need a workaround.
    current_acv: Decimal | None = Field(None, ge=0)
    target_acv: Decimal | None = Field(None, ge=0)
    contract_start: date | None = None
    contract_end: date | None = None
    renewal_date: date | None = None
    health_score: int | None = Field(None, ge=0, le=100)


class AccountHeaderUpdate(BaseModel):
    """PATCH /accounts/:id body. All fields optional; only the keys present
    in the request body are applied (None is treated as a clear).

    Covers two distinct slices:
      • M16.1 header chips populated by MoM extraction
      • Contract Audit gate_* fields edited from the Sales Hand-off tab
        after the initial /sign event. These don't go through /sign
        because that endpoint is for the signing event itself (409s
        on re-call). Inline edits like fixing a wrong ACV or extending
        the modules list need a forgiving PATCH path.
    """

    model_config = ConfigDict(extra="forbid")

    # M16.1 header chips
    industry: str | None = Field(None, max_length=120)
    country: str | None = Field(None, max_length=120)
    headquarters: str | None = Field(None, max_length=200)
    annual_revenue_text: str | None = Field(None, max_length=80)
    tier: str | None = Field(None, max_length=40)
    sf_link: str | None = Field(None, max_length=2000)
    # 12-Jun · Admin-edit path for the Redshift companyname mapping.
    # Surfaced inline on the Account header (admin-only pencil) so a
    # mismatched name can be corrected without a SQL trip.
    redshift_company_name: str | None = Field(None, max_length=200)

    # Contract Audit gate_* fields. Edited inline from SalesHandoffTab.
    gate_signed_date: date | None = None
    gate_contract_term: str | None = Field(None, max_length=40)
    gate_renewal_date: date | None = None
    gate_bvd_due_date: date | None = None
    gate_contract_acv: Decimal | None = Field(
        None, ge=0, le=Decimal("100000000")
    )
    gate_contract_modules: list[str] | None = None
    gate_platform_tier: str | None = Field(None, max_length=80)
    gate_account_segment: str | None = Field(None, max_length=80)
    gate_subscribers: str | None = Field(None, max_length=200)


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
