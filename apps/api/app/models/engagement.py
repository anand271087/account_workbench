"""AK03.a — AccountEngagement ORM. Mirrors public.account_engagement."""

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import ARRAY, Boolean, DateTime, Numeric, SmallInteger, String, text
from sqlalchemy.dialects.postgresql import ENUM, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

MaturityLevel = ENUM("low", "medium", "high", name="maturity_level", create_type=False)


class AccountEngagement(Base):
    __tablename__ = "account_engagement"

    account_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)

    sdr_lead: Mapped[str | None] = mapped_column(String, nullable=True)
    pre_discovery_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=False), nullable=True)
    discovery_lead: Mapped[str | None] = mapped_column(String, nullable=True)
    sales_lead: Mapped[str | None] = mapped_column(String, nullable=True)

    target_categories: Mapped[list[str]] = mapped_column(
        ARRAY(String), nullable=False, server_default=text("'{}'")
    )
    engagement_objective: Mapped[str | None] = mapped_column(String, nullable=True)

    procurement_maturity: Mapped[str | None] = mapped_column(MaturityLevel, nullable=True)
    ai_penetration: Mapped[str | None] = mapped_column(MaturityLevel, nullable=True)

    procurement_spend_musd: Mapped[Decimal | None] = mapped_column(Numeric(12, 4), nullable=True)
    geographies: Mapped[list[str]] = mapped_column(
        ARRAY(String), nullable=False, server_default=text("'{}'")
    )

    spoc_text: Mapped[str | None] = mapped_column(String, nullable=True)
    sponsor_text: Mapped[str | None] = mapped_column(String, nullable=True)
    power_users_text: Mapped[str | None] = mapped_column(String, nullable=True)

    ai_quality_score: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    ai_quality_dismissed: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )
    updated_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
