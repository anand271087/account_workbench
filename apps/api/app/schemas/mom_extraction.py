"""MoM extraction — structured payload Claude returns when parsing a meeting
document. Shapes are deliberately a SUBSET of the apply targets (engagement,
contacts, brief) so the frontend can fan-out PATCH/POST calls without translation.

`is_stub=true` flags responses from the deterministic mock that runs when no
Anthropic key is configured — the UI shows a `Stub AI` chip in the review modal.
"""

from __future__ import annotations

from datetime import date
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.contact import ContactDecisionPower, ContactFunction, ContactSeniority
from app.schemas.meeting_brief import (
    Attendee,
    EmailInsight,
    NewsItem,
    PublicSignal,
    SnapshotStat,
    ValueAnchor,
)

# Brief call types we'll classify into. Kept aligned with BriefCallType in meeting_brief.
ExtractedCallType = Literal["first_discovery", "qbr", "renewal", "expansion", "other"]

# Procurement maturity (3-band — matches engagement MaturityLevel).
MaturityLevel = Literal["low", "medium", "high"]


class ExtractedAccountFields(BaseModel):
    """Informational chips in the review modal — no account PATCH endpoint yet."""

    model_config = ConfigDict(extra="allow")

    industry: str | None = None
    country: str | None = None
    headquarters: str | None = None
    annual_revenue_text: str | None = None
    tier_band: str | None = None  # e.g. "1-3B" / "3-5B"
    sf_link: str | None = None


class ExtractedEngagement(BaseModel):
    """Maps directly onto EngagementUpdate fields the user chooses to apply."""

    model_config = ConfigDict(extra="allow")

    meeting_type: str | None = None
    engagement_objective: str | None = None
    target_categories: list[str] = Field(default_factory=list)
    geographies: list[str] = Field(default_factory=list)
    spoc_text: str | None = None
    sponsor_text: str | None = None
    procurement_maturity: MaturityLevel | None = None


class ExtractedContact(BaseModel):
    """Maps to ContactCreate. `is_internal_beroe=true` means the row is a Beroe
    teammate (e.g. MI Team) and SHOULD NOT be created as a client contact —
    surfaced separately in the modal as informational."""

    model_config = ConfigDict(extra="allow")

    name: str = Field(..., max_length=200)
    title: str | None = Field(None, max_length=200)
    linkedin_url: str | None = Field(None, max_length=600)
    function: ContactFunction | None = None
    seniority: ContactSeniority | None = None
    decision_power: ContactDecisionPower | None = None
    is_spoc: bool = False
    is_sponsor: bool = False
    is_internal_beroe: bool = False


class ExtractedBrief(BaseModel):
    """Maps onto MeetingBriefUpdate — only the collections the AI can reliably
    populate from an MoM. Other brief collections (objectives, discovery_questions,
    minefields, call_timer, closing_scenarios) stay manual."""

    model_config = ConfigDict(extra="allow")

    call_date: date | None = None
    call_type: ExtractedCallType | None = None
    call_duration_minutes: int | None = Field(None, ge=0, le=1440)
    win_condition: str | None = Field(None, max_length=1200)
    company_snapshot: list[SnapshotStat] = Field(default_factory=list)
    attendees: list[Attendee] = Field(default_factory=list)
    news: list[NewsItem] = Field(default_factory=list)
    public_signals: list[PublicSignal] = Field(default_factory=list)
    value_anchors: list[ValueAnchor] = Field(default_factory=list)
    email_insights: list[EmailInsight] = Field(default_factory=list)
    cheat_sheet_never_say: list[str] = Field(default_factory=list)
    cheat_sheet_opening_asks: list[str] = Field(default_factory=list)


class MomExtractionResult(BaseModel):
    """Full payload returned by POST /accounts/:id/documents/:doc_id/extract-fields."""

    document_id: UUID
    is_stub: bool = False
    notes: str | None = Field(None, max_length=2000)

    account_fields: ExtractedAccountFields = Field(default_factory=ExtractedAccountFields)
    engagement: ExtractedEngagement = Field(default_factory=ExtractedEngagement)
    contacts: list[ExtractedContact] = Field(default_factory=list)
    brief: ExtractedBrief = Field(default_factory=ExtractedBrief)
