"""AK03.c — Pydantic schemas for documents, jobs, and aggregate summary."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

DocKind = Literal["mom", "vpd", "recording", "transcript", "email", "other", "contract"]
AiStatus = Literal["pending", "processing", "complete", "failed"]


class DocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    account_id: UUID
    kind: DocKind
    # 04-Jun — contract-doc subclassification (Signed Proposal / MSA / etc.)
    contract_subtype: str | None = None
    filename: str
    mime_type: str | None
    size_bytes: int | None
    meeting_date: date | None
    uploaded_by: UUID | None
    uploaded_at: datetime
    ai_status: AiStatus
    ai_summary_text: str | None
    extracted_entities: dict[str, Any] | None
    job_id: UUID | None
    ai_edited: bool = False
    ai_edited_at: datetime | None = None
    mom_extracted_fields: dict[str, Any] | None = None
    mom_extracted_at: datetime | None = None
    vpd_extracted_fields: dict[str, Any] | None = None
    vpd_extracted_at: datetime | None = None
    handoff_extracted_fields: dict[str, Any] | None = None
    handoff_extracted_at: datetime | None = None
    cs_goals_extracted: dict[str, Any] | None = None
    cs_goals_extracted_at: datetime | None = None
    metrics_extracted: dict[str, Any] | None = None
    metrics_extracted_at: datetime | None = None
    notes: str | None = None
    deleted_at: datetime | None


class DocumentSummaryUpdate(BaseModel):
    """User edit of an AI summary — flips ai_edited to true server-side."""

    ai_summary_text: str = Field(..., min_length=1, max_length=4000)


class DocumentNotesUpdate(BaseModel):
    """Bug 3 — free-text notes attached to the uploaded document.
    Empty string allowed (clears the note)."""

    notes: str = Field("", max_length=4000)


# 04-Jun — Sales Handoff prototype port.
ContractSubtype = Literal[
    "Signed Proposal", "Unsigned Proposal", "Work Order",
    "MSA", "Purchase Order", "Invoice", "SOW",
    "Amendment", "NDA",
]


class DocumentContractSubtypeUpdate(BaseModel):
    """PATCH body for contract-doc subtype tagging.

    Sales picks one of the 9 canonical types from a dropdown after
    upload; the audit table then filters/sorts by type. Server-side
    CHECK constraint bounds the set."""

    contract_subtype: ContractSubtype | None = None


class DocumentListResponse(BaseModel):
    items: list[DocumentOut]
    total: int
    is_editable: bool


class DocumentUploadResponse(BaseModel):
    """Returned by POST /api/v1/accounts/:id/documents — 202 Accepted."""

    document: DocumentOut
    job_id: UUID
    duplicate: bool = Field(
        False,
        description="True when the file hash matched an existing doc; we returned that one instead.",
    )


class JobOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    kind: str
    account_id: UUID | None
    document_id: UUID | None
    status: Literal["pending", "running", "complete", "failed"]
    progress: int
    error: str | None
    result: dict[str, Any] | None
    started_at: datetime | None
    finished_at: datetime | None
    created_at: datetime


class DiscoverySummaryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    account_id: UUID
    summary_text: str | None
    source_document_ids: list[UUID]
    generated_at: datetime | None
