"""27-May Row 81 — Candidate success-metrics extraction from VPD documents.

Mirrors the M15.1 cs-goals extraction shape. The frontend takes the
result, presents a review modal with per-row checkboxes + inline edit,
and on confirm fans out POST /accounts/:id/metrics × N.

`extra="allow"` so the prompt can surface fields we haven't modelled
yet (e.g. baseline_value, measure_frequency) without a schema bump.
"""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

# Mirrors apps/api/app/schemas/metric.py MetricType.
MetricType = Literal["quantitative", "qualitative"]


class ExtractedMetric(BaseModel):
    """One candidate success metric. The first four fields map to
    MetricCreate; status is always derived server-side post-create."""

    model_config = ConfigDict(extra="allow")

    name: str = Field(..., min_length=1, max_length=200)
    metric_type: MetricType = "quantitative"
    target_value: str | None = Field(None, max_length=200)
    owner: str | None = Field(None, max_length=200)

    # Surfaced in the review modal for the per-row tag.
    confidence: Literal["high", "medium", "low"] | None = None
    rationale: str | None = Field(None, max_length=600)


class VpdMetricsExtractionResult(BaseModel):
    model_config = ConfigDict(extra="allow")

    document_id: UUID | None = None
    metrics: list[ExtractedMetric] = Field(default_factory=list)
    is_stub: bool = False
