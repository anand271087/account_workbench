"""M21 — Checkpoint schemas.

Standard cadence types: Kickoff (Day 0), MBR (+90d), QBR (+180d),
Renewal (renewal_date − 14d). Status transitions: not_held → held →
signed_off. Sign-off captures a structured snapshot of what was reviewed.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

CheckpointType = Literal["Kickoff", "MBR", "QBR", "Renewal"]
CheckpointStatus = Literal["not_held", "held", "signed_off"]


class InitiativeSnapshot(BaseModel):
    """One initiative the checkpoint reviewed."""

    model_config = ConfigDict(extra="allow")

    id: UUID | None = None  # cs_goal id or null for free-form
    name: str
    stage: str | None = None  # the value-stage at time of review


class MetricSnapshot(BaseModel):
    """One metric the checkpoint discussed."""

    model_config = ConfigDict(extra="allow")

    id: UUID
    name: str
    value: str | None = None
    target: str | None = None
    status: str | None = None


class SignedOffSnapshot(BaseModel):
    """The structured record persisted on sign-off. Immutable evidence
    for Renewal Readiness (M23) and the VDD (M22)."""

    model_config = ConfigDict(extra="allow")

    initiatives: list[InitiativeSnapshot] = Field(default_factory=list)
    metrics: list[MetricSnapshot] = Field(default_factory=list)
    client_acknowledgement: str | None = None
    next_actions: str | None = None


class CheckpointAttachment(BaseModel):
    name: str = Field(..., min_length=1, max_length=240)
    url: str | None = Field(None, max_length=2000)


class CheckpointOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    account_id: UUID
    type: CheckpointType
    scheduled_date: date | None
    held_date: date | None
    status: CheckpointStatus
    notes: str | None

    signed_off_at: datetime | None
    signed_off_by: UUID | None
    signed_off_snapshot: SignedOffSnapshot | None
    attachments: list[CheckpointAttachment] = Field(default_factory=list)

    created_at: datetime
    updated_at: datetime

    is_editable: bool = False


class CheckpointCreate(BaseModel):
    type: CheckpointType
    scheduled_date: date | None = None


class CheckpointUpdate(BaseModel):
    scheduled_date: date | None = None
    held_date: date | None = None
    status: CheckpointStatus | None = None
    notes: str | None = Field(None, max_length=2000)
    attachments: list[CheckpointAttachment] | None = None


class CheckpointSignOff(BaseModel):
    """Body of POST /checkpoints/:id/sign-off."""

    initiatives: list[InitiativeSnapshot] = Field(default_factory=list)
    metrics: list[MetricSnapshot] = Field(default_factory=list)
    client_acknowledgement: str | None = Field(None, max_length=2000)
    next_actions: str | None = Field(None, max_length=2000)
    held_date: date | None = None  # set if not already set


class CheckpointListOut(BaseModel):
    items: list[CheckpointOut]
    total: int
    is_editable: bool
