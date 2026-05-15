"""Account ORM — mirrors public.accounts."""

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Boolean, Date, DateTime, Numeric, SmallInteger, String, text
from sqlalchemy.dialects.postgresql import ARRAY, ENUM, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

CSEntryType = ENUM("A", "B", name="cs_entry_type", create_type=False)


class Account(Base):
    __tablename__ = "accounts"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    slug: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    industry: Mapped[str | None] = mapped_column(String, nullable=True)
    region: Mapped[str | None] = mapped_column(String, nullable=True)
    country: Mapped[str | None] = mapped_column(String, nullable=True)

    csm_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    co_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)

    category: Mapped[str | None] = mapped_column(String, nullable=True)
    tier: Mapped[str | None] = mapped_column(String, nullable=True)
    account_type: Mapped[str | None] = mapped_column(String, nullable=True)
    segment: Mapped[str | None] = mapped_column(String, nullable=True)

    current_acv: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    target_acv: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)

    contract_start: Mapped[date | None] = mapped_column(Date, nullable=True)
    contract_end: Mapped[date | None] = mapped_column(Date, nullable=True)
    renewal_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    health_score: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    last_activity_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    handed_off_to_solutioning: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    handed_off_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    handed_off_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)

    # Sales signing gate (M13). gate_signed flips to true via the dedicated
    # /sign endpoint, never via the generic account PATCH. Renewal + VDD
    # dates are derived from signed_date + term in the route, stored for
    # sortability.
    gate_signed: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    gate_signed_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    gate_contract_acv: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    gate_contract_term: Mapped[str | None] = mapped_column(String, nullable=True)
    gate_renewal_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    gate_bvd_due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    gate_confirmed_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    gate_confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    gate_unlocked: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    gate_unlock_reason: Mapped[str | None] = mapped_column(String, nullable=True)
    gate_unlocked_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    gate_unlocked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    gate_contract_doc: Mapped[str | None] = mapped_column(String, nullable=True)
    gate_contract_doc_at: Mapped[date | None] = mapped_column(Date, nullable=True)
    gate_contract_modules: Mapped[list[str]] = mapped_column(
        ARRAY(String), nullable=False, server_default=text("'{}'")
    )
    gate_platform_tier: Mapped[str | None] = mapped_column(String, nullable=True)
    gate_account_segment: Mapped[str | None] = mapped_column(String, nullable=True)
    gate_subscribers: Mapped[str | None] = mapped_column(String, nullable=True)
    # Handover quality check — small dict of 4 manual overrides.
    handover_quality_check: Mapped[dict] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'")
    )

    # CS Onboarding (M14). cs_entry_type drives which sub-form renders:
    # 'A' = clean handover from Sales; 'B' = mid-contract pickup with
    # CSM-typed baseline context.
    cs_entry_type: Mapped[str | None] = mapped_column(CSEntryType, nullable=True)
    cs_entry_b_context: Mapped[str | None] = mapped_column(String, nullable=True)
    cs_entry_b_goals: Mapped[str | None] = mapped_column(String, nullable=True)
    # CSM-side acknowledgement of the handover items (separate from the
    # Sales-side handover_quality_check above — two-sided handshake).
    cs_handover_checklist: Mapped[dict] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'")
    )
    # Three mandatory roles: commercial / champion / category. Each value is
    # {name, email, phone}. Empty dict = nothing populated.
    cs_stakeholders: Mapped[dict] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'")
    )

    # M19 — Success Contract. CSM's commitment to the client. Three-lock
    # structure (primary metric / measurement method / value narrative).
    # success_contract_locked_at = null → in-draft; non-null → locked.
    success_contract: Mapped[dict] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'")
    )
    success_contract_locked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    success_contract_locked_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
