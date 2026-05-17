"""M22 — Value Delivery Document schemas.

Four sections (renewal-conversation source of truth):
  1. client_strategic_priorities  list[str]              — pillars / themes
  2. agreed_success_metrics       list[MetricSnapshot]   — usually mirrored from success_metrics
  3. beroes_approach              list[ApproachItem]     — per-initiative + 3-lever savings
  4. value_delivered              list[ValueDeliveredItem] — CSM-attributed $-amounts

`extra="allow"` so future fields (cadence overrides, escalation triggers,
exec-summary blurb) flow through without schema churn — same pattern as
M15 cs_goals and M19 success_contract.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

# Cost / risk / adoption — the 3-lever savings framework.
SavingsLever = Literal["cost", "risk", "adoption"]
# Mirrors cs_goals.initiatives stage vocabulary.
InitiativeStage = Literal[
    "proposed", "committed", "in_flight", "implemented", "blocked", "cancelled"
]


class MetricSnapshot(BaseModel):
    """Snapshot ref of one success_metric row (id + display fields)."""

    model_config = ConfigDict(extra="allow")

    id: str | None = None  # success_metrics.id (when sourced from M20)
    name: str
    target: str | None = None
    current: str | None = None
    status: Literal["green", "amber", "red", "grey"] | None = None


class ApproachItem(BaseModel):
    """Beroe's approach against one initiative + 3-lever savings."""

    model_config = ConfigDict(extra="allow")

    initiative_id: str | None = None  # cs_goals.initiatives[].id reference
    initiative_name: str
    approach: str | None = None
    levers: list[SavingsLever] = Field(default_factory=list)
    stage: InitiativeStage | None = None


class ValueDeliveredItem(BaseModel):
    """CSM-attributed $-amount rollup for one initiative."""

    model_config = ConfigDict(extra="allow")

    initiative_id: str | None = None
    initiative_name: str
    identified_musd: float | None = None
    committed_musd: float | None = None
    implemented_musd: float | None = None
    note: str | None = None


class VddOut(BaseModel):
    """What the API returns."""

    model_config = ConfigDict(extra="allow")

    account_id: UUID

    client_strategic_priorities: list[str] = Field(default_factory=list)
    agreed_success_metrics: list[MetricSnapshot] = Field(default_factory=list)
    beroes_approach: list[ApproachItem] = Field(default_factory=list)
    value_delivered: list[ValueDeliveredItem] = Field(default_factory=list)

    exec_summary: str | None = None

    locked_at: datetime | None = None
    locked_by: UUID | None = None

    auto_drafted: bool = False
    is_editable: bool = False


class VddUpdate(BaseModel):
    """Partial whole-document update. Refusing to PATCH a locked VDD —
    the route returns 409. Caller must unlock first."""

    model_config = ConfigDict(extra="allow")

    client_strategic_priorities: list[str] | None = None
    agreed_success_metrics: list[MetricSnapshot] | None = None
    beroes_approach: list[ApproachItem] | None = None
    value_delivered: list[ValueDeliveredItem] | None = None
    exec_summary: str | None = Field(None, max_length=4000)


class VddLock(BaseModel):
    """No payload required — server validates required minimums are met."""

    model_config = ConfigDict(extra="allow")
