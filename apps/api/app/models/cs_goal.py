"""M14b — CSGoal ORM. Mirrors public.cs_goals.

One row per goal; phases + initiatives + history are jsonb columns.
Soft-deleted goals stay in the table with deleted_at + reason set so
the audit trail survives.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, String, text
from sqlalchemy.dialects.postgresql import ENUM, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

# 05-Jun — migration 0060 dropped the cs_goal_category ENUM and switched the
# column to plain text so the 03-Jun category vocabulary (cost_reduction,
# esg_responsible_sourcing, enhanced_supplier_discovery, negotiation_leverage,
# etc.) flows through without DDL churn. The ORM was still bound to the old
# 5-value ENUM, which made any new-vocab row throw `KeyError` on SELECT —
# discovered when the [DEMO] seed landed on Mondelez. Mapping `category` as
# plain String aligns the ORM with the live schema.

CSGoalAlignment = ENUM(
    "not_started", "partial", "aligned",
    name="cs_goal_alignment",
    create_type=False,
)

# 08-Jun · validation_status column is a Postgres ENUM
# (cs_goal_validation_status) but was mapped as plain String. asyncpg
# sends VARCHAR for str-typed columns, which PG rejects on UPDATE
# (DatatypeMismatchError). Wiring the real enum type silences that.
CSGoalValidationStatus = ENUM(
    "pending", "accepted", "flagged", "removed",
    name="cs_goal_validation_status",
    create_type=False,
)


class CSGoal(Base):
    __tablename__ = "cs_goals"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False
    )

    title: Mapped[str] = mapped_column(String, nullable=False)
    # 12-Jun bug 248-a — origin: 'vpd' (extracted from a VPD), 'manual'
    # (CSM-typed), 'mom' (reserved). Drives the Goal Validation default
    # filter. Migration 0079.
    source: Mapped[str] = mapped_column(
        String, nullable=False, server_default=text("'manual'")
    )
    category: Mapped[str] = mapped_column(
        String, nullable=False, server_default=text("'other'")
    )
    target_value: Mapped[str | None] = mapped_column(String, nullable=True)
    target_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    owner: Mapped[str | None] = mapped_column(String, nullable=True)
    alignment_status: Mapped[str] = mapped_column(
        CSGoalAlignment, nullable=False, server_default=text("'not_started'")
    )

    phase_a: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=text("'{}'"))
    phase_b: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=text("'{}'"))
    phase_c: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=text("'{}'"))

    # 03-Jun — CS Handoff prototype port. validation_status is the CSM's
    # per-goal sign-off and is independent of alignment_status (Phase A/B/C
    # progress). The phase_*_completed_at timestamps drive the prototype's
    # per-phase "Done" badge.
    validation_status: Mapped[str] = mapped_column(
        CSGoalValidationStatus, nullable=False, server_default=text("'pending'")
    )
    flag_note: Mapped[str | None] = mapped_column(String, nullable=True)
    phase_a_completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    phase_b_completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    phase_c_completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    initiatives: Mapped[list] = mapped_column(JSONB, nullable=False, server_default=text("'[]'"))
    history: Mapped[list] = mapped_column(JSONB, nullable=False, server_default=text("'[]'"))

    # Soft delete — never hard-delete; deleted_reason is enforced by CHECK.
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_reason: Mapped[str | None] = mapped_column(String, nullable=True)
    deleted_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )
    updated_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
