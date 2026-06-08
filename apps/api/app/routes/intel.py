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

import asyncio
import logging
import time
from typing import Annotated, Callable
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser
from app.core.rbac import can_view_account
from app.core.scope import get_account_row
from app.db.session import get_db
from app.routes.accounts import _team_member_ids
from app.services import redshift_queries as rq

logger = logging.getLogger(__name__)
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


# 08-Jun · Priority 1 fix — bundle functions are SYNCHRONOUS
# (redshift_connector). Calling them inline in an `async def` froze the
# event loop for every concurrent request. Now we offload each to the
# default threadpool. Combined with the new connection pool in
# app.core.redshift, this lets multiple bundles execute in parallel
# instead of stalling on shared event-loop time.
#
# Also adds cache-hit/miss + timing logs so cold-vs-warm latency is
# visible in API logs.
async def _bundle_run(section: str, fn: Callable[[], dict]) -> dict:
    started = time.perf_counter()
    result = await run_in_threadpool(fn)
    ms = (time.perf_counter() - started) * 1000.0
    # The cache flag is "stub"-ish — we can't observe it directly without
    # changing _cache_get's API, so we report the wall-clock instead.
    # Sub-50ms calls are essentially cache hits; multi-hundred-ms calls
    # are actual Redshift round-trips.
    hit_or_miss = "hit" if ms < 50 else "miss"
    logger.info("intel.bundle %-22s %6.0fms · %s", section, ms, hit_or_miss)
    return result


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
    return _wrap(await _bundle_run("account_subscribers", lambda: rq.account_subscribers_bundle(name, window)))


@router.get("/{account_id}/intel/category-watch")
async def get_category_watch(
    user: CurrentUser,
    account_id: Annotated[UUID, Path(...)],
    window: WindowQ = "90d",
    db: AsyncSession = Depends(get_db),
):
    name = await _scope_and_resolve(db, user, account_id)
    return _wrap(await _bundle_run("category_watch", lambda: rq.category_watch_bundle(name, window)))


@router.get("/{account_id}/intel/mmd")
async def get_mmd(
    user: CurrentUser,
    account_id: Annotated[UUID, Path(...)],
    window: WindowQ = "90d",
    db: AsyncSession = Depends(get_db),
):
    name = await _scope_and_resolve(db, user, account_id)
    return _wrap(await _bundle_run("mmd", lambda: rq.mmd_bundle(name, window)))


@router.get("/{account_id}/intel/abi")
async def get_abi(
    user: CurrentUser,
    account_id: Annotated[UUID, Path(...)],
    window: WindowQ = "90d",
    db: AsyncSession = Depends(get_db),
):
    name = await _scope_and_resolve(db, user, account_id)
    return _wrap(await _bundle_run("abi", lambda: rq.abi_bundle(name, window)))


@router.get("/{account_id}/intel/supplier-discovery")
async def get_supplier_discovery(
    user: CurrentUser,
    account_id: Annotated[UUID, Path(...)],
    window: WindowQ = "90d",
    db: AsyncSession = Depends(get_db),
):
    name = await _scope_and_resolve(db, user, account_id)
    return _wrap(await _bundle_run("supplier_discovery", lambda: rq.supplier_discovery_bundle(name, window)))


@router.get("/{account_id}/intel/supplier-monitoring")
async def get_supplier_monitoring(
    user: CurrentUser,
    account_id: Annotated[UUID, Path(...)],
    window: WindowQ = "90d",
    db: AsyncSession = Depends(get_db),
):
    name = await _scope_and_resolve(db, user, account_id)
    return _wrap(await _bundle_run("supplier_monitoring", lambda: rq.supplier_monitoring_bundle(name, window)))


@router.get("/{account_id}/intel/custom-usage")
async def get_custom_usage(
    user: CurrentUser,
    account_id: Annotated[UUID, Path(...)],
    window: WindowQ = "fy",
    db: AsyncSession = Depends(get_db),
):
    name = await _scope_and_resolve(db, user, account_id)
    return _wrap(await _bundle_run("custom_usage", lambda: rq.custom_usage_bundle(name, window)))


@router.get("/{account_id}/intel/thought-leadership")
async def get_thought_leadership(
    user: CurrentUser,
    account_id: Annotated[UUID, Path(...)],
    window: WindowQ = "90d",
    db: AsyncSession = Depends(get_db),
):
    name = await _scope_and_resolve(db, user, account_id)
    return _wrap(await _bundle_run("thought_leadership", lambda: rq.thought_leadership_bundle(name, window)))


@router.get("/{account_id}/intel/datahub")
async def get_datahub(
    user: CurrentUser,
    account_id: Annotated[UUID, Path(...)],
    window: WindowQ = "90d",
    db: AsyncSession = Depends(get_db),
):
    name = await _scope_and_resolve(db, user, account_id)
    return _wrap(await _bundle_run("datahub", lambda: rq.datahub_bundle(name, window)))


@router.get("/{account_id}/intel/inflation-watch")
async def get_inflation_watch(
    user: CurrentUser,
    account_id: Annotated[UUID, Path(...)],
    window: WindowQ = "90d",
    db: AsyncSession = Depends(get_db),
):
    name = await _scope_and_resolve(db, user, account_id)
    return _wrap(await _bundle_run("inflation_watch", lambda: rq.inflation_watch_bundle(name, window)))


