"""Schemas for AK03.a — Engagement Info."""

from datetime import date, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field, field_validator

MaturityLevel = Literal["low", "medium", "high"]

_BEROE_DOMAIN = "@beroe-inc.com"


def _validate_beroe_email(value: str | None) -> str | None:
    """Internal lead fields (SDR / Discovery / Sales) must be Beroe email IDs.

    Names alone aren't unique ("Gaurav" matches dozens of staff over years);
    requiring an `@beroe-inc.com` address forces the picker to identify the
    exact teammate. Empty string and None are passed through.
    """
    if value is None:
        return None
    v = value.strip()
    if not v:
        return None
    if "@" not in v or not v.lower().endswith(_BEROE_DOMAIN):
        raise ValueError(
            f"Must be a Beroe email address ({_BEROE_DOMAIN}); got '{value}'"
        )
    return v.lower()


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
        description="Total procurement spend in millions of USD (≥ 0)",
    )
    geographies: list[str] | None = None

    spoc_text: str | None = None
    sponsor_text: str | None = None
    power_users_text: str | None = None

    # User can dismiss the AI quality warning
    ai_quality_dismissed: bool | None = None

    # ---- field validators ----

    @field_validator("sdr_lead", "discovery_lead", "sales_lead", mode="before")
    @classmethod
    def _v_beroe_email(cls, v):  # noqa: N805
        return _validate_beroe_email(v)

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
