"""M12 — MeetingBrief ORM. Mirrors public.meeting_briefs.

One brief per account, JSONB columns for the deep nested collections.
Scalars carry the call info + cheat-sheet text. Pydantic handles all
structural validation on the way in; ORM just stores the document.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, text
from sqlalchemy.dialects.postgresql import ENUM, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

BriefCallType = ENUM(
    "first_discovery", "qbr", "renewal", "expansion", "other",
    name="brief_call_type", create_type=False,
)


class MeetingBrief(Base):
    __tablename__ = "meeting_briefs"

    account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("accounts.id", ondelete="CASCADE"), primary_key=True
    )

    # Call info scalars.
    call_type: Mapped[str | None] = mapped_column(BriefCallType, nullable=True)
    call_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    call_time: Mapped[str | None] = mapped_column(String, nullable=True)
    call_platform: Mapped[str | None] = mapped_column(String, nullable=True)
    call_duration_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)

    win_condition: Mapped[str | None] = mapped_column(String, nullable=True)
    cheat_sheet_win_condition_short: Mapped[str | None] = mapped_column(String, nullable=True)

    # JSONB collections — Postgres enforces array-ness via CHECK; Pydantic
    # validates each row's shape on PATCH.
    company_snapshot: Mapped[list] = mapped_column(JSONB, nullable=False, server_default=text("'[]'"))
    call_timer: Mapped[list] = mapped_column(JSONB, nullable=False, server_default=text("'[]'"))
    attendees: Mapped[list] = mapped_column(JSONB, nullable=False, server_default=text("'[]'"))
    minefields: Mapped[list] = mapped_column(JSONB, nullable=False, server_default=text("'[]'"))
    objectives: Mapped[list] = mapped_column(JSONB, nullable=False, server_default=text("'[]'"))
    discovery_questions: Mapped[list] = mapped_column(JSONB, nullable=False, server_default=text("'[]'"))
    value_anchors: Mapped[list] = mapped_column(JSONB, nullable=False, server_default=text("'[]'"))
    email_insights: Mapped[list] = mapped_column(JSONB, nullable=False, server_default=text("'[]'"))
    public_signals: Mapped[list] = mapped_column(JSONB, nullable=False, server_default=text("'[]'"))
    news: Mapped[list] = mapped_column(JSONB, nullable=False, server_default=text("'[]'"))
    annual_reports: Mapped[list] = mapped_column(JSONB, nullable=False, server_default=text("'[]'"))
    closing_scenarios: Mapped[list] = mapped_column(JSONB, nullable=False, server_default=text("'[]'"))
    cheat_sheet_never_say: Mapped[list] = mapped_column(JSONB, nullable=False, server_default=text("'[]'"))
    cheat_sheet_opening_asks: Mapped[list] = mapped_column(JSONB, nullable=False, server_default=text("'[]'"))

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )
    updated_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
