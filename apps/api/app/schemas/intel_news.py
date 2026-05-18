"""M28 — External Intelligence schemas."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

IntelCategory = Literal[
    "financial_performance",
    "supply_chain",
    "supplier_strategy",
    "expansion_capex",
    "regulatory_compliance",
    "sustainability_esg",
    "digital_transformation",
    "risk_geopolitical",
    "product_innovation",
    "m_and_a",
]

SignalRelevance = Literal["high", "medium", "low"]


class IntelNewsOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    account_id: UUID
    category: IntelCategory
    headline: str
    summary: str | None
    source: str | None
    source_url: str | None
    news_date: date | None
    signal_relevance: SignalRelevance
    is_new: bool
    signal_created: bool
    signal_id: UUID | None
    ai_generated: bool
    hidden: bool
    added_by: UUID | None
    created_at: datetime
    updated_at: datetime


class IntelNewsListResponse(BaseModel):
    items: list[IntelNewsOut]
    total: int
    is_editable: bool


class IntelNewsCreate(BaseModel):
    category: IntelCategory
    headline: str = Field(..., min_length=1, max_length=400)
    summary: str | None = Field(None, max_length=2000)
    source: str | None = Field(None, max_length=240)
    source_url: str | None = Field(None, max_length=600)
    news_date: date | None = None
    signal_relevance: SignalRelevance = "medium"


class IntelNewsUpdate(BaseModel):
    category: IntelCategory | None = None
    headline: str | None = Field(None, min_length=1, max_length=400)
    summary: str | None = Field(None, max_length=2000)
    source: str | None = Field(None, max_length=240)
    source_url: str | None = Field(None, max_length=600)
    news_date: date | None = None
    signal_relevance: SignalRelevance | None = None
    is_new: bool | None = None
    hidden: bool | None = None


class IntelRefreshResponse(BaseModel):
    """Result of POST /accounts/:id/intel-news/refresh."""

    created: int
    is_stub: bool


# Pushing a news item as a soft signal — empty body, server derives type
# from category (and impact from signal_relevance).
class PushAsSignalBody(BaseModel):
    model_config = ConfigDict(extra="allow")