@router.get("/{account_id}/intel/cirtuo")
async def get_cirtuo(
    user: CurrentUser,
    account_id: Annotated[UUID, Path(...)],
    window: WindowQ = "fy",
    db: AsyncSession = Depends(get_db),
):
    name = await _scope_and_resolve(db, user, account_id)
    return _wrap(await _bundle_run("cirtuo", lambda: rq.cirtuo_bundle(name, window)))


@router.get("/{account_id}/intel/nnamu")
async def get_nnamu(
    user: CurrentUser,
    account_id: Annotated[UUID, Path(...)],
    window: WindowQ = "fy",
    db: AsyncSession = Depends(get_db),
):
    name = await _scope_and_resolve(db, user, account_id)
    return _wrap(await _bundle_run("nnamu", lambda: rq.nnamu_bundle(name, window)))


@router.get("/{account_id}/intel/upply")
async def get_upply(
    user: CurrentUser,
    account_id: Annotated[UUID, Path(...)],
    window: WindowQ = "90d",
    db: AsyncSession = Depends(get_db),
):
    name = await _scope_and_resolve(db, user, account_id)
    return _wrap(await _bundle_run("upply", lambda: rq.upply_bundle(name, window)))


@router.get("/{account_id}/intel/alerts")
async def get_alerts(
    user: CurrentUser,
    account_id: Annotated[UUID, Path(...)],
    window: WindowQ = "90d",
    db: AsyncSession = Depends(get_db),
):
    name = await _scope_and_resolve(db, user, account_id)
    return _wrap(await _bundle_run("alerts", lambda: rq.alerts_bundle(name, window)))


@router.get("/{account_id}/intel/training")
async def get_training(
    user: CurrentUser,
    account_id: Annotated[UUID, Path(...)],
    window: WindowQ = "fy",
    db: AsyncSession = Depends(get_db),
):
    name = await _scope_and_resolve(db, user, account_id)
    return _wrap(await _bundle_run("training", lambda: rq.training_bundle(name, window)))


@router.get("/{account_id}/intel/nps")
async def get_nps(
    user: CurrentUser,
    account_id: Annotated[UUID, Path(...)],
    window: WindowQ = "fy",
    db: AsyncSession = Depends(get_db),
):
    name = await _scope_and_resolve(db, user, account_id)
    return _wrap(await _bundle_run("nps", lambda: rq.nps_bundle(name, window)))


@router.get("/{account_id}/intel/super-users")
async def get_super_users(
    user: CurrentUser,
    account_id: Annotated[UUID, Path(...)],
    top_n: Annotated[int, Query(ge=1, le=100)] = 20,
    db: AsyncSession = Depends(get_db),
):
    name = await _scope_and_resolve(db, user, account_id)
    return _wrap(await _bundle_run("super_users", lambda: rq.super_users_bundle(name, top_n=top_n)))


# Back-compat alias (existing route name from Phase 1 scaffold)
@router.get("/{account_id}/intel/benchmarks")
async def get_benchmarks(
    user: CurrentUser,
    account_id: Annotated[UUID, Path(...)],
    window: WindowQ = "90d",
    db: AsyncSession = Depends(get_db),
):
    name = await _scope_and_resolve(db, user, account_id)
    return _wrap(await _bundle_run("benchmarks", lambda: rq.benchmarks_bundle(name, window)))


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
    """Roll-up endpoint — every bundle in one call.

    08-Jun · Priority 4 fix — was 16 sequential SYNC calls inside an
    `async def` (total wall-clock = sum of every bundle, ~120s+ on a
    cold start). Now: every bundle dispatched via asyncio.gather +
    run_in_threadpool, so total wall-clock ≈ max(individual bundles)
    while sharing the new Redshift connection pool. Same response
    shape — every section key is unchanged.
    """
    name = await _scope_and_resolve(db, user, account_id)
    started = time.perf_counter()

    # Dispatch each bundle as a separate coroutine. Each one will lease
    # a connection from the Redshift pool; the pool's maxsize (10) caps
    # the actual parallelism so we don't flood the cluster.
    tasks = [
        ("account_subscribers", lambda: rq.account_subscribers_bundle(name, window)),
        ("category_watch", lambda: rq.category_watch_bundle(name, window)),
        ("abi", lambda: rq.abi_bundle(name, window)),
        ("supplier_discovery", lambda: rq.supplier_discovery_bundle(name, window)),
        ("supplier_monitoring", lambda: rq.supplier_monitoring_bundle(name, window)),
        ("custom_usage", lambda: rq.custom_usage_bundle(name, window)),
        ("thought_leadership", lambda: rq.thought_leadership_bundle(name, window)),
        ("datahub", lambda: rq.datahub_bundle(name, window)),
        ("inflation_watch", lambda: rq.inflation_watch_bundle(name, window)),
        ("cirtuo", lambda: rq.cirtuo_bundle(name, window)),
        ("nnamu", lambda: rq.nnamu_bundle(name, window)),
        ("upply", lambda: rq.upply_bundle(name, window)),
        ("alerts", lambda: rq.alerts_bundle(name, window)),
        ("training", lambda: rq.training_bundle(name, window)),
        ("nps", lambda: rq.nps_bundle(name, window)),
        ("super_users", lambda: rq.super_users_bundle(name, top_n=20)),
    ]
    results = await asyncio.gather(*[_bundle_run(s, fn) for s, fn in tasks])
    payload = {"redshift_company_name": name, "window": window}
    for (section, _), result in zip(tasks, results):
        payload[section] = result

    total_ms = (time.perf_counter() - started) * 1000.0
    logger.info("intel.all (%s) parallelized %d bundles in %.0fms", name, len(tasks), total_ms)
    return _wrap(payload)
