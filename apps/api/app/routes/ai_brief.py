"""H37 — AI Account Brief: a short narrative for the Home tab.

GET /api/v1/accounts/:id/ai-brief

Aggregates account header + engagement + appetite + signals + metrics into
a one-paragraph + 3-bullet brief. Cached in-process for 6 hours per account
so the Home tab doesn't bill a Claude call on every navigation.
"""

from __future__ import annotations

import hashlib
import json
import re
import time
from datetime import datetime, timezone
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Path, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser
from app.core.rbac import can_view_account
from app.core.config import get_settings
from app.db.session import get_db
from app.models.account import Account
from app.models.engagement import AccountEngagement
from app.models.metric import SuccessMetric
from app.models.signal import SoftSignal
from app.routes.accounts import _team_member_ids
from app.services import ai_quota

router = APIRouter(prefix="/api/v1/accounts", tags=["ai_brief"])


class AccountBriefOut(BaseModel):
    brief: str
    is_stub: bool
    generated_at: datetime


# In-process cache. 6-hour TTL — same shape as services/claude.py _doc_cache.
_CACHE: dict[UUID, tuple[float, AccountBriefOut]] = {}
_TTL_SECONDS = 6 * 60 * 60


def _stub_brief(*, name: str, industry: str | None, signals: int, metrics: int) -> str:
    """Deterministic fallback when no Anthropic key is configured."""
    ind = industry or "an unspecified industry"
    lines = [
        f"{name} sits in {ind}. The account currently has {signals} open soft signal"
        f"{'s' if signals != 1 else ''} and {metrics} success metric"
        f"{'s' if metrics != 1 else ''} being tracked.",
        "",
        "Key reads:",
        f"• Watch the open signals — they're the strongest forward-looking risk indicator.",
        f"• Recheck metric coverage; quantifiable measurement is the renewal-readiness anchor.",
        f"• Re-confirm the value-narrative with the SPOC if the last touch was >30 days ago.",
    ]
    return "\n".join(lines)


def _real_brief(payload: dict) -> str:
    """One Claude call. Strict text-only output; we trim around the model
    occasionally returning markdown fences."""
    from app.services import llm

    if not llm.is_configured():
        return _stub_brief(
            name=payload["account"]["name"],
            industry=payload["account"].get("industry"),
            signals=len(payload.get("active_signals", [])),
            metrics=len(payload.get("metrics", [])),
        )
    try:
        raw = llm.chat_text(
            system=(
                "You're a customer-success director. Produce a 4–6 sentence "
                "brief for the named account, then 3 bullet points titled "
                "'Key reads:'. Use the structured payload supplied — do NOT "
                "invent facts. Output PLAIN TEXT only (no markdown headings, "
                "no code fences). Keep it tight."
            ),
            user_content=json.dumps(payload, default=str)[:8000],
            max_tokens=600,
        )
        # Strip any stray markdown fences the model might emit.
        return re.sub(r"```[a-z]*\n?|\n?```", "", raw).strip()
    except Exception:  # noqa: BLE001
        return _stub_brief(
            name=payload["account"]["name"],
            industry=payload["account"].get("industry"),
            signals=len(payload.get("active_signals", [])),
            metrics=len(payload.get("metrics", [])),
        )


@router.get("/{account_id}/ai-brief", response_model=AccountBriefOut)
async def get_ai_brief(
    account_id: Annotated[UUID, Path()],
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AccountBriefOut:
    # Cache check first — cheap path.
    cached = _CACHE.get(account_id)
    now = time.time()
    if cached and (now - cached[0]) < _TTL_SECONDS:
        return cached[1]

    # Scope check.
    from app.core.scope import get_account_row

    acc = await get_account_row(db, account_id)
    is_assigned = (acc.csm_user_id == user.id) or (acc.co_user_id == user.id)
    team_ids = (
        await _team_member_ids(db, user) if user.role == "cs_team_manager" else set()
    )
    is_team = acc.csm_user_id in team_ids if team_ids else False
    if not can_view_account(user.role, is_assigned=is_assigned, is_team=is_team):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Forbidden on this account")

    # Bill against per-user daily quota — same pot as MoM extraction etc.
    ai_quota.consume(user.id, label="ai_brief")

    # Pull the supporting context. Each query is small.
    eng = (
        await db.execute(
            select(AccountEngagement).where(
                AccountEngagement.account_id == account_id
            )
        )
    ).scalar_one_or_none()

    sig_rows = (
        await db.execute(
            select(SoftSignal)
            .where(
                SoftSignal.account_id == account_id,
                SoftSignal.status == "active",
                SoftSignal.hidden.is_(False),
            )
            .limit(15)
        )
    ).scalars().all()

    met_rows = (
        await db.execute(
            select(SuccessMetric)
            .where(
                SuccessMetric.account_id == account_id,
                SuccessMetric.deleted_at.is_(None),
            )
            .limit(15)
        )
    ).scalars().all()

    payload = {
        "account": {
            "name": acc.name,
            "industry": acc.industry,
            "country": acc.country,
            "tier": acc.tier,
            "annual_revenue_text": acc.annual_revenue_text,
            "health_score": acc.health_score,
            "current_acv": str(acc.current_acv) if acc.current_acv else None,
            "target_acv": str(acc.target_acv) if acc.target_acv else None,
            "renewal_date": str(acc.renewal_date) if acc.renewal_date else None,
            "gate_signed": acc.gate_signed,
        },
        "engagement_objective": (eng.engagement_objective if eng else None),
        "procurement_maturity": (eng.procurement_maturity if eng else None),
        "target_categories": (eng.target_categories if eng else None),
        "active_signals": [
            {"type": s.type, "impact": s.impact, "signal": s.signal}
            for s in sig_rows
        ],
        "metrics": [
            {
                "name": m.name,
                "type": m.metric_type,
                "current_value": m.current_value,
                "target_value": m.target_value,
            }
            for m in met_rows
        ],
    }
    text = _real_brief(payload)
    from app.services import llm

    is_stub = not llm.is_configured()

    out = AccountBriefOut(
        brief=text or _stub_brief(
            name=acc.name,
            industry=acc.industry,
            signals=len(sig_rows),
            metrics=len(met_rows),
        ),
        is_stub=is_stub,
        generated_at=datetime.now(timezone.utc),
    )
    _CACHE[account_id] = (now, out)

    # Keep cache from growing unbounded.
    if len(_CACHE) > 1000:
        # Drop the oldest 200 by timestamp.
        oldest = sorted(_CACHE.items(), key=lambda kv: kv[1][0])[:200]
        for k, _ in oldest:
            _CACHE.pop(k, None)

    # Tag the digest of the source payload so debugging is easier.
    _ = hashlib.sha256(json.dumps(payload, default=str).encode()).hexdigest()[:12]
    return out
