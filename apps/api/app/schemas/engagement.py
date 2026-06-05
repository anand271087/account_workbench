"""Schemas for AK03.a — Engagement Info."""

from datetime import date, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field, field_validator

MaturityLevel = Literal["low", "medium", "high"]

# ISO-4217-style currency codes accepted by the procurement-spend field.
# Mirrors the CHECK constraint in migration 0057. Keep in sync.
SpendCurrency = Literal[
    "USD", "EUR", "GBP", "INR", "JPY", "CNY", "AUD", "CAD", "CHF",
    "SGD", "AED", "SAR", "HKD", "BRL", "MXN", "ZAR", "SEK", "NOK",
    "DKK", "NZD", "KRW", "THB", "MYR", "IDR", "PHP", "TRY", "RUB",
]

# 05-Jun — internal lead fields (SDR / Discovery / Sales) are now free text.
# Earlier we enforced `@beroe-inc.com` on PATCH because the picker stored
# canonical emails to avoid name-collision joins. Stakeholder feedback was
# to drop the validation — extracted names from the MoM (e.g. "Anurag
# Bhagat", "Dinesh Gokhale") land as-is. The picker still renders the
# value verbatim; if a Beroe row matches it auto-suggests an email, but
# the stored value can be any string.


def _validate_lead_text(value: str | None) -> str | None:
    """Pass-through normaliser for SDR / Discovery / Sales lead fields.
    Trims whitespace; empty → None. No domain enforcement."""
    if value is None:
        return None
    v = value.strip()
    return v or None


def _validate_pre_discovery_date(d: date | None) -> date | None:
    """Pre-discovery is by definition in the past — reject future dates."""
    if d is None:
        return None
    if d > date.today():
        raise ValueError(
            f"pre_discovery_date cannot be in the future (got {d}, today is {date.today()})"
        )
    return d


class EngagementOut(BaseModel):
    """Full engagement-info record returned to the client."""

    account_id: UUID

    sdr_lead: str | None
    pre_discovery_date: date | None
    discovery_lead: str | None
    sales_lead: str | None

    target_categories: list[str] = Field(default_factory=list)
    engagement_objective: str | None
    procurement_maturity: MaturityLevel | None
    ai_penetration: MaturityLevel | None
    procurement_spend_musd: Decimal | None
    procurement_spend_currency: SpendCurrency | None = None
    geographies: list[str] = Field(default_factory=list)

    spoc_text: str | None
    sponsor_text: str | None
    power_users_text: str | None

    ai_quality_score: int | None
    ai_quality_dismissed: bool

    updated_at: datetime
    updated_by: UUID | None

    is_editable: bool = False  # set in route based on caller's role + scope

    model_config = {"from_attributes": True}


class EngagementUpdate(BaseModel):
    """Body of PATCH /accounts/:id/engagement.

    All fields optional — partial update. `target_categories` and `geographies`,
    if provided, REPLACE the array (not merge) — same semantic as a multi-select.
    """

    # Internal Beroe leads — must be `@beroe-inc.com` emails so we can resolve
    # to the exact teammate (names aren't unique over years).
    sdr_lead: str | None = None
    pre_discovery_date: date | None = None
    discovery_lead: str | None = None
    sales_lead: str | None = None

    target_categories: list[str] | None = None
    engagement_objective: str | None = None
    procurement_maturity: MaturityLevel | None = None
    ai_penetration: MaturityLevel | None = None
    # Procurement spend in million USD — non-negative.
    procurement_spend_musd: Decimal | None = Field(
        None, ge=0, le=Decimal("999999.99"),
        description="Total procurement spend in millions of the chosen currency (≥ 0)",
    )
    procurement_spend_currency: SpendCurrency | None = None
    geographies: list[str] | None = None

    spoc_text: str | None = None
    sponsor_text: str | None = None
    power_users_text: str | None = None

    # User can dismiss the AI quality warning
    ai_quality_dismissed: bool | None = None

    # ---- field validators ----

    @field_validator("sdr_lead", "discovery_lead", "sales_lead", mode="before")
    @classmethod
    def _v_lead_text(cls, v):  # noqa: N805
        return _validate_lead_text(v)

    @field_validator("pre_discovery_date")
    @classmethod
    def _v_pre_discovery(cls, v):  # noqa: N805
        return _validate_pre_discovery_date(v)


class QualityCheckRequest(BaseModel):
    text: str


class QualityCheckResponse(BaseModel):
    score: int = Field(..., ge=1, le=5)
    comment: str
    word_count: int
    is_stub: bool = False  # true when the Anthropic key isn't configured (dev/demo)
