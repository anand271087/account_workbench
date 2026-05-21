"""H45/H46 — Brief AI suggest endpoint.

POST /api/v1/accounts/:id/brief/ai-suggest

Body: { "section": one of "company_snapshot" | "discovery_questions" |
                          "minefields" | "objectives" | "value_anchors" |
                          "cheat_sheet" }

Returns: { "section": ..., "suggestions": <list shape depends on section>,
           "is_stub": bool }

The suggestions match the shape MeetingBrief expects so the frontend can
splice them straight into the form state. Stubs are deterministic so the
demo always returns something.
"""

from __future__ import annotations

import json
import re
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Path, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.deps import CurrentUser
from app.core.rbac import can_view_account
from app.db.session import get_db
from app.models.account import Account
from app.models.engagement import AccountEngagement
from app.routes.accounts import _team_member_ids
from app.services import ai_quota

router = APIRouter(prefix="/api/v1/accounts", tags=["brief_ai"])


Section = Literal[
    "company_snapshot",
    "discovery_questions",
    "minefields",
    "objectives",
    "value_anchors",
    "cheat_sheet",
    "attendees",
]


class BriefAISuggestIn(BaseModel):
    section: Section


class BriefAISuggestOut(BaseModel):
    section: Section
    suggestions: list[dict] = Field(default_factory=list)
    is_stub: bool


# ============================================================
# Stubs (deterministic) — used when no Anthropic key configured
# ============================================================


def _stub_company_snapshot(name: str, industry: str | None) -> list[dict]:
    ind = industry or "the industry"
    return [
        {"num": "$2.5B", "label": "Annual Revenue", "sub": f"FY24, {name}"},
        {"num": "15,000", "label": "Employees Globally", "sub": "headcount estimate"},
        {"num": "62%", "label": "COGS", "sub": "% of revenue"},
        {"num": "8", "label": "Priority Categories", "sub": ind},
        {
            "num": "Scope 3",
            "label": "Sustainability Priority",
            "sub": "supplier emissions",
        },
    ]


def _stub_discovery_questions(name: str, industry: str | None) -> list[dict]:
    ind = industry or "your industry"
    return [
        {
            "objective": "Commodity Price Intelligence",
            "person": "Procurement Lead",
            "text": f"How far ahead do you currently have reliable price forecasts for the top 3 commodities in {ind}?",
            "category": "Commercial",
        },
        {
            "objective": "Supplier Risk",
            "person": "Risk Lead",
            "text": f"What's your fallback plan if your largest single-source supplier in {ind} goes offline?",
            "category": "Risk",
        },
        {
            "objective": "Adoption",
            "person": "Champion",
            "text": f"Who at {name} would champion a new intelligence platform with the buying team?",
            "category": "People",
        },
    ]


def _stub_minefields(name: str) -> list[dict]:
    return [
        {
            "type": "Political",
            "text": "Avoid comparing pricing to their largest competitor by name.",
            "why": "Recent acquisition tensions still raw with leadership.",
        },
        {
            "type": "Process",
            "text": "Don't promise specific savings %s in the first call.",
            "why": "Procurement at " + name + " is highly numbers-driven; over-promise = trust hit.",
        },
        {
            "type": "People",
            "text": "Defer to the SPOC on intro order — don't email the CPO directly.",
            "why": "Standard escalation etiquette here.",
        },
    ]


def _stub_objectives(name: str, industry: str | None) -> list[dict]:
    ind = industry or "the industry"
    return [
        {
            "name": "Surface category-level intelligence gaps",
            "bullets": [
                f"Map current data sources used by {name}'s sourcing team",
                "Identify 3 categories where coverage is thinnest",
            ],
            "beroe": "Beroe Live for commodity benchmarks across the top 5 categories",
        },
        {
            "name": "Quantify the cost of supplier-risk blindness",
            "bullets": [
                f"Last 12 months of supplier health flags in {ind}",
                "Estimate dollar exposure on top-spend suppliers",
            ],
            "beroe": "Supplier Risk module + escalation playbook",
        },
    ]


