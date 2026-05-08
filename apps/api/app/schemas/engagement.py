"""Schemas for AK03.a — Engagement Info."""

from datetime import date, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

MaturityLevel = Literal["low", "medium", "high"]


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

    sdr_lead: str | None = None
    pre_discovery_date: date | None = None
    discovery_lead: str | None = None
    sales_lead: str | None = None

    target_categories: list[str] | None = None
    engagement_objective: str | None = None
    procurement_maturity: MaturityLevel | None = None
    ai_penetration: MaturityLevel | None = None
    procurement_spend_musd: Decimal | None = None
    geographies: list[str] | None = None

    spoc_text: str | None = None
    sponsor_text: str | None = None
    power_users_text: str | None = None

    # User can dismiss the AI quality warning
    ai_quality_dismissed: bool | None = None


class QualityCheckRequest(BaseModel):
    text: str


class QualityCheckResponse(BaseModel):
    score: int = Field(..., ge=1, le=5)
    comment: str
    word_count: int
    is_stub: bool = False  # true when the Anthropic key isn't configured (dev/demo)
