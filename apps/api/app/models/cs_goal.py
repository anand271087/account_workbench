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

CSGoalCategory = ENUM(
    "cost_savings",
    "base_rationalization",
    "risk_mitigation",
    "adoption",
    "other",
    name="cs_goal_category",
    create_type=False,
)

CSGoalAlignment = ENUM(
    "not_started", "partial", "aligned",
    name="cs_goal_alignment",
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
    category: Mapped[str] = mapped_column(
        CSGoalCategory, nullable=False, server_default=text("'other'")
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
