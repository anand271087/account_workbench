"""M27 — Soft signals + account activities."""

from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, String, text
from sqlalchemy.dialects.postgresql import ARRAY, ENUM, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


SignalType = ENUM(
    "risk",
    "positive",
    "expansion",
    "neutral",
    "critical",
    name="signal_type",
    create_type=False,
)

SignalImpact = ENUM(
    "critical",
    "high",
    "medium",
    "low",
    name="signal_impact",
    create_type=False,
)

SignalStatus = ENUM(
    "active",
    "resolved",
    name="signal_status",
    create_type=False,
)

ActivityType = ENUM(
    "csm_call",
    "exec_visit",
    "product",
    "research",
    "qbr",
    "internal",
    "escalation",
    name="activity_type",
    create_type=False,
)


class SoftSignal(Base):
    __tablename__ = "soft_signals"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("accounts.id", ondelete="CASCADE"),
        nullable=False,
    )
    type: Mapped[str] = mapped_column(SignalType, nullable=False)
    category: Mapped[str | None] = mapped_column(String, nullable=True)
    signal: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(String, nullable=True)
    impact: Mapped[str] = mapped_column(
        SignalImpact, nullable=False, server_default=text("'medium'")
    )
    status: Mapped[str] = mapped_column(
        SignalStatus, nullable=False, server_default=text("'active'")
    )
    resolved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    resolved_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    resolved_note: Mapped[str | None] = mapped_column(String, nullable=True)
    valid_until: Mapped[date | None] = mapped_column(Date, nullable=True)
    source: Mapped[str | None] = mapped_column(String, nullable=True)
    ai_extracted: Mapped[bool] = mapped_column(
        nullable=False, server_default=text("false")
    )
    added_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    hidden: Mapped[bool] = mapped_column(
        nullable=False, server_default=text("false")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )


class AccountActivity(Base):
    __tablename__ = "account_activities"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("accounts.id", ondelete="CASCADE"),
        nullable=False,
    )
    type: Mapped[str] = mapped_column(ActivityType, nullable=False)
    title: Mapped[str] = mapped_column(String, nullable=False)
    summary: Mapped[str | None] = mapped_column(String, nullable=True)
    items: Mapped[str | None] = mapped_column(String, nullable=True)
    attendees: Mapped[str | None] = mapped_column(String, nullable=True)
    linked_metrics: Mapped[list[uuid.UUID]] = mapped_column(
        ARRAY(UUID(as_uuid=True)), nullable=False, server_default=text("'{}'")
    )
    file_name: Mapped[str | None] = mapped_column(String, nullable=True)
    added_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    hidden: Mapped[bool] = mapped_column(
        nullable=False, server_default=text("false")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )
