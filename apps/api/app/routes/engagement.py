"""AK03.a — Engagement Info endpoints + AI quality-check.

Per Roles_Access_Matrix_Reviewed_05072026.xlsx:
- Pre-Sales Engagement Info edit:
  - csm: F (own)         · cs_team_manager: F (team)
  - cs_director, vp_csm, admin: F (all)
  - inside_sales_manager: F (own)
  - solutioning_manager (Q3): View only — NOT edit
  - everyone else: View only

The audit_log writer (services/audit_writer.py) records every changed field
old→new automatically on PATCH.
"""

from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Path, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser
from app.core.rbac import can_view_account, can_write_engagement
from app.db.session import get_db
from app.models.account import Account
from app.models.engagement import AccountEngagement
from app.models.user import User
from app.routes.accounts import _team_member_ids
from app.schemas.engagement import (
    EngagementOut,
    EngagementUpdate,
    QualityCheckRequest,
    QualityCheckResponse,
)
from app.services import ai_quota
from app.services.claude import quality_check_engagement_objective

router = APIRouter(prefix="/api/v1/accounts", tags=["engagement"])


async def _resolve_scope(db: AsyncSession, user: User, account_id: UUID) -> tuple[Account, bool, bool]:
    """Returns (account, is_assigned, is_team) or raises 404/403.

    Centralizes the scope check that both the GET and the PATCH need.
    Uses the account-row + team cache so the second tab load on the same
    account costs nothing on the DB.
    """
    from app.core.scope import get_account_row

    acc = await get_account_row(db, account_id)
    is_assigned = (acc.csm_user_id == user.id) or (acc.co_user_id == user.id)
    team_ids = await _team_member_ids(db, user) if user.role == "cs_team_manager" else set()
    is_team = acc.csm_user_id in team_ids if team_ids else False
    if not can_view_account(user.role, is_assigned=is_assigned, is_team=is_team):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Forbidden on this account")
    return acc, is_assigned, is_team


@router.get("/{account_id}/engagement", response_model=EngagementOut)
async def get_engagement(
    account_id: Annotated[UUID, Path()],
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> EngagementOut:
    _, is_assigned, is_team = await _resolve_scope(db, user, account_id)

    eng = (
        await db.execute(
            select(AccountEngagement).where(AccountEngagement.account_id == account_id)
        )
    ).scalar_one_or_none()

    if eng is None:
        # No row yet — return a "blank" record so the form can render.
        # The PATCH will INSERT-or-UPDATE on first save.
        eng = AccountEngagement(
            account_id=account_id,
            target_categories=[],
            geographies=[],
            ai_quality_dismissed=False,
            updated_at=datetime.utcnow(),
        )

    out = EngagementOut.model_validate(eng)
    out.is_editable = can_write_engagement(user.role, is_assigned=is_assigned, is_team=is_team)
    return out


@router.patch("/{account_id}/engagement", response_model=EngagementOut)
async def patch_engagement(
    account_id: Annotated[UUID, Path()],
    body: EngagementUpdate,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> EngagementOut:
    acc, is_assigned, is_team = await _resolve_scope(db, user, account_id)
    if not can_write_engagement(user.role, is_assigned=is_assigned, is_team=is_team):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Your role cannot edit engagement info on this account",
        )

    eng = (
        await db.execute(
            select(AccountEngagement).where(AccountEngagement.account_id == account_id)
        )
    ).scalar_one_or_none()

    if eng is None:
        eng = AccountEngagement(
            account_id=account_id,
            target_categories=[],
            geographies=[],
            ai_quality_dismissed=False,
        )
        db.add(eng)

    # Apply only the fields the client provided.
    payload = body.model_dump(exclude_unset=True)
    for field, value in payload.items():
        setattr(eng, field, value)

    # If the engagement_objective text changed, the previously-dismissed warning
    # is stale — un-dismiss so the AI quality check can fire again.
    if "engagement_objective" in payload and "ai_quality_dismissed" not in payload:
        eng.ai_quality_dismissed = False
        eng.ai_quality_score = None

    eng.updated_at = datetime.utcnow()
    eng.updated_by = user.id

    await db.commit()
    await db.refresh(eng)

    out = EngagementOut.model_validate(eng)
    out.is_editable = True
    return out


# ============================================================
# AI quality check — synchronous, single Claude call
# ============================================================

ai_router = APIRouter(prefix="/api/v1/ai", tags=["ai"])


@ai_router.post("/quality-check", response_model=QualityCheckResponse)
async def quality_check(
    body: QualityCheckRequest,
    user: CurrentUser,
) -> QualityCheckResponse:
    """Score the engagement-objective text on (specific, measurable, value-stated).

    Returns 1..5 + a short comment. Cached server-side by hash so retries are free.
    Falls back to a deterministic stub when ANTHROPIC_API_KEY isn't a real key.
    Per-user/day quota enforced (matrix Q5).
    """
    if not body.text or not body.text.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Text cannot be empty")
    ai_quota.consume(user.id, label="quality_check")
    return quality_check_engagement_objective(body.text)


@ai_router.get("/health")
async def ai_health(user: CurrentUser) -> dict:
    """Diagnostic — is the LLM backend (Bifrost gateway) actually reachable?

    13-Jun: the dev server was returning is_stub=true on every AI call.
    The only signal callers had was the is_stub flag, with no "why". This
    endpoint surfaces the actual config + a live round-trip so the gateway
    can be verified FROM the running server (the Bifrost ALB is VPC-internal
    and not reachable from a laptop). Admin-only; does one tiny completion.

    Returns:
      configured        — does is_configured() see a backend?
      backend           — "bifrost:<model>" / "anthropic:<model>" / "stub"
      gateway_url        — the configured AI_GATEWAY_URL (so you can confirm
                           it points at the internal ALB)
      live_call_ok       — did a real 1-token completion succeed?
      live_call_error    — the exception type + message if it failed
      sample             — first 80 chars of the live response (proof it's real)
    """
    from app.core.rbac import is_global_admin

    if not is_global_admin(user.role):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin only")

    from app.core.config import get_settings
    from app.services import llm

    settings = get_settings()
    result: dict = {
        "configured": llm.is_configured(),
        "backend": llm.backend_label(),
        "gateway_url": settings.ai_gateway_url,
        "gateway_model": settings.ai_gateway_model,
        "bifrost_ssm_target": settings.bifrost_ssm_target,
        "live_call_ok": False,
        "live_call_error": None,
        "sample": None,
    }
    if not llm.is_configured():
        result["live_call_error"] = "No backend configured (AI_GATEWAY_URL + ANTHROPIC_API_KEY both unset)"
        return result
    try:
        import asyncio

        text = await asyncio.to_thread(
            llm.chat_text,
            system="You are a health probe. Reply with exactly: OK",
            user_content="ping",
            max_tokens=8,
            temperature=0.0,
            timeout=20.0,
        )
        result["live_call_ok"] = bool(text and text.strip())
        result["sample"] = (text or "")[:80]
    except Exception as e:  # noqa: BLE001 — surface the real failure
        result["live_call_error"] = f"{type(e).__name__}: {str(e)[:300]}"
    return result
