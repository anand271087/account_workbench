"""User ORM model — mirrors public.users.

Schema source of truth is supabase/migrations/0001_init_schema.sql.
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, String, text
from sqlalchemy.dialects.postgresql import ENUM, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

# Map to the existing Postgres `role_key` enum without trying to recreate it.
RoleKey = ENUM(
    "csm", "cs_team_manager", "cs_director", "vp_csm",
    "commercial_owner", "vp_sales",
    "solutioning_manager", "vp_solutioning",
    "inside_sales_manager", "vp_inside_sales",
    "admin",
    name="role_key",
    create_type=False,
)

UserStatus = ENUM("pending", "active", "deactivated", name="user_status", create_type=False)


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    email: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    full_name: Mapped[str | None] = mapped_column(String, nullable=True)
    role: Mapped[str] = mapped_column(RoleKey, nullable=False)
    team_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    status: Mapped[str] = mapped_column(UserStatus, nullable=False, server_default=text("'active'"))
    invited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    invited_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
