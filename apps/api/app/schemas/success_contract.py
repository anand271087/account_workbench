"""M19 — Success Contract schemas.

Three-lock structure:
  1. Primary success metric (+ unit)        → metric1, metric1_unit, metric2 (optional)
  2. Measurement method                      → measure_source, measure_freq, measure_owner
  3. Value narrative (≥10 chars)             → value_narrative

`extra="allow"` everywhere so future fields (cadence, baseline notes,
escalation triggers) can flow through without schema churn — same
pattern as M15 cs_goals.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

MeasureFreq = Literal["Monthly", "Quarterly", "Bi-annual", "Annual"]


class SuccessContractOut(BaseModel):
    """What the API returns. `locked_at`/`locked_by` flag in-draft vs locked."""

    model_config = ConfigDict(extra="allow")

    account_id: UUID

    metric1: str | None = None
    metric1_unit: str | None = None
    metric2: str | None = None
    measure_source: str | None = None
    measure_freq: MeasureFreq | None = None
    measure_owner: str | None = None
    value_narrative: str | None = None

    locked_at: datetime | None = None
    locked_by: UUID | None = None

    auto_drafted: bool = False  # surfaced to the UI so it shows the "from handoff" badge

    is_editable: bool = False


class SuccessContractUpdate(BaseModel):
    """Partial update. Refusing to PATCH a locked contract — the route
    returns 409. Caller must unlock first."""

    model_config = ConfigDict(extra="allow")

    metric1: str | None = Field(None, max_length=400)
    metric1_unit: str | None = Field(None, max_length=40)
    metric2: str | None = Field(None, max_length=400)
    measure_source: str | None = Field(None, max_length=600)
    measure_freq: MeasureFreq | None = None
    measure_owner: str | None = Field(None, max_length=200)
    value_narrative: str | None = Field(None, max_length=2000)


class SuccessContractLock(BaseModel):
    """No payload required — server validates the 3 locks are satisfied."""
