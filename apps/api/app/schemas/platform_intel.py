"""M29 — Platform Intelligence schemas.

Mirrors the prototype's `a.catIntel / a.supplierWatch / a.modulesIntel.abi /
a.engagement / a.nps / a.userSegmentation` shapes. Stored as a single
jsonb on the account so the shape can evolve without DDL churn — same
pattern as M19/M22/M23.

`extra="allow"` everywhere so the prototype can grow new fields (heat
levels, additional supplier risk tiers, etc.) without a schema bump.
"""

from __future__ import annotations

from datetime import date as _date
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


# ============================================================
# Category Watch
# ============================================================


class SectionAvg(BaseModel):
    """Avg time per category-page section (minutes)."""

    model_config = ConfigDict(extra="allow")

    price: float = 0
    supplier: float = 0
    market: float = 0
    forecast: float = 0
    risk: float = 0


class CatHeat(BaseModel):
    model_config = ConfigDict(extra="allow")

    name: str
    visits: int = 0
    heat: Literal["hot", "warm", "whitespace", "cold"] = "cold"


class CatInsight(BaseModel):
    model_config = ConfigDict(extra="allow")

    text: str
    tone: Literal["ok", "warn", "red"] = "ok"


class CatIntel(BaseModel):
    model_config = ConfigDict(extra="allow")

    section_avg: SectionAvg = Field(default_factory=SectionAvg)
    top_cats: list[CatHeat] = Field(default_factory=list)
    insights: list[CatInsight] = Field(default_factory=list)


# ============================================================
# Supplier Watch
# ============================================================


class SupplierByRisk(BaseModel):
    model_config = ConfigDict(extra="allow")

    high: int = 0
    med_high: int = 0
    med: int = 0
    low: int = 0


class TrackedSupplier(BaseModel):
    model_config = ConfigDict(extra="allow")

    name: str
    cat: str | None = None
    country: str | None = None
    risk: Literal["high", "med_high", "med", "low"] = "med"


class SupplierWatch(BaseModel):
    model_config = ConfigDict(extra="allow")

    tracked: int = 0
    by_risk: SupplierByRisk = Field(default_factory=SupplierByRisk)
    suppliers: list[TrackedSupplier] = Field(default_factory=list)


# ============================================================
# Abi Engagement
# ============================================================


class AbiComplexityMix(BaseModel):
    model_config = ConfigDict(extra="allow")

    l1a: int = 0
    l1m: int = 0
    l2: int = 0
    l3: int = 0
    l4: int = 0


class AbiIntel(BaseModel):
    model_config = ConfigDict(extra="allow")

    total_queries: int = 0
    queries_per_user: float = 0
    resolution_rate: str | None = None
    avg_response: str | None = None
    complexity_mix: AbiComplexityMix = Field(default_factory=AbiComplexityMix)
    top_types: list[str] = Field(default_factory=list)
    insight: str | None = None


# ============================================================
# Industry Benchmark
# ============================================================


class BenchmarkAvgs(BaseModel):
    model_config = ConfigDict(extra="allow")

    avg_health: int = 0
    avg_seat_pct: int = 0
    avg_abi: int = 0
    avg_logins: int = 0
    avg_engagement: int = 0


# ============================================================
# Engagement Activeness
# ============================================================


class UserSegmentation(BaseModel):
    model_config = ConfigDict(extra="allow")

    cat_managers: int = 0
    buyers: int = 0
    sourcing_analysts: int = 0
    directors: int = 0
    exec_team: int = 0
    coe: int = 0
    cpo: int = 0


class EngagementIntel(BaseModel):
    model_config = ConfigDict(extra="allow")

    alerts: int = 0
    newsletters: int = 0
    webinars: int = 0
    podcasts: int = 0
    training: int = 0
    user_segmentation: UserSegmentation = Field(default_factory=UserSegmentation)


# ============================================================
# NPS
# ============================================================


class VocItem(BaseModel):
    model_config = ConfigDict(extra="allow")

    quote: str
    author: str | None = None
    role: str | None = None
    sentiment: Literal["positive", "neutral", "negative"] = "neutral"
    date: _date | None = None


class NpsIntel(BaseModel):
    model_config = ConfigDict(extra="allow")

    score: int | None = None
    voc: list[VocItem] = Field(default_factory=list)


# ============================================================
# Analytics — usage + modules + super_users
# ============================================================


class UsageIntel(BaseModel):
    """12-month logins + active users + adoption breakdown."""

    model_config = ConfigDict(extra="allow")

    months: list[str] = Field(default_factory=list)            # e.g. ["Apr", ...]
    monthly_logins: list[int] = Field(default_factory=list)
    monthly_active: list[int] = Field(default_factory=list)
    licensed_users: int = 0
    active_seats: int = 0
    inactive_seats: int = 0


class ModulesMonthly(BaseModel):
    model_config = ConfigDict(extra="allow")

    mmd: list[int] = Field(default_factory=list)
    abi: list[int] = Field(default_factory=list)
    sd: list[int] = Field(default_factory=list)
    dl: list[int] = Field(default_factory=list)
    bm: list[int] = Field(default_factory=list)


class ModulesIntel(BaseModel):
    """Per-period totals + 12-month monthly trend per module."""

    model_config = ConfigDict(extra="allow")

    mmd: int = 0
    abi: int = 0
    sd: int = 0
    dl: int = 0
    bm: int = 0
    monthly: ModulesMonthly = Field(default_factory=ModulesMonthly)


class SuperUser(BaseModel):
    model_config = ConfigDict(extra="allow")

    name: str
    role: str | None = None
    logins: int = 0
    cw_views: int = 0
    abi_queries: int = 0
    sd_searches: int = 0
    hours: int = 0


# ============================================================
# Top-level container
# ============================================================


class PlatformIntelOut(BaseModel):
    """GET /accounts/:id/platform-intel response."""

    model_config = ConfigDict(extra="allow")

    account_id: UUID

    cat_intel: CatIntel = Field(default_factory=CatIntel)
    supplier_watch: SupplierWatch = Field(default_factory=SupplierWatch)
    abi: AbiIntel = Field(default_factory=AbiIntel)
    benchmark: BenchmarkAvgs = Field(default_factory=BenchmarkAvgs)
    engagement: EngagementIntel = Field(default_factory=EngagementIntel)
    nps: NpsIntel = Field(default_factory=NpsIntel)
    # M30 — analytics.
    usage: UsageIntel = Field(default_factory=UsageIntel)
    modules: ModulesIntel = Field(default_factory=ModulesIntel)
    super_users: list[SuperUser] = Field(default_factory=list)

    has_data: bool = False
    is_editable: bool = False


class PlatformIntelUpdate(BaseModel):
    """Partial PATCH of any top-level section. Lets admin / CSM edit a
    sub-section without touching the rest."""

    model_config = ConfigDict(extra="allow")

    cat_intel: CatIntel | None = None
    supplier_watch: SupplierWatch | None = None
    abi: AbiIntel | None = None
    benchmark: BenchmarkAvgs | None = None
    engagement: EngagementIntel | None = None
    nps: NpsIntel | None = None
    usage: UsageIntel | None = None
    modules: ModulesIntel | None = None
    super_users: list[SuperUser] | None = None
