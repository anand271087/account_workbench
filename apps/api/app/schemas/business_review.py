"""Business Review schemas.

The wire format is intentionally permissive (`extra="allow"`) on the
snapshot block so the renderer can carry additional fields between
gather → render without schema bumps. The list/get endpoints serialise
the BR row metadata; download endpoints stream binary.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

BRCadence = Literal["monthly", "quarterly", "renewal", "custom"]


SLIDE_IDS = (
    "s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9",
    "s10", "s11", "s12", "s13", "s14", "s15", "s16", "s17", "s18",
)
SlideId = Literal[
    "s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9",
    "s10", "s11", "s12", "s13", "s14", "s15", "s16", "s17", "s18",
]


class GenerateBRRequest(BaseModel):
    """POST /accounts/:id/business-reviews/generate body.

    For `cadence='custom'` the caller MUST supply both period_start and
    period_end. For other cadences they're derived server-side.

    `slide_ids` lets the user customize which of the 12 slides land in
    the rendered deck. Omit / send null to include all 12 (default).
    """

    cadence: BRCadence
    period_start: date | None = None
    period_end: date | None = None
    # Optional manual label override. When omitted the service builds a
    # default label from cadence + dates (e.g. "June 2026", "Q2 2026").
    period_label: str | None = None
    slide_ids: list[SlideId] | None = None


class BROut(BaseModel):
    """Row metadata. Excludes the heavy html/pdf/pptx columns."""

    model_config = ConfigDict(from_attributes=True, extra="allow")

    id: UUID
    account_id: UUID
    cadence: BRCadence
    period_label: str
    period_start: date | None = None
    period_end: date | None = None
    generated_by: UUID | None = None
    generated_by_name: str | None = None
    generated_at: datetime


class BRListResponse(BaseModel):
    items: list[BROut] = Field(default_factory=list)
    total: int = 0


class BRDataSnapshot(BaseModel):
    """The 12-section frozen analytics snapshot.

    Sections that have no data render as em-dashes in the deck; the
    snapshot still carries the empty containers so the renderer template
    is uniform.
    """

    model_config = ConfigDict(extra="allow")

    meta: dict[str, Any] = Field(default_factory=dict)
    cover: dict[str, Any] = Field(default_factory=dict)
    custom_credits: dict[str, Any] = Field(default_factory=dict)
    risks_open_asks: dict[str, Any] = Field(default_factory=dict)
    executive_snapshot: dict[str, Any] = Field(default_factory=dict)
    contract_summary: dict[str, Any] = Field(default_factory=dict)
    accomplishments: list[dict[str, Any]] = Field(default_factory=list)
    upsell_pipeline: list[dict[str, Any]] = Field(default_factory=list)
    scores_12: list[dict[str, Any]] = Field(default_factory=list)
    subscribers_engagement: dict[str, Any] = Field(default_factory=dict)
    live_ai: dict[str, Any] = Field(default_factory=dict)
    inflation_watch: dict[str, Any] = Field(default_factory=dict)
    # Module deep-dives (slides 13-18).
    mmd_modules: dict[str, Any] = Field(default_factory=dict)
    abi_intel: dict[str, Any] = Field(default_factory=dict)
    supplier_watch: dict[str, Any] = Field(default_factory=dict)
    benchmark: dict[str, Any] = Field(default_factory=dict)
    engagement: dict[str, Any] = Field(default_factory=dict)
    super_users: list[dict[str, Any]] = Field(default_factory=list)
    nps: dict[str, Any] = Field(default_factory=dict)
