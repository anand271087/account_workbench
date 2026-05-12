"""M14b — CS Goal Validation & Alignment schemas.

Permissive shapes for the nested jsonb columns. The prototype uses
category-specific fields (e.g. cost_savings has identified/committed/
implemented value, base_rationalization has baseline/current_count/target).
Encoding all those variants as discriminated unions would force a Pydantic
schema sweep every time the prototype tweaks a field name; instead we
accept open dicts and let the frontend enforce the category-specific
shape at render time.

The fields explicitly listed below are the ones the API actively cares
about (sort keys, dirty checks, audit-log subjects). Anything else just
flows through.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

CSGoalCategory = Literal[
    "cost_savings",
    "base_rationalization",
    "risk_mitigation",
    "adoption",
    "other",
]
CSGoalAlignment = Literal["not_started", "partial", "aligned"]


# ---------- Phase A / B / C objects ----------

class PhaseA(BaseModel):
    """Phase A — 'What does this goal actually mean?'

    The exact field set varies by category. We pin the common ones and
    let the rest flow through as extras so the frontend can iterate.
    """

    model_config = ConfigDict(extra="allow")

    goal_type: str | None = Field(None, max_length=80)
    category_clarity: Literal["confirmed", "partial", "not_discussed"] | None = None
    target_origin: Literal[
        "analysis_backed", "finance_set", "joint_estimate", "unknown"
    ] | None = None
    validation_note: str | None = Field(None, max_length=4000)
    phase_a_complete: bool = False


class PhaseB(BaseModel):
    """Phase B — 'What groundwork exists?'"""

    model_config = ConfigDict(extra="allow")

    spend_analytics: Literal[
        "done_current", "done_outdated", "not_done", "unknown"
    ] | None = None
    opportunity_assessment: Literal[
        "done_current", "done_outdated", "not_done", "unknown"
    ] | None = None
    benchmarking: Literal[
        "done_current", "done_outdated", "not_done", "unknown"
    ] | None = None
    research_requested: bool = False
    research_request_date: date | None = None
    phase_b_complete: bool = False


class PhaseC(BaseModel):
    """Phase C — 'Agree the target.'"""

    model_config = ConfigDict(extra="allow")

    category_focus: str | None = Field(None, max_length=2000)
    baseline: str | None = Field(None, max_length=2000)
    agreed_target: str | None = Field(None, max_length=2000)
    measure_method: str | None = Field(None, max_length=2000)
    timeline: date | None = None
    phase_c_complete: bool = False


# ---------- Initiative ----------

class Initiative(BaseModel):
    """One initiative on a goal. Schema is open so category-specific
    value fields (identified_value / committed_value / baseline_value /
    risk_baseline / etc.) flow through without churn."""

    model_config = ConfigDict(extra="allow")

    name: str = Field(..., max_length=200)
    sub_initiatives: str | None = Field(None, max_length=2000)
    status: Literal["not_started", "in_progress", "delivered"] = "not_started"
    value_stage: str | None = Field(None, max_length=40)
    value_target: str | None = Field(None, max_length=200)
    value_delivered: str | None = Field(None, max_length=200)
    client_acknowledged: Literal["pending", "yes", "not_yet"] = "pending"
    evidence: str | None = Field(None, max_length=4000)
    implementation_status: str | None = Field(None, max_length=80)
    implementation_note: str | None = Field(None, max_length=2000)
    # Generic dict for category-specific values (identifiedValue, etc.).
    value_fields: dict[str, Any] = Field(default_factory=dict)
    # [{label, status}] per-row data requests.
    client_data: list[dict[str, Any]] = Field(default_factory=list)
    # [{date, from, to, note, changed_by}] stage-change log.
    value_history: list[dict[str, Any]] = Field(default_factory=list)


# ---------- History entry ----------

class HistoryAction(BaseModel):
    """One business-level event in the goal's life.

    Appended server-side on every meaningful action (create, update,
    phase completion, initiative add, soft-delete, restore). NOT a wire
    schema for client input — clients trigger actions via PATCH/DELETE
    and the route layer builds the entry.
    """

    model_config = ConfigDict(extra="allow")

    at: datetime
    by: UUID | None = None
    by_name: str | None = None
    action: str          # 'created' | 'updated' | 'phase_a_completed' | 'soft_deleted' | ...
    field: str | None = None    # which field/phase was touched, if applicable
    previous_value: Any | None = None
    new_value: Any | None = None
    reason: str | None = None


# ---------- Read / Write ----------

class CSGoalOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    account_id: UUID

    title: str
    category: CSGoalCategory
    target_value: str | None
    target_date: date | None
    owner: str | None
    alignment_status: CSGoalAlignment

    phase_a: PhaseA = Field(default_factory=PhaseA)
    phase_b: PhaseB = Field(default_factory=PhaseB)
    phase_c: PhaseC = Field(default_factory=PhaseC)

    initiatives: list[Initiative] = Field(default_factory=list)
    history: list[HistoryAction] = Field(default_factory=list)

    deleted_at: datetime | None = None
    deleted_reason: str | None = None
    deleted_by: UUID | None = None

    created_at: datetime
    created_by: UUID | None = None
    updated_at: datetime
    updated_by: UUID | None = None

    is_editable: bool = False


class CSGoalCreate(BaseModel):
    """Initial create — title + category are enough to get a row; the
    phases + initiatives populate via PATCH as discovery proceeds."""

    title: str = Field(..., min_length=1, max_length=200)
    category: CSGoalCategory = "other"
    target_value: str | None = Field(None, max_length=200)
    target_date: date | None = None
    owner: str | None = Field(None, max_length=200)


class CSGoalUpdate(BaseModel):
    """Whole-document PATCH. Caller sends only changed keys."""

    title: str | None = Field(None, min_length=1, max_length=200)
    category: CSGoalCategory | None = None
    target_value: str | None = Field(None, max_length=200)
    target_date: date | None = None
    owner: str | None = Field(None, max_length=200)
    alignment_status: CSGoalAlignment | None = None

    phase_a: PhaseA | None = None
    phase_b: PhaseB | None = None
    phase_c: PhaseC | None = None

    initiatives: list[Initiative] | None = None


class CSGoalDelete(BaseModel):
    """Soft-delete body — reason mandatory for audit."""

    reason: str = Field(..., min_length=5, max_length=600)


class CSGoalListOut(BaseModel):
    items: list[CSGoalOut]
