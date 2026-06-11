"""BusinessReview ORM (migration 0074).

One row per generated BR. Carries the cadence metadata, the analytics
snapshot, and the pre-rendered HTML/PDF/PPTX bytes.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import Date, DateTime, ForeignKey, LargeBinary, String, text
from sqlalchemy.dialects.postgresql import ENUM, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

BRCadence = ENUM(
    "monthly",
    "quarterly",
    "renewal",
    "custom",
    name="business_review_cadence",
    create_type=False,
)


class BusinessReview(Base):
    __tablename__ = "business_reviews"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False
    )
    cadence: Mapped[str] = mapped_column(BRCadence, nullable=False)
    period_label: Mapped[str] = mapped_column(String, nullable=False)
    period_start: Mapped[date | None] = mapped_column(Date, nullable=True)
    period_end: Mapped[date | None] = mapped_column(Date, nullable=True)

    generated_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )

    data_snapshot: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'::jsonb")
    )
    html: Mapped[str] = mapped_column(String, nullable=False, server_default=text("''"))
    pdf: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    pptx: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
