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

    # Signing event — direct columns on `accounts`.
    gate_signed_date: date | None = None
    gate_renewal_date: date | None = None
    gate_contract_acv_usd: Decimal | None = None
    gate_contract_term: str | None = None    # e.g. "1 year", "2 years", "Custom"

    # Platform configuration — also direct gate columns.
    gate_contract_modules: list[str] = []
    gate_platform_tier: str | None = None
    gate_account_segment: str | None = None
    gate_subscribers: str | None = None

    # 05-Jun — Contract Audit "extras" (stored in accounts.gate_contract_extras
    # jsonb). The Contract Audit form has 9 fields beyond the gate columns —
    # the extractor pulls whatever signal is in the doc and the CSM reviews
    # before clicking Save. All optional; missing values stay None.
    tcv: str | None = None              # total contract value, verbatim
    billing_freq: str | None = None     # Annual / Semi-Annual / Quarterly / Monthly / One-time
    payment_terms: str | None = None    # Net 30 / Net 45 / Net 60 / Net 90 / Net 120
    discount: str | None = None         # percent as a string ("12" / "12.5")
    discount_reason: str | None = None  # e.g. "Multi-year prepay"
    geography: str | None = None        # Global / NA / EU / APAC / LATAM / MEA
    module_caveats: str | None = None   # free text — module-specific carve-outs
    audit_notes: str | None = None      # free text — pricing protection etc.
    other_terms: str | None = None      # free text — exit clauses, audit rights, QBR cadence

    # Confidence / provenance (informational; not persisted to gate)
    confidence: str = "medium"               # "low" | "medium" | "high"
    notes: str | None = None
