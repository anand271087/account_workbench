"""AK03.d — Solutioning schemas. Mirrors BRD §4.3.d table 14."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

EngagementType = Literal["one_time", "retainer", "subscription", "pilot", "other"]
ShValidation = Literal["confirmed", "partially_confirmed", "revised"]


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

    # Sales Hand-off lock.
    locked_at: datetime | None = None
    locked_by: UUID | None = None

    # Sales Hand-off context (M13). The first three are set automatically
    # when Solutioning locks; the rest are filled in by Sales.
    sh_value_from_solutioning: str | None = None
    sh_value_themes_from_solutioning: str | None = None
    sh_value_received_at: datetime | None = None
    sh_value_validation: ShValidation | None = None
    sh_validation_notes: str | None = None
    sh_go_live_date: date | None = None
    sh_first_checkpoint: date | None = None
    sh_stakeholder_signoff: str | None = None
    sh_commercial_context: str | None = None
    sales_watchouts: str | None = None
    handoff_file_name: str | None = None

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

    # Sales Hand-off context. sh_value_from_solutioning + sh_value_received_at
    # are deliberately NOT patchable — they're set by the lock endpoint as
    # an immutable snapshot.
    sh_value_validation: ShValidation | None = None
    sh_validation_notes: str | None = Field(None, max_length=4000)
    sh_go_live_date: date | None = None
    sh_first_checkpoint: date | None = None
    sh_stakeholder_signoff: str | None = Field(None, max_length=600)
    sh_commercial_context: str | None = Field(None, max_length=4000)
    sales_watchouts: str | None = Field(None, max_length=4000)
    handoff_file_name: str | None = Field(None, max_length=400)

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
