"""M20 — Success Metric schemas.

Status auto-derivation:
  * Quantitative — pct = current/target. ≥80% = green · ≥50% = amber · else red.
                   No current_value → grey.
  * Qualitative  — current_value in {High → green, Medium → amber, Low → red}.
  * status_override always wins when set.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

MetricType = Literal["quantitative", "qualitative"]
MetricStatus = Literal["green", "amber", "red", "grey"]


class MetricLogEntry(BaseModel):
    """One audit-trail entry for a value update."""

    model_config = ConfigDict(extra="allow")

    at: datetime
    by: UUID | None = None
    by_name: str | None = None
    value: str | None = None
    source: str | None = Field(None, max_length=600)  # evidence / data source / link
    note: str | None = Field(None, max_length=600)


class MetricOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    account_id: UUID

    name: str
    description: str | None
    metric_type: MetricType
    unit: str | None
    target_value: str | None
    current_value: str | None
    status_override: MetricStatus | None

    log_entries: list[MetricLogEntry]
    source: str

    last_updated_at: datetime | None
    last_updated_by: UUID | None

    created_at: datetime
    updated_at: datetime

    deleted_at: datetime | None = None
    deleted_reason: str | None = None

    status: MetricStatus = "grey"  # derived in route handler
    is_editable: bool = False


class MetricCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=240)
    description: str | None = Field(None, max_length=1000)
    metric_type: MetricType = "quantitative"
    unit: str | None = Field(None, max_length=40)
    target_value: str | None = Field(None, max_length=200)


class MetricUpdate(BaseModel):
    """Partial update. None on scalars clears the field."""

    name: str | None = Field(None, min_length=1, max_length=240)
    description: str | None = Field(None, max_length=1000)
    metric_type: MetricType | None = None
    unit: str | None = Field(None, max_length=40)
    target_value: str | None = Field(None, max_length=200)
    status_override: MetricStatus | None = None


class MetricValueLog(BaseModel):
    """Body of POST /metrics/:id/log — captures a new value + evidence."""

    value: str = Field(..., min_length=1, max_length=200)
    source: str | None = Field(None, max_length=600)
    note: str | None = Field(None, max_length=600)


class MetricDelete(BaseModel):
    reason: str = Field(..., min_length=5, max_length=600)


class MetricListOut(BaseModel):
    items: list[MetricOut]
    total: int
    is_editable: bool


# ============================================================
# Pure status-derivation helper. Used by the route to compute the
# `status` field on each MetricOut. No DB / no side-effects.
# ============================================================


def derive_status(
    *,
    metric_type: str,
    target_value: str | None,
    current_value: str | None,
    status_override: str | None,
) -> MetricStatus:
    if status_override:
        return status_override  # type: ignore[return-value]
    if current_value is None or str(current_value).strip() == "":
        return "grey"

    if metric_type == "qualitative":
        v = (current_value or "").strip().lower()
        if v in {"high"}:
            return "green"
        if v in {"medium", "med"}:
            return "amber"
        if v in {"low"}:
            return "red"
        return "grey"

    # Quantitative — both target + current need to parse to a number.
    try:
        tgt = float("".join(c for c in (target_value or "") if c.isdigit() or c == "."))
        cur = float("".join(c for c in (current_value or "") if c.isdigit() or c == "."))
    except (ValueError, TypeError):
        return "grey"
    if tgt <= 0:
        return "grey"
    pct = cur / tgt
    if pct >= 0.8:
        return "green"
    if pct >= 0.5:
        return "amber"
    return "red"
