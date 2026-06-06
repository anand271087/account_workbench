"""Intelligence & Reports — live Redshift endpoints.

One endpoint per Analytics_DataPoints_v10.xlsx sheet. Every endpoint:
  1. Verifies caller can view the account (RBAC).
  2. Resolves account → `redshift_company_name` (returns 409 if unset).
  3. Calls the matching `services.redshift_queries` bundle.
  4. Wraps the response with any `_infra` health flag (tunnel recovery).
  5. Returns the bundle dict (cached 5 min in-process per worker).

`/intel/all` returns every section in one call — used by the
IntelligenceTab on first open.
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser
from app.core.rbac import can_view_account
from app.core.scope import get_account_row
from app.db.session import get_db
from app.routes.accounts import _team_member_ids
from app.services import redshift_queries as rq

router = APIRouter(prefix="/api/v1/accounts", tags=["intel"])


def _wrap(bundle: dict) -> dict:
    """Merge any infra-health flag into the bundle response.

    `infra_status()` returns a dict when the Redshift tunnel recently
    failed; the frontend reads this to show an amber 'auto-recovering'
    banner instead of misleading-zero KPIs.
    """
    infra = rq.infra_status()
    if infra:
        return {**bundle, "_infra": infra}
    return bundle


WindowQ = Annotated[
    str,
    Query(pattern="^(30d|90d|fy|all)$", description="30d / 90d / fy / all"),
]


async def _scope_and_resolve(db: AsyncSession, user, account_id: UUID) -> str:
    acc = await get_account_row(db, account_id)
    is_assigned = (acc.csm_user_id == user.id) or (acc.co_user_id == user.id)
    team_ids = (
        await _team_member_ids(db, user) if user.role == "cs_team_manager" else set()
    )
    is_team = acc.csm_user_id in team_ids if team_ids else False
    if not can_view_account(user.role, is_assigned=is_assigned, is_team=is_team):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Forbidden on this account")

    name = (acc.redshift_company_name or "").strip()
    if not name:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Account is not mapped to a Redshift companyname yet "
            "(set accounts.redshift_company_name).",
        )
    return name


# ─────────────────────────────────────────────────────────────
# One endpoint per sheet
# ─────────────────────────────────────────────────────────────


@router.get("/{account_id}/intel/account-subscribers")
async def get_account_subscribers(
    user: CurrentUser,
    account_id: Annotated[UUID, Path(...)],
    window: WindowQ = "90d",
    db: AsyncSession = Depends(get_db),
):
    name = await _scope_and_resolve(db, user, account_id)
    return _wrap(rq.account_subscribers_bundle(name, window))


@router.get("/{account_id}/intel/category-watch")
async def get_category_watch(
    user: CurrentUser,
    account_id: Annotated[UUID, Path(...)],
    window: WindowQ = "90d",
    db: AsyncSession = Depends(get_db),
):
    name = await _scope_and_resolve(db, user, account_id)
    return _wrap(rq.category_watch_bundle(name, window))


@router.get("/{account_id}/intel/mmd")
async def get_mmd(
    user: CurrentUser,
    account_id: Annotated[UUID, Path(...)],
    window: WindowQ = "90d",
    db: AsyncSession = Depends(get_db),
):
    name = await _scope_and_resolve(db, user, account_id)
    return _wrap(rq.mmd_bundle(name, window))


@router.get("/{account_id}/intel/abi")
async def get_abi(
    user: CurrentUser,
    account_id: Annotated[UUID, Path(...)],
    window: WindowQ = "90d",
    db: AsyncSession = Depends(get_db),
):
    name = await _scope_and_resolve(db, user, account_id)
    return _wrap(rq.abi_bundle(name, window))


@router.get("/{account_id}/intel/supplier-discovery")
async def get_supplier_discovery(
    user: CurrentUser,
    account_id: Annotated[UUID, Path(...)],
    window: WindowQ = "90d",
    db: AsyncSession = Depends(get_db),
):
    name = await _scope_and_resolve(db, user, account_id)
    return _wrap(rq.supplier_discovery_bundle(name, window))


@router.get("/{account_id}/intel/supplier-monitoring")
async def get_supplier_monitoring(
    user: CurrentUser,
    account_id: Annotated[UUID, Path(...)],
    window: WindowQ = "90d",
    db: AsyncSession = Depends(get_db),
):
    name = await _scope_and_resolve(db, user, account_id)
    return _wrap(rq.supplier_monitoring_bundle(name, window))


@router.get("/{account_id}/intel/custom-usage")
async def get_custom_usage(
    user: CurrentUser,
    account_id: Annotated[UUID, Path(...)],
    window: WindowQ = "fy",
    db: AsyncSession = Depends(get_db),
):
    name = await _scope_and_resolve(db, user, account_id)
    return _wrap(rq.custom_usage_bundle(name, window))


@router.get("/{account_id}/intel/thought-leadership")
async def get_thought_leadership(
    user: CurrentUser,
    account_id: Annotated[UUID, Path(...)],
    window: WindowQ = "90d",
    db: AsyncSession = Depends(get_db),
):
    name = await _scope_and_resolve(db, user, account_id)
    return _wrap(rq.thought_leadership_bundle(name, window))


@router.get("/{account_id}/intel/datahub")
async def get_datahub(
    user: CurrentUser,
    account_id: Annotated[UUID, Path(...)],
    window: WindowQ = "90d",
    db: AsyncSession = Depends(get_db),
):
    name = await _scope_and_resolve(db, user, account_id)
    return _wrap(rq.datahub_bundle(name, window))


@router.get("/{account_id}/intel/inflation-watch")
async def get_inflation_watch(
    user: CurrentUser,
    account_id: Annotated[UUID, Path(...)],
    window: WindowQ = "90d",
    db: AsyncSession = Depends(get_db),
):
    name = await _scope_and_resolve(db, user, account_id)
    return _wrap(rq.inflation_watch_bundle(name, window))


@router.get("/{account_id}/intel/cirtuo")
async def get_cirtuo(
    user: CurrentUser,
    account_id: Annotated[UUID, Path(...)],
    window: WindowQ = "fy",
    db: AsyncSession = Depends(get_db),
):
    name = await _scope_and_resolve(db, user, account_id)
    return _wrap(rq.cirtuo_bundle(name, window))


@router.get("/{account_id}/intel/nnamu")
async def get_nnamu(
    user: CurrentUser,
    account_id: Annotated[UUID, Path(...)],
    window: WindowQ = "fy",
    db: AsyncSession = Depends(get_db),
):
    name = await _scope_and_resolve(db, user, account_id)
    return _wrap(rq.nnamu_bundle(name, window))


@router.get("/{account_id}/intel/upply")
async def get_upply(
    user: CurrentUser,
    account_id: Annotated[UUID, Path(...)],
    window: WindowQ = "90d",
    db: AsyncSession = Depends(get_db),
):
    name = await _scope_and_resolve(db, user, account_id)
    return _wrap(rq.upply_bundle(name, window))


@router.get("/{account_id}/intel/alerts")
async def get_alerts(
    user: CurrentUser,
    account_id: Annotated[UUID, Path(...)],
    window: WindowQ = "90d",
    db: AsyncSession = Depends(get_db),
):
    name = await _scope_and_resolve(db, user, account_id)
    return _wrap(rq.alerts_bundle(name, window))


@router.get("/{account_id}/intel/training")
async def get_training(
    user: CurrentUser,
    account_id: Annotated[UUID, Path(...)],
    window: WindowQ = "fy",
    db: AsyncSession = Depends(get_db),
):
    name = await _scope_and_resolve(db, user, account_id)
    return _wrap(rq.training_bundle(name, window))


@router.get("/{account_id}/intel/nps")
async def get_nps(
    user: CurrentUser,
    account_id: Annotated[UUID, Path(...)],
    window: WindowQ = "fy",
    db: AsyncSession = Depends(get_db),
):
    name = await _scope_and_resolve(db, user, account_id)
    return _wrap(rq.nps_bundle(name, window))


@router.get("/{account_id}/intel/super-users")
async def get_super_users(
    user: CurrentUser,
    account_id: Annotated[UUID, Path(...)],
    top_n: Annotated[int, Query(ge=1, le=100)] = 20,
    db: AsyncSession = Depends(get_db),
):
    name = await _scope_and_resolve(db, user, account_id)
    return _wrap(rq.super_users_bundle(name, top_n=top_n))


# Back-compat alias (existing route name from Phase 1 scaffold)
@router.get("/{account_id}/intel/benchmarks")
async def get_benchmarks(
    user: CurrentUser,
    account_id: Annotated[UUID, Path(...)],
    window: WindowQ = "90d",
    db: AsyncSession = Depends(get_db),
):
    name = await _scope_and_resolve(db, user, account_id)
    return _wrap(rq.benchmarks_bundle(name, window))


# ─────────────────────────────────────────────────────────────
# Rollup — every bundle in one call (used on tab open)
# ─────────────────────────────────────────────────────────────


@router.get("/{account_id}/intel/all")
async def get_intel_all(
    user: CurrentUser,
    account_id: Annotated[UUID, Path(...)],
    window: WindowQ = "90d",
    db: AsyncSession = Depends(get_db),
):
    name = await _scope_and_resolve(db, user, account_id)
    return _wrap({
        "redshift_company_name": name,
        "window": window,
        "account_subscribers": rq.account_subscribers_bundle(name, window),
        "category_watch": rq.category_watch_bundle(name, window),
        "abi": rq.abi_bundle(name, window),
        "supplier_discovery": rq.supplier_discovery_bundle(name, window),
        "supplier_monitoring": rq.supplier_monitoring_bundle(name, window),
        "custom_usage": rq.custom_usage_bundle(name, window),
        "thought_leadership": rq.thought_leadership_bundle(name, window),
        "datahub": rq.datahub_bundle(name, window),
        "inflation_watch": rq.inflation_watch_bundle(name, window),
        "cirtuo": rq.cirtuo_bundle(name, window),
        "nnamu": rq.nnamu_bundle(name, window),
        "upply": rq.upply_bundle(name, window),
        "alerts": rq.alerts_bundle(name, window),
        "training": rq.training_bundle(name, window),
        "nps": rq.nps_bundle(name, window),
        "super_users": rq.super_users_bundle(name, top_n=20),
    })
