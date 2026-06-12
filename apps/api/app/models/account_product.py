"""Account ↔ Beroe product roster (migration 0075).

One row per (account, product). `purchased`:
  * true  → account has bought this Beroe product
  * false → explicitly not purchased
  * null  → unknown (blank cell in source data)

The `null` state is meaningful — it lets the UI distinguish a confirmed
"no" from "we don't have data yet."
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class AccountProduct(Base):
    __tablename__ = "account_products"

    account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("accounts.id", ondelete="CASCADE"),
        primary_key=True,
    )
    product_key: Mapped[str] = mapped_column(String, primary_key=True)
    purchased: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    source: Mapped[str] = mapped_column(
        String, nullable=False, server_default=text("'import'")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
