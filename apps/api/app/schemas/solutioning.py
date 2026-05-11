"""AK03.d — Solutioning schemas. Mirrors BRD §4.3.d table 14 + v20 trial block."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

EngagementType = Literal["one_time", "retainer", "subscription", "pilot", "other"]
TrialKind = Literal["trial", "poc", "pilot", "demo", "none"]


class SolutioningOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    account_id: UUID
    proposed_solution: str | None
    engagement_type: EngagementType | None
    engagement_duration_months: int | None
    value_themes: list[str]
    value_definition: str | None
    estimated_value_musd: Decimal | None

    # Trial / POC block (v20).
    trial_conducted: bool | None = None
    trial_type: TrialKind | None = None
    trial_duration_text: str | None = None
    trial_participant_count: int | None = None
    trial_participants_text: str | None = None
    key_users_text: str | None = None
    info_tested: str | None = None
    hypothesis_tested: str | None = None
    trial_summary: str | None = None

    ai_extracted_from_doc: UUID | None
    ai_extracted_at: datetime | None
    ai_edited: bool

    # Sales Hand-off lock.
    locked_at: datetime | None = None
    locked_by: UUID | None = None

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

    # Trial / POC block (v20). Free-text fields capped to keep payload sane;
    # the prototype's largest example sits well under 2000 chars.
    trial_conducted: bool | None = None
    trial_type: TrialKind | None = None
    trial_duration_text: str | None = Field(None, max_length=200)
    trial_participant_count: int | None = Field(None, ge=0, le=10_000)
    trial_participants_text: str | None = Field(None, max_length=4000)
    key_users_text: str | None = Field(None, max_length=2000)
    info_tested: str | None = Field(None, max_length=4000)
    hypothesis_tested: str | None = Field(None, max_length=4000)
    trial_summary: str | None = Field(None, max_length=4000)

    ai_edited: bool | None = None


class HandoverOut(BaseModel):
    """Returned by POST /api/v1/accounts/:id/handover-to-solutioning."""

    account_id: UUID
    handed_off_to_solutioning: bool
    handed_off_at: datetime | None
    handed_off_by: UUID | None


class SolutioningLockOut(BaseModel):
    """Returned by POST /api/v1/accounts/:id/solutioning/lock and /unlock."""

    account_id: UUID
    locked_at: datetime | None
    locked_by: UUID | None
