"""M26 — Growth & Pipeline schemas."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

PlayMode = Literal["rescue", "retain", "expand"]


class PlayOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    account_id: UUID
    title: str
    value_usd: Decimal
    prob: int
    when_text: str | None
    trigger_text: str | None
    modes: list[PlayMode]
    role: str | None
    added_by: UUID | None
    hidden: bool
    created_at: datetime
    updated_at: datetime


class PlayListResponse(BaseModel):
    items: list[PlayOut]
    total: int
    is_editable: bool


class PlayCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=400)
    value_usd: Decimal = Field(default=Decimal("0"))
    prob: int = Field(default=0, ge=0, le=100)
    when_text: str | None = Field(None, max_length=200)
    trigger_text: str | None = Field(None, max_length=600)
    modes: list[PlayMode] = Field(default_factory=list)
    role: str | None = Field(None, max_length=200)


class PlayUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=400)
    value_usd: Decimal | None = None
    prob: int | None = Field(None, ge=0, le=100)
    when_text: str | None = Field(None, max_length=200)
    trigger_text: str | None = Field(None, max_length=600)
    modes: list[PlayMode] | None = None
    role: str | None = Field(None, max_length=200)
    hidden: bool | None = None


class ModeBreakdown(BaseModel):
    """Component scores from the appetite calculation — surfaced in the
    "How is this calculated?" expander."""

    health_pts: int
    sig_pts: int
    renew_pts: int
    arr_pts: int
    arr_status: Literal["on_track", "behind", "declining", "n/a"]
    arr_target_pct: int          # % growth target for this tier+type
    target_acv_usd: Decimal
    projected_acv_usd: Decimal
    utilization_gate: bool


class AppetiteOut(BaseModel):
    """GET /accounts/:id/appetite-score response."""

    account_id: UUID
    score: int                   # 0..100
    recommended_mode: PlayMode
    current_mode: PlayMode       # = override if set else recommended
    is_overridden: bool
    breakdown: ModeBreakdown


class ModeOverrideUpdate(BaseModel):
    """POST /accounts/:id/plan-mode body. Null clears the override and
    falls back to the auto recommendation."""

    mode: PlayMode | None = None
