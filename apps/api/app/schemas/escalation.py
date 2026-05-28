"""Escalation schemas — port of prototype notes.escalations[] shape."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

EscalationType = Literal["director", "sales", "joint"]
EscalationStatus = Literal["open", "in_progress", "resolved"]


class EscalationOut(BaseModel):
    """One escalation entry on accounts.escalations[]."""

    model_config = ConfigDict(extra="allow")

    id: UUID
    raised_at: datetime
    raised_by_user_id: UUID | None = None
    raised_by_name: str | None = None
    reason: str
    escalation_type: EscalationType
    owner: str
    next_action: str | None = None
    status: EscalationStatus = "open"
    resolved_at: datetime | None = None
    resolved_by_user_id: UUID | None = None
    resolved_note: str | None = None


class EscalationCreate(BaseModel):
    """Create payload — fields the user fills in the modal."""

    reason: str = Field(..., min_length=5, max_length=2000)
    escalation_type: EscalationType
    owner: str = Field(..., min_length=2, max_length=200)
    next_action: str | None = Field(None, max_length=1000)


class EscalationResolve(BaseModel):
    """Resolve payload — admin marks an escalation closed with a note."""

    resolved_note: str = Field(..., min_length=5, max_length=2000)


class EscalationListResponse(BaseModel):
    items: list[EscalationOut]
    total: int
    open_count: int
    is_editable: bool
    can_resolve: bool
    # Stakeholder emails for the "mail everyone" mailto: action — the
    # CSM + Commercial Owner + a static admin notify-list.
    notify_emails: list[str] = Field(default_factory=list)
