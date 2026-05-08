"""AK03.b — ClientContact ORM. Mirrors public.client_contacts (BRD table 12)."""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, String, text
from sqlalchemy.dialects.postgresql import ENUM, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

ContactFunction = ENUM(
    "procurement", "supply_chain", "finance", "operations", "it", "other",
    name="contact_function", create_type=False,
)
ContactSeniority = ENUM(
    "cxo", "vp", "director", "manager", "other",
    name="contact_seniority", create_type=False,
)
ContactDecisionPower = ENUM(
    "executive_sponsor", "influencer", "champion", "detractor", "unknown",
    name="contact_decision_power", create_type=False,
)


class ClientContact(Base):
    __tablename__ = "client_contacts"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    account_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)

    name: Mapped[str] = mapped_column(String, nullable=False)
    title: Mapped[str | None] = mapped_column(String, nullable=True)
    email: Mapped[str | None] = mapped_column(String, nullable=True)
    phone: Mapped[str | None] = mapped_column(String, nullable=True)

    function: Mapped[str | None] = mapped_column(ContactFunction, nullable=True)
    seniority: Mapped[str | None] = mapped_column(ContactSeniority, nullable=True)
    decision_power: Mapped[str | None] = mapped_column(ContactDecisionPower, nullable=True)
    notes: Mapped[str | None] = mapped_column(String, nullable=True)

    is_spoc: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    is_sponsor: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
