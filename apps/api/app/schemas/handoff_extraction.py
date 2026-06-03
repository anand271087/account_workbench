"""Handoff (Sales Hand-off contract document) field-extraction schema.

Mirrors apps/api/app/schemas/mom_extraction.py and vpd_extraction.py.

The Celery worker calls `extract_handoff(text)` after the AI summary
pass on a kind='contract' upload. The result is persisted on
`documents.handoff_extracted_fields` and the frontend's KindUploadCard
polls + one-shot applies the values as a dirty draft on the Client
Signed form (Sales Hand-off tab).

Every field is optional — the extractor only populates what it found
in the document text. The frontend treats absence as "no proposal";
the CSM can still fill the field manually.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class HandoffExtractionResult(BaseModel):
    """Structured Client Signed fields extracted from a contract upload."""

    model_config = ConfigDict(extra="allow")

    document_id: str | None = None
    is_stub: bool = True

    # Signing event
    gate_signed_date: date | None = None
    gate_contract_acv_usd: Decimal | None = None
    gate_contract_term: str | None = None    # e.g. "1 year", "2 years", "Custom"

    # Platform configuration
    gate_contract_modules: list[str] = []
    gate_platform_tier: str | None = None
    gate_account_segment: str | None = None
    gate_subscribers: str | None = None

    # Confidence / provenance (informational; not persisted to gate)
    confidence: str = "medium"               # "low" | "medium" | "high"
    notes: str | None = None