def _stub_value_anchors(name: str, industry: str | None) -> list[dict]:
    return [
        {
            "objective": "Commodity Price Intelligence",
            "points": [
                {"text": f"3-5% savings on top 5 commodity spend ({name}).", "note": "Industry-typical range."},
                {"text": "Avoided cost: 1 mis-forecast every 2 quarters."},
            ],
        },
        {
            "objective": "Adoption",
            "points": [
                {"text": "Sourcing-team time saved: ~6 hours/week per analyst."},
            ],
        },
    ]


def _stub_cheat_sheet(name: str) -> list[dict]:
    return [
        {"meta": "Power phrases", "bullets": [
            f"\"What's {name}'s biggest cost-of-doing-business pressure this quarter?\"",
            "\"Where does your team feel blind on supplier risk?\"",
        ]},
        {"meta": "Disqualifiers", "bullets": [
            "If they have a 3-year contract with another platform — listen, don't sell.",
        ]},
    ]


def _stub_attendees(name: str, industry: str | None) -> list[dict]:
    """3 hypothetical attendees with role-typical background + opening ask.
    The frontend uses this to suggest "The Room" content when AI is hit."""
    ind = industry or "the industry"
    return [
        {
            "initials": "JD",
            "name": "Jordan Davis",
            "role": "VP Procurement",
            "primary_objective": "Cost savings",
            "objectives": ["Cost savings", "Supplier consolidation"],
            "background": [
                f"Joined {name} in 2023; previously led category sourcing at a peer in {ind}.",
                "Looking to consolidate from 3+ intelligence vendors to a single platform.",
            ],
            "opening_ask": "What's the one thing none of your current vendors get right on top-spend categories?",
        },
        {
            "initials": "PM",
            "name": "Priya Menon",
            "role": "Director, Strategic Sourcing",
            "primary_objective": "Risk visibility",
            "objectives": ["Risk visibility", "Supplier health"],
            "background": [
                f"Owns supplier risk frameworks across {ind} sourcing corridor.",
                "Recently flagged single-source exposure in indirect categories.",
            ],
            "opening_ask": "Where does your team feel blind on supplier risk today?",
        },
        {
            "initials": "GB",
            "name": "Gunter Braun",
            "role": "Category Manager",
            "primary_objective": "Commodity price intel",
            "objectives": ["Commodity Price Intelligence"],
            "background": [
                "Frontline buyer for top 3 commodity categories.",
                "Has been burned by under-forecast price spikes twice in the last 18 months.",
            ],
            "opening_ask": "How far ahead do you currently have reliable price forecasts on your top 3 commodities?",
        },
    ]


_STUBS = {
    "company_snapshot": _stub_company_snapshot,
    "discovery_questions": _stub_discovery_questions,
    "minefields": lambda n, i: _stub_minefields(n),
    "objectives": _stub_objectives,
    "value_anchors": _stub_value_anchors,
    "cheat_sheet": lambda n, i: _stub_cheat_sheet(n),
    "attendees": _stub_attendees,
}


# ============================================================
# Real Claude call (one-shot per section)
# ============================================================


_JSON_FENCE_RE = re.compile(r"```[a-z]*\n?|\n?```")
_JSON_ARRAY_RE = re.compile(r"\[[\s\S]*\]")


