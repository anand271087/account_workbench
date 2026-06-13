"""AK03.c — Document, Job, AccountDiscoverySummary ORMs."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, Boolean, Date, DateTime, ForeignKey, Integer, String, text
from sqlalchemy.dialects.postgresql import ARRAY, ENUM, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

# 13-Jun bug fix — the SQLAlchemy ENUM validates the Python value against
# THIS list before the DB round-trip (LookupError otherwise). Migration
# 0078 added l1_call / l2_call / trial_summary to the DB enum + the Pydantic
# DocKind Literal, but this ORM definition was missed → uploads of the new
# kinds 500'd with "not among the defined enum values". Keep in lockstep
# with schemas/document.py::DocKind and the DB doc_kind enum.
DocKind = ENUM(
    "mom", "vpd", "recording", "transcript", "email", "other", "contract",
    "l1_call", "l2_call", "trial_summary",
    # 13-Jun bug 250 — evidence files attached to a goal initiative (0080).
    "initiative_doc",
    name="doc_kind", create_type=False,
)
AiStatus = ENUM("pending", "processing", "complete", "failed", name="ai_status", create_type=False)


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    account_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)

    kind: Mapped[str] = mapped_column(DocKind, nullable=False)
    # 04-Jun — typed sub-classification for contract docs (Signed Proposal /
    # MSA / SOW / NDA / etc.). CHECK-bounded set in migration 0059.
    contract_subtype: Mapped[str | None] = mapped_column(String, nullable=True)
    filename: Mapped[str] = mapped_column(String, nullable=False)
    file_hash: Mapped[str] = mapped_column(String, nullable=False)
    storage_path: Mapped[str] = mapped_column(String, nullable=False)
    mime_type: Mapped[str | None] = mapped_column(String, nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    meeting_date: Mapped[datetime | None] = mapped_column(Date, nullable=True)

    uploaded_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )

    ai_status: Mapped[str] = mapped_column(AiStatus, nullable=False, server_default=text("'pending'"))
    ai_summary_text: Mapped[str | None] = mapped_column(String, nullable=True)
    extracted_entities: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    job_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)

    ai_edited: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    ai_edited_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    ai_edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # MoM field extraction — populated by the worker only when kind='mom'.
    mom_extracted_fields: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    mom_extracted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # VPD field extraction — populated by the worker only when kind='vpd'.
    vpd_extracted_fields: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    vpd_extracted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Sales Handoff (contract) field extraction — populated by the worker
    # only when kind='contract'. Migration 0056. The frontend's
    # KindUploadCard polls and one-shot applies these fields as a dirty
    # draft on the Client Signed form so the CSM doesn't have to retype
    # the ACV / term / modules etc. that are already in the handoff doc.
    handoff_extracted_fields: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    handoff_extracted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # M15.1 — candidate-goals extraction (kind='vpd' only). The frontend
    # surfaces a review modal when this column lands; user confirms a
    # subset → fan-out POST /accounts/:id/cs-goals.
    cs_goals_extracted: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    cs_goals_extracted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # 09-Jun · Unified VPD review — metrics now extracted in the same
    # worker step as goals so the unified modal reads both candidates
    # in one shot. Backed by the on-demand POST /documents/:id/extract-metrics
    # route too; that route still works (idempotent — overwrites this
    # column) but the worker fires it by default.
    metrics_extracted: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    metrics_extracted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Bug 3 — free-text notes attached to the uploaded document.
    notes: Mapped[str | None] = mapped_column(nullable=True)

    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    kind: Mapped[str] = mapped_column(String, nullable=False)
    account_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    document_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)

    status: Mapped[str] = mapped_column(String, nullable=False, server_default=text("'pending'"))
    progress: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    error: Mapped[str | None] = mapped_column(String, nullable=True)

    payload: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    result: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )


class AccountDiscoverySummary(Base):
    __tablename__ = "account_discovery_summary"

    account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("accounts.id", ondelete="CASCADE"), primary_key=True
    )
    summary_text: Mapped[str | None] = mapped_column(String, nullable=True)
    source_document_ids: Mapped[list[uuid.UUID]] = mapped_column(
        ARRAY(UUID(as_uuid=True)), nullable=False, server_default=text("'{}'")
    )
    generated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    generated_by_job_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
