"""AK03.d — Solutioning schemas. Mirrors BRD §4.3.d table 14."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

EngagementType = Literal["one_time", "retainer", "subscription", "pilot", "other"]


class SolutioningOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    account_id: UUID
    proposed_solution: str | None
    engagement_type: EngagementType | None
    engagement_duration_months: int | None
    value_themes: list[str]
    value_definition: str | None
    estimated_value_musd: Decimal | None
    ai_extracted_from_doc: UUID | None
    ai_extracted_at: datetime | None
    ai_edited: bool
    updated_at: datetime
    updated_by: UUID | None
    is_editable: bool = False


class SolutioningUpdate(BaseModel):
    proposed_solution: str | None = Field(None, max_length=4000)
    engagement_type: EngagementType | None = None
    engagement_duration_months: int | None = Field(None, ge=1, le=120)
    value_themes: list[str] | None = None
    value_definition: str | None = Field(None, max_length=4000)
    estimated_value_musd: Decimal | None = Field(None, ge=0, le=100000)
    ai_edited: bool | None = None


class HandoverOut(BaseModel):
    """Returned by POST /api/v1/accounts/:id/handover-to-solutioning."""

    account_id: UUID
    handed_off_to_solutioning: bool
    handed_off_at: datetime | None
    handed_off_by: UUID | None