def _real_suggest(section: Section, ctx: dict) -> list[dict]:
    settings = get_settings()
    if not settings.anthropic_api_key:
        stub = _STUBS[section]
        return stub(ctx.get("name", ""), ctx.get("industry"))
    try:
        from anthropic import Anthropic  # type: ignore

        client = Anthropic(api_key=settings.anthropic_api_key.get_secret_value())
        prompt = _PROMPTS[section]
        msg = client.messages.create(
            model=settings.anthropic_model,
            max_tokens=1200,
            system=(
                prompt
                + "\n\nOutput ONLY a JSON array — no prose, no markdown fences."
            ),
            messages=[
                {
                    "role": "user",
                    "content": json.dumps(ctx, default=str)[:6000],
                }
            ],
        )
        raw = "".join(
            b.text for b in msg.content if getattr(b, "type", "") == "text"
        )
        cleaned = _JSON_FENCE_RE.sub("", raw).strip()
        m = _JSON_ARRAY_RE.search(cleaned)
        if not m:
            stub = _STUBS[section]
            return stub(ctx.get("name", ""), ctx.get("industry"))
        parsed = json.loads(m.group(0))
        if isinstance(parsed, list):
            return [x for x in parsed if isinstance(x, dict)][:8]
        stub = _STUBS[section]
        return stub(ctx.get("name", ""), ctx.get("industry"))
    except Exception:  # noqa: BLE001
        stub = _STUBS[section]
        return stub(ctx.get("name", ""), ctx.get("industry"))


_PROMPTS: dict[str, str] = {
    "company_snapshot": (
        "Produce 5 company snapshot stats for a sales/CS pre-meeting brief. "
        "Each stat: {num, label, sub}. Cover Annual Revenue, Employees Globally, "
        "COGS %, # Priority Procurement Categories, top Sustainability Priority."
    ),
    "discovery_questions": (
        "Produce 6 discovery questions a procurement-intelligence sales rep "
        "should ask. Each item: {objective, person, text, category}. "
        "category in {Commercial, Risk, People, Process, Sustainability, Technology}."
    ),
    "minefields": (
        "Produce 4 minefields — things the rep MUST NOT do/say on the call. "
        "Each item: {type, text, why}. type in {Political, Process, People, Commercial}."
    ),
    "objectives": (
        "Produce 3 call objectives. Each item: {name, bullets[], beroe} where "
        "`beroe` is one sentence describing the Beroe capability that unlocks it."
    ),
    "value_anchors": (
        "Produce 3 value anchors with 2 points each. Shape: {objective, points: "
        "[{text, note}]}. Points should be concrete value statements."
    ),
    "cheat_sheet": (
        "Produce 2 cheat-sheet cards: {meta, bullets[]}. "
        "meta in {'Power phrases', 'Disqualifiers', 'Opening hooks'}."
    ),
    "attendees": (
        "Produce 3 hypothetical attendees for a procurement-led sales call. "
        "Each item: {initials, name, role, primary_objective, objectives:[], "
        "background:[2 bullets], opening_ask}. Bias roles to procurement / "
        "sourcing / category leads, not commercial / IT."
    ),
}


# ============================================================
# Route
# ============================================================


@router.post("/{account_id}/brief/ai-suggest", response_model=BriefAISuggestOut)
async def ai_suggest_brief_section(
    account_id: Annotated[UUID, Path()],
    body: BriefAISuggestIn,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> BriefAISuggestOut:
    from app.core.scope import get_account_row

    acc = await get_account_row(db, account_id)
    is_assigned = (acc.csm_user_id == user.id) or (acc.co_user_id == user.id)
    team_ids = (
        await _team_member_ids(db, user) if user.role == "cs_team_manager" else set()
    )
    is_team = acc.csm_user_id in team_ids if team_ids else False
    if not can_view_account(user.role, is_assigned=is_assigned, is_team=is_team):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Forbidden on this account")

    ai_quota.consume(user.id, label=f"brief_suggest_{body.section}")

    eng = (
        await db.execute(
            select(AccountEngagement).where(
                AccountEngagement.account_id == account_id
            )
        )
    ).scalar_one_or_none()

    ctx = {
        "name": acc.name,
        "industry": acc.industry,
        "country": acc.country,
        "tier": acc.tier,
        "annual_revenue_text": acc.annual_revenue_text,
        "engagement_objective": eng.engagement_objective if eng else None,
        "target_categories": eng.target_categories if eng else None,
        "procurement_maturity": eng.procurement_maturity if eng else None,
    }
    settings = get_settings()
    suggestions = _real_suggest(body.section, ctx)
    return BriefAISuggestOut(
        section=body.section,
        suggestions=suggestions,
        is_stub=not bool(settings.anthropic_api_key),
    )
