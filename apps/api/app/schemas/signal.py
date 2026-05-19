"""M27 — Soft signals + activities schemas."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

SignalType = Literal["risk", "positive", "expansion", "neutral", "critical"]
SignalImpact = Literal["critical", "high", "medium", "low"]
SignalStatus = Literal["active", "resolved"]
ActivityType = Literal[
    "csm_call", "exec_visit", "product", "research", "qbr", "internal", "escalation"
]


# ============================================================
# Soft signals
# ============================================================


class SoftSignalOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    account_id: UUID
    type: SignalType
    category: str | None
    signal: str
    description: str | None
    impact: SignalImpact
    status: SignalStatus
    resolved_at: datetime | None
    resolved_by: UUID | None
    resolved_note: str | None
    valid_until: date | None
    occurred_at: date | None
    source: str | None
    ai_extracted: bool
    added_by: UUID | None
    hidden: bool
    created_at: datetime
    updated_at: datetime


class SoftSignalListResponse(BaseModel):
    items: list[SoftSignalOut]
    total: int
    is_editable: bool


class SoftSignalCreate(BaseModel):
    type: SignalType
    category: str | None = Field(None, max_length=80)
    signal: str = Field(..., min_length=1, max_length=240)
    description: str | None = Field(None, max_length=2000)
    impact: SignalImpact = "medium"
    valid_until: date | None = None
    occurred_at: date | None = None
    source: str | None = Field(None, max_length=240)


class SoftSignalUpdate(BaseModel):
    """Edit a signal's metadata. Use /resolve to flip status."""

    type: SignalType | None = None
    category: str | None = Field(None, max_length=80)
    signal: str | None = Field(None, min_length=1, max_length=240)
    description: str | None = Field(None, max_length=2000)
    impact: SignalImpact | None = None
    valid_until: date | None = None
    occurred_at: date | None = None
    source: str | None = Field(None, max_length=240)
    hidden: bool | None = None


class SoftSignalResolve(BaseModel):
    resolved_note: str = Field(..., min_length=5, max_length=2000)


# ============================================================
# Activities
# ============================================================


class ActivityOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    account_id: UUID
    type: ActivityType
    title: str
    summary: str | None
    items: str | None
    attendees: str | None
    linked_metrics: list[UUID]
    file_name: str | None
    occurred_at: date | None
    added_by: UUID | None
    hidden: bool
    created_at: datetime
    updated_at: datetime


class ActivityListResponse(BaseModel):
    items: list[ActivityOut]
    total: int
    is_editable: bool


class ActivityCreate(BaseModel):
    type: ActivityType
    title: str = Field(..., min_length=1, max_length=240)
    summary: str | None = Field(None, max_length=4000)
    items: str | None = Field(None, max_length=4000)
    attendees: str | None = Field(None, max_length=600)
    linked_metrics: list[UUID] = Field(default_factory=list)
    file_name: str | None = Field(None, max_length=240)
    occurred_at: date | None = None


class ActivityUpdate(BaseModel):
    type: ActivityType | None = None
    title: str | None = Field(None, min_length=1, max_length=240)
    summary: str | None = Field(None, max_length=4000)
    items: str | None = Field(None, max_length=4000)
    attendees: str | None = Field(None, max_length=600)
    linked_metrics: list[UUID] | None = None
    file_name: str | None = Field(None, max_length=240)
    occurred_at: date | None = None
    hidden: bool | None = None
