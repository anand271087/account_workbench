"""M20 — Success Metric ORM."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, text
from sqlalchemy.dialects.postgresql import ENUM, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

MetricType = ENUM(
    "quantitative", "qualitative", name="metric_type", create_type=False
)
MetricStatusOverride = ENUM(
    "green", "amber", "red", "grey", name="metric_status_override", create_type=False
)


class SuccessMetric(Base):
    __tablename__ = "success_metrics"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False
    )

    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(String, nullable=True)
    metric_type: Mapped[str] = mapped_column(MetricType, nullable=False, server_default=text("'quantitative'"))
    unit: Mapped[str | None] = mapped_column(String, nullable=True)
    target_value: Mapped[str | None] = mapped_column(String, nullable=True)
    current_value: Mapped[str | None] = mapped_column(String, nullable=True)
    status_override: Mapped[str | None] = mapped_column(MetricStatusOverride, nullable=True)

    log_entries: Mapped[list] = mapped_column(
        JSONB, nullable=False, server_default=text("'[]'")
    )

    source: Mapped[str] = mapped_column(String, nullable=False, server_default=text("'manual'"))

    last_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_updated_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )

    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    deleted_reason: Mapped[str | None] = mapped_column(String, nullable=True)
