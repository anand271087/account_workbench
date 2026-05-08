"""Audit log ORM — append-only, mirrors public.audit_log.

Schema: see supabase/migrations/0001_init_schema.sql.
RLS: per matrix Q6, viewable by all VPs + CS Director + Admin (and own-actions for everyone else).
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, String, text
from sqlalchemy.dialects.postgresql import ENUM, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

AuditAction = ENUM("insert", "update", "delete", name="audit_action", create_type=False)


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    table_name: Mapped[str] = mapped_column(String, nullable=False)
    row_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    action: Mapped[str] = mapped_column(AuditAction, nullable=False)
    changed_by_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    changed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )
    field_name: Mapped[str | None] = mapped_column(String, nullable=True)
    old_value: Mapped[Any | None] = mapped_column(JSONB, nullable=True)
    new_value: Mapped[Any | None] = mapped_column(JSONB, nullable=True)
    request_id: Mapped[str | None] = mapped_column(String, nullable=True)
