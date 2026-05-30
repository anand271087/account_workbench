"""Per-account scope cache.

Every account-scoped endpoint does the same `SELECT * FROM accounts WHERE id=?`
to enforce visibility (`can_view_account`). Without caching, opening one
account in the UI hits this query 4-6 times in a row (one per tab) at ~110ms
each — unnecessary tax on a list-mode pgbouncer pool.

We cache the **Account row** (not the per-user scope booleans) for 30s. The
booleans are recomputed per request from the cached row + caller's user id,
so any role/assignment change still takes effect within that window.

Invalidation: `PATCH /accounts/:id/owner` and any other write to the row
calls `invalidate_account(account_id)` to drop the entry.
"""

from __future__ import annotations

import time
from typing import TYPE_CHECKING
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

if TYPE_CHECKING:
    from app.models.account import Account
    from app.models.user import User


# Cache a flat dict snapshot — NOT the ORM instance. We rebuild a transient
# Account per call so callers that go on to mutate (e.g. handover) and commit
# don't accidentally write through a detached/expunged instance.
_CACHE: dict[UUID, tuple[float, dict]] = {}
_TTL_SECONDS = 30.0
_FIELDS = (
    "id", "name", "slug", "industry", "region", "country",
    # M16.1 — header chips applied from MoM extraction.
    "headquarters", "annual_revenue_text", "sf_link",
    "csm_user_id", "co_user_id", "category", "tier",
    "account_type", "segment", "current_acv", "target_acv",
    "contract_start", "contract_end", "renewal_date",
    "health_score", "last_activity_at",
    "handed_off_to_solutioning", "handed_off_at", "handed_off_by",
    # M13 — signing gate columns. Cached so AccountDetail + the signing
    # endpoints don't need a second DB hit; invalidated on /sign + /unlock.
    "gate_signed", "gate_signed_date", "gate_contract_acv", "gate_contract_term",
    "gate_renewal_date", "gate_bvd_due_date", "gate_confirmed_by", "gate_confirmed_at",
    "gate_unlocked", "gate_unlock_reason", "gate_unlocked_by", "gate_unlocked_at",
    "gate_contract_doc", "gate_contract_doc_at", "gate_contract_modules",
    "gate_platform_tier", "gate_account_segment", "gate_subscribers",
    "handover_quality_check",
    # M14 — CS Onboarding columns.
    "cs_entry_type", "cs_entry_b_context", "cs_entry_b_goals",
    "cs_handover_checklist", "cs_stakeholders",
    # M19 — Success Contract (3-lock structure).
    "success_contract", "success_contract_locked_at", "success_contract_locked_by",
    # M22 — Value Delivery Document.
    "value_delivery_document", "vdd_locked_at", "vdd_locked_by",
    # M23 — Delivery & Renewal.
    "delivery_renewal", "dr_outcome", "dr_outcome_set_at", "dr_outcome_set_by",
    # M26 — Growth & Pipeline · mode override.
    "plan_current_mode",
    # 28-May bug 28-33 — mode override audit (reason + history).
    "plan_mode_override_reason", "plan_mode_history",
    # M29 — Intelligence & Reports · Intelligence section snapshot.
    "platform_intel",
    "created_at", "updated_at", "deleted_at",
)


async def get_account_row(db: AsyncSession, account_id: UUID) -> "Account":
    """Returns a *transient* Account constructed from cached fields.

    The instance is detached from any session — read-only by intent. Callers
    that need to mutate must re-fetch via the session directly (and call
    `invalidate_account(account_id)` on commit).
    """
    from app.models.account import Account

    now = time.time()
    cached = _CACHE.get(account_id)
    if cached is None or (now - cached[0]) >= _TTL_SECONDS:
        from sqlalchemy import select as _select

        acc = (
            await db.execute(
                _select(Account).where(
                    Account.id == account_id, Account.deleted_at.is_(None)
                )
            )
        ).scalar_one_or_none()
        if acc is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Account not found")
        snap = {f: getattr(acc, f) for f in _FIELDS}
        _CACHE[account_id] = (now, snap)
    else:
        snap = cached[1]

    # Rebuild a fresh transient instance per call — cheap, and isolates callers.
    transient = Account()
    for f, v in snap.items():
        setattr(transient, f, v)
    return transient


def invalidate_account(account_id: UUID | None = None) -> None:
    if account_id is None:
        _CACHE.clear()
    else:
        _CACHE.pop(account_id, None)


# Team-membership cache (only relevant for cs_team_manager).
_TEAM_CACHE: dict[UUID, tuple[float, set[UUID]]] = {}
_TEAM_TTL_SECONDS = 60.0


async def get_team_member_ids_cached(
    db: AsyncSession, manager: "User"
) -> set[UUID]:
    if manager.role != "cs_team_manager" or manager.team_id is None:
        return set()
    now = time.time()
    cached = _TEAM_CACHE.get(manager.id)
    if cached is not None and (now - cached[0]) < _TEAM_TTL_SECONDS:
        return cached[1]
    from app.models.user import User as _U

    rows = (
        await db.execute(
            select(_U.id).where(_U.team_id == manager.team_id, _U.deleted_at.is_(None))
        )
    ).scalars().all()
    ids = set(rows)
    _TEAM_CACHE[manager.id] = (now, ids)
    return ids


def invalidate_team_cache(manager_id: UUID | None = None) -> None:
    if manager_id is None:
        _TEAM_CACHE.clear()
    else:
        _TEAM_CACHE.pop(manager_id, None)
