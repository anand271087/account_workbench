"""M12 — Pre-Meeting Brief schemas. Validates the JSONB collection shapes.

Each nested model mirrors one row inside its JSONB column. Pydantic v2
runs structural validation on PATCH; bad payloads return 422 without
ever hitting the DB.

Naming: we use snake_case on the wire so the JSONB stays Pythonic. The
v20 prototype used camelCase (callType, winCondition, primaryObjective);
we translate that on the frontend.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

BriefCallType = Literal["first_discovery", "qbr", "renewal", "expansion", "other"]
Severity = Literal["high", "caution"]
AttendeeCompany = Literal["client", "beroe"]
ScenarioType = Literal["good", "neutral", "poor"]


# ---------- Nested item shapes (one per JSONB column) ----------


class SnapshotStat(BaseModel):
    num: str = Field(..., max_length=40)
    label: str = Field(..., max_length=120)
    sub: str | None = Field(None, max_length=120)


class CallTimerSlot(BaseModel):
    time: str = Field(..., max_length=40)
    label: str = Field(..., max_length=200)


class Attendee(BaseModel):
    initials: str = Field(..., max_length=4)
    name: str = Field(..., max_length=120)
    role: str | None = Field(None, max_length=160)
    company: AttendeeCompany
    is_self: bool = False
    avatar_color: str | None = Field(None, max_length=24)  # hex or token
    objectives: list[str] = Field(default_factory=list)
    primary_objective: str | None = Field(None, max_length=80)
    background: list[str] = Field(default_factory=list)
    opening_ask: str | None = Field(None, max_length=600)


class Minefield(BaseModel):
    severity: Severity
    type: str | None = Field(None, max_length=60)
    text: str = Field(..., max_length=400)
    why: str | None = Field(None, max_length=400)


class Objective(BaseModel):
    rank: int = Field(..., ge=1, le=20)
    name: str = Field(..., max_length=200)
    confidence: int = Field(..., ge=1, le=5)
    bullets: list[str] = Field(default_factory=list)
    beroe: str | None = Field(None, max_length=1200)
    sources: list[str] = Field(default_factory=list)


class DiscoveryQuestion(BaseModel):
    objective: str = Field(..., max_length=200)
    rank: int = Field(..., ge=1, le=20)
    person: str = Field(..., max_length=120)
    from_email: bool = False
    text: str = Field(..., max_length=600)
    # H46 — Category dropdown on Discovery questions. Free-form so prototype
    # categories (Commercial / Risk / People / Process / Sustainability /
    # Technology) and any future ones flow through without schema churn.
    category: str | None = Field(None, max_length=60)


class ValueAnchorPoint(BaseModel):
    text: str = Field(..., max_length=600)
    note: str | None = Field(None, max_length=400)


class ValueAnchor(BaseModel):
    objective: str = Field(..., max_length=200)
    points: list[ValueAnchorPoint] = Field(default_factory=list)


class EmailInsight(BaseModel):
    meta: str = Field(..., max_length=200)
    bullets: list[str] = Field(default_factory=list)


class PublicSignal(BaseModel):
    person: str | None = Field(None, max_length=120)
    headline: str = Field(..., max_length=240)
    text: str | None = Field(None, max_length=1200)
    url: str | None = Field(None, max_length=600)
    tag: str | None = Field(None, max_length=60)


class NewsItem(BaseModel):
    days_ago: int | None = Field(None, ge=0, le=3650)
    headline: str = Field(..., max_length=240)
    source: str | None = Field(None, max_length=120)
    signal: str | None = Field(None, max_length=600)
    url: str | None = Field(None, max_length=600)
    tag: str | None = Field(None, max_length=60)


class AnnualReportItem(BaseModel):
    title: str = Field(..., max_length=240)
    year: int | None = Field(None, ge=1900, le=2100)
    url: str | None = Field(None, max_length=600)
    bullets: list[str] = Field(default_factory=list)


class ClosingScenario(BaseModel):
    type: ScenarioType
    label: str | None = Field(None, max_length=80)
    text: str = Field(..., max_length=1200)


# ---------- Top-level read / write models ----------


class MeetingBriefOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    account_id: UUID

    call_type: BriefCallType | None = None
    call_date: date | None = None
    call_time: str | None = None
    call_platform: str | None = None
    call_duration_minutes: int | None = None

    win_condition: str | None = None
    cheat_sheet_win_condition_short: str | None = None

    company_snapshot: list[SnapshotStat] = Field(default_factory=list)
    call_timer: list[CallTimerSlot] = Field(default_factory=list)
    attendees: list[Attendee] = Field(default_factory=list)
    minefields: list[Minefield] = Field(default_factory=list)
    objectives: list[Objective] = Field(default_factory=list)
    discovery_questions: list[DiscoveryQuestion] = Field(default_factory=list)
    value_anchors: list[ValueAnchor] = Field(default_factory=list)
    email_insights: list[EmailInsight] = Field(default_factory=list)
    public_signals: list[PublicSignal] = Field(default_factory=list)
    news: list[NewsItem] = Field(default_factory=list)
    annual_reports: list[AnnualReportItem] = Field(default_factory=list)
    closing_scenarios: list[ClosingScenario] = Field(default_factory=list)
    cheat_sheet_never_say: list[str] = Field(default_factory=list)
    cheat_sheet_opening_asks: list[str] = Field(default_factory=list)
    # H46 — "Categories" tab in the prototype's brief. Free-form strings so
    # prototype vocab (commodity / category names) flows through.
    categories: list[str] = Field(default_factory=list)

    updated_at: datetime
    updated_by: UUID | None
    is_editable: bool = False


class MeetingBriefUpdate(BaseModel):
    """Whole-document PATCH — caller sends only the keys it wants to change."""

    call_type: BriefCallType | None = None
    call_date: date | None = None
    call_time: str | None = Field(None, max_length=120)
    call_platform: str | None = Field(None, max_length=120)
    call_duration_minutes: int | None = Field(None, ge=0, le=1440)

    win_condition: str | None = Field(None, max_length=1200)
    cheat_sheet_win_condition_short: str | None = Field(None, max_length=400)

    company_snapshot: list[SnapshotStat] | None = None
    call_timer: list[CallTimerSlot] | None = None
    attendees: list[Attendee] | None = None
    minefields: list[Minefield] | None = None
    objectives: list[Objective] | None = None
    discovery_questions: list[DiscoveryQuestion] | None = None
    value_anchors: list[ValueAnchor] | None = None
    email_insights: list[EmailInsight] | None = None
    public_signals: list[PublicSignal] | None = None
    news: list[NewsItem] | None = None
    annual_reports: list[AnnualReportItem] | None = None
    closing_scenarios: list[ClosingScenario] | None = None
    cheat_sheet_never_say: list[str] | None = None
    cheat_sheet_opening_asks: list[str] | None = None
    categories: list[str] | None = None
