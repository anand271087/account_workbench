"""M23 — Delivery & Renewal schemas.

Dual-track post-delivery view:
  * Track 1 (Renewal) — derived from M21 Checkpoints (next due, overdue
    count); the route hydrates `track1` from the checkpoints table.
  * Track 2 (Expand) — 4-stage Kanban (value_proof / expand_ask /
    new_scope / close). Stored as a list per stage.

Red flags pause Track 2. Renewal Readiness is a 3-question yes/no
assessment that gates the final renewal call. Outcome (renewed /
at_risk / not_renewed) is a stamped final decision — admin-only
re-open mirrors M13/M19/M22 unlock asymmetry.

`extra="allow"` everywhere keeps the shape elastic — same pattern as
M15 cs_goals + M19 success_contract + M22 vdd.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

ExpandStage = Literal["value_proof", "expand_ask", "new_scope", "close"]
RedFlagType = Literal[
    "missed_checkpoint",
    "spoc_unresponsive",
    "no_value_logged",
    "escalation",
]
Outcome = Literal["renewed", "at_risk", "not_renewed", "undecided"]


class ExpandItem(BaseModel):
    """One opportunity in the expand pipeline."""

    model_config = ConfigDict(extra="allow")

    id: str | None = None
    name: str
    stage: ExpandStage
    amount_musd: float | None = None
    note: str | None = None


class RedFlag(BaseModel):
    """One red flag. `resolved_at` null → still open → expand auto-pauses."""

    model_config = ConfigDict(extra="allow")

    id: str | None = None
    type: RedFlagType
    note: str | None = None
    raised_at: datetime | None = None
    raised_by: UUID | None = None
    resolved_at: datetime | None = None
    resolved_by: UUID | None = None


class ReadinessAnswer(BaseModel):
    """One of three renewal-readiness questions."""

    model_config = ConfigDict(extra="allow")

    answer: Literal["yes", "no", "unknown"] = "unknown"
    proof_note: str | None = None


class Readiness(BaseModel):
    """The 3 questions stored together so the score derives cleanly."""

    model_config = ConfigDict(extra="allow")

    delivered_metric: ReadinessAnswer = Field(default_factory=ReadinessAnswer)
    proof_data: ReadinessAnswer = Field(default_factory=ReadinessAnswer)
    client_acknowledged: ReadinessAnswer = Field(default_factory=ReadinessAnswer)


class Track1Derived(BaseModel):
    """Derived from M21 checkpoints. Read-only — recomputed every GET."""

    model_config = ConfigDict(extra="allow")

    next_type: str | None = None
    next_scheduled: str | None = None
    next_days_until: int | None = None
    overdue_count: int = 0
    signed_off_count: int = 0
    total: int = 0


class DeliveryRenewalOut(BaseModel):
    model_config = ConfigDict(extra="allow")

    account_id: UUID

    # Track 2 (Expand) — list per stage. Easier than an items[] + stage
    # because the UI is a 4-column Kanban; per-stage lists serialise 1:1
    # to columns.
    expand_value_proof: list[ExpandItem] = Field(default_factory=list)
    expand_expand_ask: list[ExpandItem] = Field(default_factory=list)
    expand_new_scope: list[ExpandItem] = Field(default_factory=list)
    expand_close: list[ExpandItem] = Field(default_factory=list)

    red_flags: list[RedFlag] = Field(default_factory=list)
    readiness: Readiness = Field(default_factory=Readiness)

    # Derived — recomputed each GET.
    track1: Track1Derived = Field(default_factory=Track1Derived)
    expand_paused: bool = False
    readiness_score: int = 0  # 0–3 count of `yes` answers

    outcome: Outcome | None = None
    outcome_set_at: datetime | None = None
    outcome_set_by: UUID | None = None

    is_editable: bool = False


class DeliveryRenewalUpdate(BaseModel):
    """Partial whole-document update. Refuses when an outcome is final
    unless the caller is admin (route enforces)."""

    model_config = ConfigDict(extra="allow")

    expand_value_proof: list[ExpandItem] | None = None
    expand_expand_ask: list[ExpandItem] | None = None
    expand_new_scope: list[ExpandItem] | None = None
    expand_close: list[ExpandItem] | None = None
    readiness: Readiness | None = None


class RedFlagCreate(BaseModel):
    model_config = ConfigDict(extra="allow")

    type: RedFlagType
    note: str | None = Field(None, max_length=600)


class OutcomeSet(BaseModel):
    """Set the final outcome. Once set, regular writers can't PATCH the
    rest of the document — only admin re-open releases."""

    model_config = ConfigDict(extra="allow")

    outcome: Outcome
