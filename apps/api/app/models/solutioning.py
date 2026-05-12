"""AK03.d — AccountSolutioning ORM. Mirrors public.account_solutioning."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, text
from sqlalchemy.dialects.postgresql import ARRAY, ENUM, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

EngagementType = ENUM(
    "one_time", "retainer", "subscription", "pilot", "other",
    name="engagement_type", create_type=False,
)

ShValidation = ENUM(
    "confirmed", "partially_confirmed", "revised",
    name="sh_validation", create_type=False,
)


class AccountSolutioning(Base):
    __tablename__ = "account_solutioning"

    account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("accounts.id", ondelete="CASCADE"), primary_key=True
    )

    proposed_solution: Mapped[str | None] = mapped_column(String, nullable=True)
    engagement_type: Mapped[str | None] = mapped_column(EngagementType, nullable=True)
    engagement_duration_months: Mapped[int | None] = mapped_column(Integer, nullable=True)
    value_themes: Mapped[list[str]] = mapped_column(
        ARRAY(String), nullable=False, server_default=text("'{}'")
    )
    value_definition: Mapped[str | None] = mapped_column(String, nullable=True)
    estimated_value_musd: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)

    ai_extracted_from_doc: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    ai_extracted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ai_edited: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))

    # Solutioning → Sales Hand-off lock. While locked, PATCH on structured
    # fields is rejected; unlock first to re-pass.
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    locked_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)

    # M13 — Sales Hand-off context. The first three (`sh_value_from_solutioning`,
    # `sh_value_themes_from_solutioning`, `sh_value_received_at`) are set
    # automatically by the lock endpoint as a snapshot of what Solutioning
    # passed. The remaining fields are filled in by Sales during handoff.
    sh_value_from_solutioning: Mapped[str | None] = mapped_column(String, nullable=True)
    sh_value_themes_from_solutioning: Mapped[str | None] = mapped_column(String, nullable=True)
    sh_value_received_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    sh_value_validation: Mapped[str | None] = mapped_column(ShValidation, nullable=True)
    sh_validation_notes: Mapped[str | None] = mapped_column(String, nullable=True)
    sh_go_live_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    sh_first_checkpoint: Mapped[date | None] = mapped_column(Date, nullable=True)
    sh_stakeholder_signoff: Mapped[str | None] = mapped_column(String, nullable=True)
    sh_commercial_context: Mapped[str | None] = mapped_column(String, nullable=True)
    sales_watchouts: Mapped[str | None] = mapped_column(String, nullable=True)
    handoff_file_name: Mapped[str | None] = mapped_column(String, nullable=True)

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )
    updated_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
