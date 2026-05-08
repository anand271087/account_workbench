"""AK03.d — AccountSolutioning ORM. Mirrors public.account_solutioning."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Numeric, String, text
from sqlalchemy.dialects.postgresql import ARRAY, ENUM, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

EngagementType = ENUM(
    "one_time", "retainer", "subscription", "pilot", "other",
    name="engagement_type", create_type=False,
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

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )
    updated_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
