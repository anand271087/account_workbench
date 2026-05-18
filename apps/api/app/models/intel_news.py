"""M28 — External Intelligence news items."""

from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, String, text
from sqlalchemy.dialects.postgresql import ENUM, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


IntelNewsCategory = ENUM(
    "financial_performance",
    "supply_chain",
    "supplier_strategy",
    "expansion_capex",
    "regulatory_compliance",
    "sustainability_esg",
    "digital_transformation",
    "risk_geopolitical",
    "product_innovation",
    "m_and_a",
    name="intel_news_category",
    create_type=False,
)

IntelSignalRelevance = ENUM(
    "high",
    "medium",
    "low",
    name="intel_signal_relevance",
    create_type=False,
)


class IntelNewsItem(Base):
    __tablename__ = "intel_news_items"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("accounts.id", ondelete="CASCADE"),
        nullable=False,
    )
    category: Mapped[str] = mapped_column(IntelNewsCategory, nullable=False)
    headline: Mapped[str] = mapped_column(String, nullable=False)
    summary: Mapped[str | None] = mapped_column(String, nullable=True)
    source: Mapped[str | None] = mapped_column(String, nullable=True)
    source_url: Mapped[str | None] = mapped_column(String, nullable=True)
    news_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    signal_relevance: Mapped[str] = mapped_column(
        IntelSignalRelevance, nullable=False, server_default=text("'medium'")
    )
    is_new: Mapped[bool] = mapped_column(
        nullable=False, server_default=text("true")
    )
    signal_created: Mapped[bool] = mapped_column(
        nullable=False, server_default=text("false")
    )
    signal_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("soft_signals.id", ondelete="SET NULL"),
        nullable=True,
    )
    ai_generated: Mapped[bool] = mapped_column(
        nullable=False, server_default=text("false")
    )
    hidden: Mapped[bool] = mapped_column(
        nullable=False, server_default=text("false")
    )
    added_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )
