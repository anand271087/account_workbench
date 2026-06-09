"""Intelligence & Reports — Redshift query layer.

One bundle per sheet of Analytics_DataPoints_v10.xlsx. Every KPI in the
spec either:

  (a) Uses the spec SQL (column K of the sheet) verbatim, OR
  (b) Uses a documented SUBSTITUTE when the spec table is missing
      from our reader role's permission set, OR
  (c) Returns null with `source_unavailable: True` + a reason string,
      when the table is permission-denied or genuinely offline (Cirtuo
      / nnamu / Upply / Training / NPS — those are SharePoint files).

Reader role: `ued_reader`. Probed against live Redshift on 2026-06-06.

READABLE TABLES
  tableau_schema.stg_user_session_log
  tableau_schema.activity_per_user            (mt_table_user_level substitute — per-user rollup)
  tableau_schema.live_ai_all_account_usage_report  (subscription metadata + per-account totals)
  tableau_schema.live_ai_mmd_report
  live_ai_incremental.freshservice_abi        (Abi + Custom Usage — spec said tableau_schema.live_ai_freshservice_abi which does not exist)
  live_ai_incremental.supplierdiscoveryusersearch / timespent  (forestreet_usage_table substitute)
  tableau_schema.stg_thoughtleadership  (stg_thoughtleadership substitute)
  live_ai_incremental.git_home_report / git_addition_report / git_custom_cd
  live_ai_incremental.ads_historical_dump     (account scoping not possible — no email/company col)

NOT READABLE (permission denied or table missing)
  tableau_schema.mt_table_user_level          → activity_per_user + live_ai_all_account_usage_report
  tableau_schema.stg_user_cat_sup_report      → source_unavailable
  tableau_schema.stg_categoryview/watch/unlocked/downloaded_reporttype → source_unavailable
  tableau_schema.stg_benchmark                → source_unavailable
  tableau_schema.stg_thoughtleadership        → use thoughtleadershipreportview instead
  tableau_schema.datahub_category_merged      → source_unavailable
  tableau_schema.stg_piwik_cirtuoreport       → source_unavailable

Spec SQL `:acct` parameter = the account's canonical Redshift
companyname (set per-account on `accounts.redshift_company_name`).
"""

from __future__ import annotations

import logging
import time
from datetime import date, datetime, timedelta
from typing import Any

from app.core.redshift import ensure_tunnel, get_connection, lease_connection

logger = logging.getLogger(__name__)


# ============================================================
# In-process TTL cache (per worker). 5-minute TTL matches the per-tab
# refresh expectation; clears between deploys.
#
# 08-Jun · Swapped the hand-rolled dict for cachetools.TTLCache +
# threading.Lock. Required because bundle execution now runs inside
# a threadpool (Priority 1 fix in intel routes) — multiple threads
# can race on cache reads/writes for the same key.
# ============================================================
import threading

from cachetools import TTLCache

_CACHE_TTL = 300.0  # seconds — env-tunable later if needed
_CACHE: TTLCache = TTLCache(maxsize=512, ttl=_CACHE_TTL)
_CACHE_LOCK = threading.Lock()


def _cache_get(key: tuple) -> Any | None:
    with _CACHE_LOCK:
        return _CACHE.get(key)


def _cache_put_and_return(key: tuple, value: Any) -> Any:
    with _CACHE_LOCK:
        _CACHE[key] = value
    return value


# ============================================================
# Window resolution. Spec uses 30d, 90d, FY, all. April-March FY
# (Beroe convention).
# ============================================================


def _window_range(window: str) -> tuple[date | None, date]:
    today = date.today()
    if window == "30d":
        return today - timedelta(days=30), today
    if window == "90d":
        return today - timedelta(days=90), today
    if window == "fy":
        y = today.year if today.month >= 4 else today.year - 1
        return date(y, 4, 1), today
    if window == "all":
        return None, today
    return today - timedelta(days=90), today


# ============================================================
# Supabase sync helper (Phase 3 offline staging tables).
# Uses psycopg (sync) so bundle functions stay synchronous.
# Connection per-query — keeps the helper symmetric with _scalar /
# _rows and avoids holding a session-pooler slot.
# ============================================================


def _pg_url() -> str | None:
    """Return a psycopg-friendly DSN, or None if not configured."""
    from app.core.config import get_settings
    url = get_settings().database_url
    if not url:
        return None
    # asyncpg URL prefix → psycopg (sync) prefix
    if url.startswith("postgresql+asyncpg://"):
        url = url.replace("postgresql+asyncpg://", "postgresql://")
    return url


def _pg_rows(sql: str, params: tuple = ()) -> list[tuple]:
    """Run a query against Supabase Postgres; return [] on any error."""
    import psycopg
    dsn = _pg_url()
    if not dsn:
        return []
    try:
        with psycopg.connect(dsn, autocommit=True, connect_timeout=10) as conn:
            with conn.cursor() as cur:
                cur.execute(sql, params)
                return list(cur.fetchall())
    except Exception as exc:  # noqa: BLE001
        logger.warning("pg rows failed: %s — %s", sql[:120].replace("\n", " "), exc)
        return []


def _pg_scalar(sql: str, params: tuple = (), default: Any = None) -> Any:
    rs = _pg_rows(sql, params)
    if not rs:
        return default
    first = rs[0][0]
    return default if first is None else first


# ============================================================
# Query primitives — every query opens its own connection so a
# permission-denied error on one query doesn't poison the next.
# (Redshift 25P02 cascade if you reuse a poisoned txn.)
#
# Self-heal: if Connection refused (tunnel died), call ensure_tunnel()
# and retry ONCE. Track recent failure timestamps so the route layer
# can surface a "Redshift recovering" banner instead of silently 0-ing.
# ============================================================


# Module-level flag — set on retry-failed queries, read by the route
# layer to embed a `_infra` block in the response. We use the wall
# clock so the banner auto-clears after 30s of healthy queries.
_LAST_TUNNEL_ERROR_AT: float | None = None


def _is_connection_error(exc: Exception) -> bool:
    """Loose detection of tunnel-down errors across drivers."""
    s = str(exc).lower()
    return (
        "connection refused" in s
        or "communication error" in s
        or "broken pipe" in s
        or "connection reset" in s
        or "connection lost" in s
    )


def _mark_unhealthy() -> None:
    global _LAST_TUNNEL_ERROR_AT
    _LAST_TUNNEL_ERROR_AT = time.time()


def infra_status() -> dict | None:
    """Return a {_infra: ...} block if the tunnel had a recent failure.

    Cleared after 30s of healthy queries — bundle responses then
    revert to no `_infra` field.
    """
    if _LAST_TUNNEL_ERROR_AT is None:
        return None
    age = time.time() - _LAST_TUNNEL_ERROR_AT
    if age > 30:
        return None
    return {
        "tunnel_recovering": True,
        "seconds_since_error": round(age, 1),
        "message": "Redshift tunnel was dropped; auto-recovering — refresh in a few seconds.",
    }


def _scalar(sql: str, params: tuple = (), default: Any = None) -> Any:
    # 08-Jun · Was: get_connection() + close() on every call (new SSL
    # handshake each query). Now: lease from the process-wide pool in
    # app.core.redshift; pool returns the connection on context exit.
    for attempt in (1, 2):
        try:
            with lease_connection() as conn:
                cur = conn.cursor()
                cur.execute(sql, params)
                row = cur.fetchone()
                cur.close()
                return row[0] if row and row[0] is not None else default
        except Exception as exc:  # noqa: BLE001
            if attempt == 1 and _is_connection_error(exc):
                logger.warning("Redshift connection refused; healing tunnel and retrying once…")
                ensure_tunnel()
                continue
            logger.warning("redshift scalar failed: %s — %s", sql[:120].replace("\n", " "), exc)
            _mark_unhealthy()
            return default
    return default


def _rows(sql: str, params: tuple = ()) -> list[tuple]:
    for attempt in (1, 2):
        try:
            with lease_connection() as conn:
                cur = conn.cursor()
                cur.execute(sql, params)
                rs = cur.fetchall()
                cur.close()
                return rs or []
        except Exception as exc:  # noqa: BLE001
            if attempt == 1 and _is_connection_error(exc):
                logger.warning("Redshift connection refused; healing tunnel and retrying once…")
                ensure_tunnel()
                continue
            logger.warning("redshift rows failed: %s — %s", sql[:120].replace("\n", " "), exc)
            _mark_unhealthy()
            return []
    return []


def _date_iso(v: Any) -> str | None:
    if isinstance(v, datetime):
        return v.isoformat()
    if isinstance(v, date):
        return v.isoformat()
    return None


def _na(reason: str) -> dict:
    """KPI we can't fulfil — frontend renders a 'data pipeline pending' pill."""
    return {"value": None, "source_unavailable": True, "reason": reason}


# ============================================================
# SHEET 1 — Account & Subscribers (9 KPIs)
# Spec source: tableau_schema.mt_table_user_level (NOT readable).
# Substitute: activity_per_user + live_ai_all_account_usage_report +
# stg_user_session_log.
# ============================================================


def account_subscribers_bundle(acct: str, window: str = "90d") -> dict:
    key = ("account_subs", acct, window)
    if (c := _cache_get(key)) is not None:
        return c
    start, _ = _window_range(window)

    total_subs = _scalar(
        "SELECT COUNT(DISTINCT email) FROM tableau_schema.activity_per_user "
        "WHERE companyname = %s",
        (acct,), default=0,
    )
    active_subs = _scalar(
        "SELECT COUNT(DISTINCT email) FROM tableau_schema.activity_per_user "
        "WHERE companyname = %s AND logins > 0",
        (acct,), default=0,
    )
    sub_start = _scalar(
        'SELECT MIN("date of activation") FROM tableau_schema.live_ai_all_account_usage_report '
        "WHERE companyname = %s",
        (acct,),
    )
    sub_end = _scalar(
        'SELECT MAX("trial/subscription end date") FROM tableau_schema.live_ai_all_account_usage_report '
        "WHERE companyname = %s",
        (acct,),
    )
    last_login = _scalar(
        "SELECT MAX(s.sessionlogin) FROM tableau_schema.stg_user_session_log s "
        "JOIN tableau_schema.activity_per_user a ON a.email = s.email "
        "WHERE a.companyname = %s",
        (acct,),
    )
    total_logins = _scalar(
        "SELECT SUM(logins) FROM tableau_schema.activity_per_user WHERE companyname = %s",
        (acct,), default=0,
    )
    total_time_mins = _scalar(
        "SELECT SUM(s.totaltimespent_sec)/60.0 FROM tableau_schema.stg_user_session_log s "
        "JOIN tableau_schema.activity_per_user a ON a.email = s.email "
        "WHERE a.companyname = %s "
        + ("AND s.sessionlogin >= %s" if start else ""),
        (acct, start) if start else (acct,), default=0,
    )
    categories_unlocked = _scalar(
        'SELECT SUM("no of category unlocked") FROM tableau_schema.live_ai_all_account_usage_report '
        "WHERE companyname = %s",
        (acct,), default=0,
    )
    # 08-Jun · stg_user_cat_sup_report grants landed — one row per
    # (email, category_added, supplier_added). supplier_id IS NOT NULL
    # marks an actual supplier-add event; nulls are bare category opens.
    suppliers_added = _scalar(
        "SELECT COUNT(*) FROM tableau_schema.stg_user_cat_sup_report "
        "WHERE procurement_company_name = %s AND supplier_id IS NOT NULL"
        + (" AND supplier_added_date >= %s" if start else ""),
        (acct, start) if start else (acct,), default=0,
    )

    # 09-Jun · Spec v11 row 14 — per-user first/last login table.
    # Caps at top 50 by most-recent login so the response stays small
    # for large accounts. Frontend renders a collapsible sub-section.
    per_user_login_rows = _rows(
        "SELECT s.email, MIN(s.sessionlogin) AS first_login, "
        "MAX(s.sessionlogin) AS last_login, COUNT(*) AS sessions "
        "FROM tableau_schema.stg_user_session_log s "
        "JOIN tableau_schema.activity_per_user a ON a.email = s.email "
        "WHERE a.companyname = %s "
        "GROUP BY s.email "
        "ORDER BY MAX(s.sessionlogin) DESC NULLS LAST "
        "LIMIT 50",
        (acct,),
    )
    per_user_logins = [
        {
            "email": r[0],
            "first_login": _date_iso(r[1]),
            "last_login": _date_iso(r[2]),
            "sessions": int(r[3] or 0),
        }
        for r in per_user_login_rows
    ]

    return _cache_put_and_return(key, {
        "window": window,
        "total_subscribers": int(total_subs or 0),
        "active_subscribers": int(active_subs or 0),
        "subscription_start": _date_iso(sub_start),
        "subscription_end": _date_iso(sub_end),
        "company_last_login": _date_iso(last_login),
        "total_logins": int(total_logins or 0),
        "total_time_spent_mins": round(float(total_time_mins or 0), 1),
        "categories_unlocked": int(categories_unlocked or 0),
        "suppliers_added": int(suppliers_added or 0),
        "per_user_logins": per_user_logins,
        "source": "redshift",
    })


# ============================================================
# SHEET 2 — Category Watch (Category Intelligence + MMD + Benchmarks)
# Category Intelligence + Benchmarks: most tables unreadable.
# MMD section: live_ai_mmd_report — readable.
# ============================================================


def category_watch_bundle(acct: str, window: str = "90d") -> dict:
    key = ("cat_watch", acct, window)
    if (c := _cache_get(key)) is not None:
        return c
    start, _ = _window_range(window)
    w_mmd = " AND actiontime >= %s" if start else ""
    p_mmd: tuple = (acct, start) if start else (acct,)

    # 08-Jun · stg_user_cat_sup_report grants landed — live queries below.
    # Window applied via category_added_date when a window is set.
    cat_window = " AND category_added_date >= %s" if start else ""
    cat_params: tuple = (acct, start) if start else (acct,)

    distinct_cats = _scalar(
        "SELECT COUNT(DISTINCT category_name) FROM tableau_schema.stg_user_cat_sup_report "
        "WHERE procurement_company_name = %s" + cat_window,
        cat_params, default=0,
    )
    distinct_users_with_cats = _scalar(
        "SELECT COUNT(DISTINCT email) FROM tableau_schema.stg_user_cat_sup_report "
        "WHERE procurement_company_name = %s" + cat_window,
        cat_params, default=0,
    )
    avg_cats = (
        round(float(distinct_cats) / float(distinct_users_with_cats), 2)
        if distinct_users_with_cats else 0.0
    )
    monthly_trend_rows = _rows(
        "SELECT TO_CHAR(DATE_TRUNC('month', category_added_date), 'YYYY-MM') AS m, "
        "COUNT(DISTINCT category_name) "
        "FROM tableau_schema.stg_user_cat_sup_report "
        "WHERE procurement_company_name = %s AND category_added_date IS NOT NULL"
        + cat_window
        + " GROUP BY 1 ORDER BY 1",
        cat_params,
    )
    new_cats_period_rows = _rows(
        "SELECT DISTINCT category_name "
        "FROM tableau_schema.stg_user_cat_sup_report "
        "WHERE procurement_company_name = %s" + cat_window
        + " AND category_name IS NOT NULL AND category_name <> '' "
        "ORDER BY 1 LIMIT 40",
        cat_params,
    )

    # 08-Jun · The stg_category*_reporttype tables DO exist + are
    # readable — the prior NA stubs were stale from before the grants
    # landed. Wiring them live below; account-scoping via the email
    # join to activity_per_user.
    view_w = " AND v.accessed_date >= %s" if start else ""
    view_p: tuple = (acct, start) if start else (acct,)
    dn_w = " AND d.downloadtime >= %s" if start else ""
    dn_p: tuple = (acct, start) if start else (acct,)

    report_views_total = _scalar(
        "SELECT COUNT(*) FROM tableau_schema.stg_categoryview_reporttype v "
        "JOIN tableau_schema.activity_per_user a ON a.email = v.email "
        "WHERE a.companyname = %s" + view_w,
        view_p, default=0,
    )
    category_visits = _scalar(
        "SELECT COUNT(DISTINCT v.email || '|' || v.categoryname || '|' || v.accessed_date::varchar) "
        "FROM tableau_schema.stg_categoryview_reporttype v "
        "JOIN tableau_schema.activity_per_user a ON a.email = v.email "
        "WHERE a.companyname = %s" + view_w,
        view_p, default=0,
    )
    revisit_pct = _scalar(
        "SELECT COUNT(CASE WHEN c > 1 THEN 1 END)::float / NULLIF(COUNT(*), 0) FROM ("
        "  SELECT v.email, v.categoryname, COUNT(*) c "
        "  FROM tableau_schema.stg_categoryview_reporttype v "
        "  JOIN tableau_schema.activity_per_user a ON a.email = v.email "
        "  WHERE a.companyname = %s" + view_w +
        "  GROUP BY v.email, v.categoryname"
        ") t",
        view_p, default=0.0,
    )
    top_views_rows = _rows(
        "SELECT v.reportname, COUNT(*) c "
        "FROM tableau_schema.stg_categoryview_reporttype v "
        "JOIN tableau_schema.activity_per_user a ON a.email = v.email "
        "WHERE a.companyname = %s AND v.reportname IS NOT NULL AND v.reportname <> ''"
        + view_w +
        " GROUP BY 1 ORDER BY c DESC LIMIT 10",
        view_p,
    )
    spend_pool_rows = _rows(
        "SELECT v.spendpool, COUNT(*) c "
        "FROM tableau_schema.stg_categoryview_reporttype v "
        "JOIN tableau_schema.activity_per_user a ON a.email = v.email "
        "WHERE a.companyname = %s AND v.spendpool IS NOT NULL AND v.spendpool <> ''"
        + view_w +
        " GROUP BY 1 ORDER BY c DESC LIMIT 10",
        view_p,
    )
    reporttype_rows = _rows(
        "SELECT v.reporttype, COUNT(DISTINCT v.categoryname) c "
        "FROM tableau_schema.stg_categoryview_reporttype v "
        "JOIN tableau_schema.activity_per_user a ON a.email = v.email "
        "WHERE a.companyname = %s AND v.reporttype IS NOT NULL AND v.reporttype <> ''"
        + view_w +
        " GROUP BY 1 ORDER BY c DESC",
        view_p,
    )

    report_downloads_total = _scalar(
        "SELECT COUNT(*) FROM tableau_schema.stg_categorydownloaded_reporttype d "
        "JOIN tableau_schema.activity_per_user a ON a.email = d.email "
        "WHERE a.companyname = %s" + dn_w,
        dn_p, default=0,
    )
    top_downloads_rows = _rows(
        "SELECT d.reportname, COUNT(*) c "
        "FROM tableau_schema.stg_categorydownloaded_reporttype d "
        "JOIN tableau_schema.activity_per_user a ON a.email = d.email "
        "WHERE a.companyname = %s AND d.reportname IS NOT NULL AND d.reportname <> ''"
        + dn_w +
        " GROUP BY 1 ORDER BY c DESC LIMIT 10",
        dn_p,
    )
    downloads_monthly_rows = _rows(
        "SELECT TO_CHAR(DATE_TRUNC('month', d.downloadtime), 'YYYY-MM') AS m, "
        "COUNT(*) "
        "FROM tableau_schema.stg_categorydownloaded_reporttype d "
        "JOIN tableau_schema.activity_per_user a ON a.email = d.email "
        "WHERE a.companyname = %s AND d.downloadtime IS NOT NULL "
        "GROUP BY 1 ORDER BY 1",
        (acct,),
    )

    added_detail_rows = _rows(
        "SELECT email, category_name, supplier_name, "
        "  COALESCE(category_added_date, supplier_added_date) "
        "FROM tableau_schema.stg_user_cat_sup_report "
        "WHERE procurement_company_name = %s"
        + cat_window +
        " AND category_name IS NOT NULL AND category_name <> '' "
        "ORDER BY COALESCE(category_added_date, supplier_added_date) DESC NULLS LAST "
        "LIMIT 50",
        cat_params,
    )

    cat_intel: dict[str, Any] = {
        "categories_unlocked": int(distinct_cats or 0),
        "avg_categories_per_user": avg_cats,
        "categories_added_monthly_trend": [
            {"month": r[0], "categories": int(r[1] or 0)} for r in monthly_trend_rows
        ],
        "categories_newly_added_period": [r[0] for r in new_cats_period_rows],
        "category_type_breakdown": [
            {"label": str(r[0] or "Other"), "count": int(r[1] or 0)} for r in reporttype_rows
        ],
        "category_visits": int(category_visits or 0),
        "category_revisit_pct": round(float(revisit_pct or 0) * 100, 1),
        "report_downloads_total": int(report_downloads_total or 0),
        "report_views_total": int(report_views_total or 0),
        "top_report_views": [
            {"label": str(r[0] or "(blank)"), "count": int(r[1] or 0)} for r in top_views_rows
        ],
        "top_report_downloads": [
            {"label": str(r[0] or "(blank)"), "count": int(r[1] or 0)} for r in top_downloads_rows
        ],
        "reports_downloaded_monthly_trend": [
            {"month": r[0], "downloads": int(r[1] or 0)} for r in downloads_monthly_rows
        ],
        "added_categories_detail": [
            {
                "email": r[0],
                "category": r[1],
                "supplier": r[2] or None,
                "added_at": _date_iso(r[3]),
            }
            for r in added_detail_rows
        ],
        "spend_pool_top_n": [
            {"label": str(r[0] or "(blank)"), "count": int(r[1] or 0)} for r in spend_pool_rows
        ],
        "industry_relevant_pct": _na("offline — SharePoint Industry Mapping file"),
    }
    avg_time = _scalar(
        "SELECT SUM(s.totaltimespent_sec)/60.0/NULLIF(COUNT(DISTINCT s.email),0) "
        "FROM tableau_schema.stg_user_session_log s "
        "JOIN tableau_schema.activity_per_user a ON a.email = s.email "
        "WHERE a.companyname = %s",
        (acct,),
    )
    cat_intel["avg_time_per_subscriber_mins"] = round(float(avg_time or 0), 1)

    mmd = {
        "subscribers": int(_scalar(
            f"SELECT COUNT(DISTINCT email) FROM tableau_schema.live_ai_mmd_report "
            f"WHERE companyname = %s{w_mmd}", p_mmd, default=0,
        ) or 0),
        "total_time_mins": round(float(_scalar(
            f"SELECT SUM(timespentinseconds)/60.0 FROM tableau_schema.live_ai_mmd_report "
            f"WHERE companyname = %s{w_mmd}", p_mmd, default=0,
        ) or 0), 1),
        "avg_time_per_user_mins": round(float(_scalar(
            f"SELECT SUM(timespentinseconds)/60.0/NULLIF(COUNT(DISTINCT email),0) "
            f"FROM tableau_schema.live_ai_mmd_report WHERE companyname = %s{w_mmd}",
            p_mmd, default=0,
        ) or 0), 1),
        "unique_categories_viewed": int(_scalar(
            f"SELECT COUNT(DISTINCT categoryname) FROM tableau_schema.live_ai_mmd_report "
            f"WHERE companyname = %s{w_mmd}", p_mmd, default=0,
        ) or 0),
        "avg_categories_per_user": round(float(_scalar(
            f"SELECT COUNT(DISTINCT categoryname)::float/NULLIF(COUNT(DISTINCT email),0) "
            f"FROM tableau_schema.live_ai_mmd_report WHERE companyname = %s{w_mmd}",
            p_mmd, default=0,
        ) or 0), 1),
        "grades_viewed": [
            {"label": str(r[0]), "count": int(r[1])} for r in _rows(
                f"SELECT categoryname, COUNT(*) FROM tableau_schema.live_ai_mmd_report "
                f"WHERE companyname = %s AND TRIM(useraction)='Grade'{w_mmd} "
                f"GROUP BY categoryname ORDER BY 2 DESC LIMIT 10", p_mmd,
            )
        ],
        "regions_viewed": [
            {"label": str(r[0]), "count": int(r[1])} for r in _rows(
                f"SELECT categoryname, COUNT(*) FROM tableau_schema.live_ai_mmd_report "
                f"WHERE companyname = %s AND TRIM(useraction)='Location'{w_mmd} "
                f"GROUP BY categoryname ORDER BY 2 DESC LIMIT 10", p_mmd,
            )
        ],
        "monthly_trend": [
            {"month": str(r[0])[:7], "subscribers": int(r[1]), "visits": int(r[2])}
            for r in _rows(
                f"SELECT DATE_TRUNC('month', actiontime) m, COUNT(DISTINCT email), COUNT(*) "
                f"FROM tableau_schema.live_ai_mmd_report WHERE companyname = %s{w_mmd} "
                f"GROUP BY 1 ORDER BY 1", p_mmd,
            )
        ],
    }

    # 08-Jun · stg_benchmark grants landed. The table only carries email
    # (no companyname) — join to activity_per_user to filter by account.
    # answerdate carries the time-bucket key for the optional window.
    bench_w = " AND b.answerdate >= %s" if start else ""
    bench_p: tuple = (acct, start) if start else (acct,)
    bench_total = _scalar(
        "SELECT COUNT(*) FROM tableau_schema.stg_benchmark b "
        "JOIN tableau_schema.activity_per_user a ON a.email = b.email "
        "WHERE a.companyname = %s" + bench_w,
        bench_p, default=0,
    )
    bench_responders = _scalar(
        "SELECT COUNT(DISTINCT b.email) FROM tableau_schema.stg_benchmark b "
        "JOIN tableau_schema.activity_per_user a ON a.email = b.email "
        "WHERE a.companyname = %s" + bench_w,
        bench_p, default=0,
    )
    bench_cats = [
        {"label": str(r[0] or "(blank)"), "count": int(r[1] or 0)} for r in _rows(
            "SELECT b.questioncategoryname, COUNT(*) "
            "FROM tableau_schema.stg_benchmark b "
            "JOIN tableau_schema.activity_per_user a ON a.email = b.email "
            "WHERE a.companyname = %s" + bench_w
            + " GROUP BY 1 ORDER BY 2 DESC LIMIT 15",
            bench_p,
        )
    ]
    benchmarks: dict[str, Any] = {
        "total_benchmark_responses": int(bench_total or 0),
        "total_subscribers_responded": int(bench_responders or 0),
        "benchmark_question_categories": bench_cats,
        "rfx_template_downloads": _na("offline — no Redshift pipeline"),
    }
    bench_time = _scalar(
        "SELECT SUM(s.totaltimespent_sec)/60.0 FROM tableau_schema.stg_user_session_log s "
        "JOIN tableau_schema.activity_per_user a ON a.email = s.email "
        "WHERE a.companyname = %s AND s.module ILIKE '%benchmark%'",
        (acct,),
    )
    benchmarks["benchmark_time_mins"] = round(float(bench_time or 0), 1)

    return _cache_put_and_return(key, {
        "window": window,
        "category_intelligence": cat_intel,
        "mmd": mmd,
        "benchmarks": benchmarks,
        "source": "redshift",
    })


def mmd_bundle(acct: str, window: str = "90d") -> dict:
    """Convenience: just the MMD subsection of category_watch_bundle."""
    return {"window": window, **category_watch_bundle(acct, window)["mmd"], "source": "redshift"}


# ============================================================
# SHEET 3 — Abi (16 KPIs)
# Spec referenced tableau_schema.live_ai_freshservice_abi (does NOT
# exist). Real table: live_ai_incremental.freshservice_abi.
# ============================================================


def abi_bundle(acct: str, window: str = "90d") -> dict:
    key = ("abi", acct, window)
    if (c := _cache_get(key)) is not None:
        return c
    start, _ = _window_range(window)
    where = ' AND "created time" >= %s' if start else ""
    p: tuple = (acct, start) if start else (acct,)

    total_q = _scalar(
        f'SELECT COUNT(ticket_id) FROM live_ai_incremental.freshservice_abi '
        f'WHERE "company name" = %s{where}', p, default=0,
    )
    unique_users = _scalar(
        f'SELECT COUNT(DISTINCT requester_email) FROM live_ai_incremental.freshservice_abi '
        f'WHERE "company name" = %s{where}', p, default=0,
    )
    by_complexity = [
        {"label": str(r[0] or "Unclassified"), "count": int(r[1] or 0)} for r in _rows(
            f'SELECT abi_query_class, COUNT(*) FROM live_ai_incremental.freshservice_abi '
            f'WHERE "company name" = %s{where} GROUP BY abi_query_class ORDER BY 2 DESC', p,
        )
    ]
    by_status = [
        {"label": str(r[0] or "Unknown"), "count": int(r[1] or 0)} for r in _rows(
            f'SELECT status, COUNT(*) FROM live_ai_incremental.freshservice_abi '
            f'WHERE "company name" = %s{where} GROUP BY status ORDER BY 2 DESC', p,
        )
    ]
    bot_pct = _scalar(
        f'SELECT SUM(CASE WHEN "is it resolved by bot?" ILIKE %s THEN 1 ELSE 0 END)::float '
        f'/NULLIF(COUNT(*),0) FROM live_ai_incremental.freshservice_abi '
        f'WHERE "company name" = %s{where}',
        ('yes', acct, start) if start else ('yes', acct), default=0.0,
    )
    time_per_user = [
        {"email": r[0], "hours": float(r[1] or 0)} for r in _rows(
            f'SELECT requester_email, SUM("actual hours") FROM live_ai_incremental.freshservice_abi '
            f'WHERE "company name" = %s{where} GROUP BY requester_email '
            f'ORDER BY 2 DESC NULLS LAST LIMIT 50', p,
        )
    ]
    repeat_pct = _scalar(
        f"SELECT COUNT(CASE WHEN q>1 THEN 1 END)::float/NULLIF(COUNT(*),0) FROM ("
        f'SELECT requester_email, COUNT(*) q FROM live_ai_incremental.freshservice_abi '
        f'WHERE "company name" = %s{where} GROUP BY requester_email)', p, default=0.0,
    )
    avg_fb = _scalar(
        f"SELECT AVG(CASE WHEN feedback ~ '^[0-9.]+$' THEN feedback::float END) "
        f'FROM live_ai_incremental.freshservice_abi WHERE "company name" = %s{where}', p,
    )
    thumbs_up_pct = _scalar(
        f"SELECT SUM(CASE WHEN feedback ILIKE 'Yes' THEN 1 ELSE 0 END)::float"
        f"/NULLIF(SUM(CASE WHEN feedback ILIKE 'Yes' OR feedback ILIKE 'No' "
        f"THEN 1 ELSE 0 END),0) "
        f'FROM live_ai_incremental.freshservice_abi WHERE "company name" = %s{where}', p,
    )
    top_deliv = [
        {"label": str(r[0] or "Other"), "count": int(r[1] or 0)} for r in _rows(
            f'SELECT "beroe core category", COUNT(*) FROM live_ai_incremental.freshservice_abi '
            f'WHERE "company name" = %s{where} GROUP BY "beroe core category" '
            f'ORDER BY 2 DESC LIMIT 5', p,
        )
    ]
    inside_outside_split = [
        {"label": str(r[0] or "Unknown"), "count": int(r[1] or 0)} for r in _rows(
            f'SELECT cat_outside_l_ai, COUNT(*) FROM live_ai_incremental.freshservice_abi '
            f'WHERE "company name" = %s{where} GROUP BY cat_outside_l_ai', p,
        )
    ]
    top_declined = [
        {"label": str(r[0] or "Other"), "count": int(r[1] or 0)} for r in _rows(
            f'SELECT "beroe core category", COUNT(*) FROM live_ai_incremental.freshservice_abi '
            f"WHERE \"company name\" = %s AND final_query_status ILIKE '%declin%'{where} "
            f'GROUP BY "beroe core category" ORDER BY 2 DESC LIMIT 5', p,
        )
    ]
    declined_by_module = [
        {"label": str(r[0] or "Other"), "count": int(r[1] or 0)} for r in _rows(
            f'SELECT type_of_deliverable, COUNT(*) FROM live_ai_incremental.freshservice_abi '
            f"WHERE \"company name\" = %s AND final_query_status ILIKE '%declin%'{where} "
            f'GROUP BY type_of_deliverable ORDER BY 2 DESC', p,
        )
    ]
    research_referral = [
        {"label": str(r[0] or "Unknown"), "count": int(r[1] or 0)} for r in _rows(
            f'SELECT "reason for research referral", COUNT(*) '
            f'FROM live_ai_incremental.freshservice_abi '
            f'WHERE "company name" = %s{where} '
            f'GROUP BY "reason for research referral" ORDER BY 2 DESC', p,
        )
    ]
    by_source = [
        {"label": str(r[0] or "Unknown"), "count": int(r[1] or 0)} for r in _rows(
            f'SELECT query_source, COUNT(*) FROM live_ai_incremental.freshservice_abi '
            f'WHERE "company name" = %s{where} GROUP BY query_source ORDER BY 2 DESC', p,
        )
    ]
    top_geos = [
        {"label": str(r[0] or "Unknown"), "count": int(r[1] or 0)} for r in _rows(
            f'SELECT geographic_scope_country, COUNT(*) '
            f'FROM live_ai_incremental.freshservice_abi '
            f'WHERE "company name" = %s{where} GROUP BY geographic_scope_country '
            f'ORDER BY 2 DESC LIMIT 10', p,
        )
    ]

    return _cache_put_and_return(key, {
        "window": window,
        # Spec: AI-generated narrative — not a Redshift KPI. Wired via
        # /ai/* endpoints when the Anthropic-powered insight ships.
        "engagement_insight": _na("AI-generated narrative; future Anthropic endpoint"),
        "total_queries": int(total_q or 0),
        "unique_users": int(unique_users or 0),
        "by_complexity": by_complexity,
        "by_status": by_status,
        "bot_resolution_pct": round(float(bot_pct or 0) * 100, 1),
        "time_per_user_top50": time_per_user,
        "repeat_users_pct": round(float(repeat_pct or 0) * 100, 1),
        "avg_feedback": round(float(avg_fb), 2) if avg_fb else None,
        "thumbs_up_pct": round(float(thumbs_up_pct or 0) * 100, 1) if thumbs_up_pct is not None else None,
        "top_deliverable": top_deliv,
        "inside_vs_outside_split": inside_outside_split,
        "top_declined_deliverable": top_declined,
        "declined_by_module": declined_by_module,
        "research_referral_reasons": research_referral,
        "by_source": by_source,
        "top_geographies": top_geos,
        "source": "redshift",
    })


# ============================================================
# SHEET 4 — Supplier Discovery (11 KPIs)
# Spec: tableau_schema.forestreet_usage_table (does NOT exist).
# Substitute: live_ai_incremental.supplierdiscoveryusersearch +
#             live_ai_incremental.supplierdiscoverytimespent.
# ============================================================


def supplier_discovery_bundle(acct: str, window: str = "90d") -> dict:
    key = ("sd", acct, window)
    if (c := _cache_get(key)) is not None:
        return c
    start, _ = _window_range(window)
    w_search = " AND login_date >= %s" if start else ""
    w_time = " AND logindate >= %s" if start else ""
    p_search: tuple = (acct, start) if start else (acct,)
    p_time: tuple = (acct, start) if start else (acct,)

    users = _scalar(
        f"SELECT COUNT(DISTINCT email) FROM live_ai_incremental.supplierdiscoveryusersearch "
        f"WHERE company_name = %s{w_search}", p_search, default=0,
    )
    searches = _scalar(
        f"SELECT COUNT(*) FROM live_ai_incremental.supplierdiscoveryusersearch "
        f"WHERE company_name = %s{w_search}", p_search, default=0,
    )
    # Redshift can't COUNT(DISTINCT (a,b)) — use string concat instead.
    visits = _scalar(
        f"SELECT COUNT(DISTINCT email || '|' || CAST(session_starttime AS varchar)) "
        f"FROM live_ai_incremental.supplierdiscoveryusersearch "
        f"WHERE company_name = %s{w_search}", p_search, default=0,
    )
    time_mins = _scalar(
        f"SELECT SUM(totaltimespendonmodule)/60.0 "
        f"FROM live_ai_incremental.supplierdiscoverytimespent "
        f"WHERE companyname = %s{w_time}", p_time, default=0,
    )
    avg_per_user = (float(searches or 0) / users) if users else 0.0
    top_categories = [
        {"label": str(r[0] or "(blank)"), "count": int(r[1] or 0)} for r in _rows(
            f"SELECT search_keywords, COUNT(*) FROM live_ai_incremental.supplierdiscoveryusersearch "
            f"WHERE company_name = %s{w_search} GROUP BY search_keywords "
            f"ORDER BY 2 DESC LIMIT 10", p_search,
        )
    ]
    repeat_pct = _scalar(
        f"SELECT COUNT(DISTINCT CASE WHEN c>1 THEN email END)::float "
        f"/NULLIF(COUNT(DISTINCT email),0) FROM ("
        f"SELECT email, COUNT(*) c FROM live_ai_incremental.supplierdiscoveryusersearch "
        f"WHERE company_name = %s{w_search} GROUP BY email)", p_search, default=0.0,
    )

    # 08-Jun · forestreet_usage_table grants landed — wire the regions
    # + downloads slots from the real table in tableau_schema (we'd been
    # subbing with supplierdiscoveryusersearch which doesn't carry
    # countrydropdown or downloadshortlist).
    top_regions = [
        {"label": str(r[0] or "(blank)"), "count": int(r[1] or 0)} for r in _rows(
            "SELECT countrydropdown, COUNT(*) FROM tableau_schema.forestreet_usage_table "
            "WHERE companyname = %s AND countrydropdown IS NOT NULL AND countrydropdown <> '' "
            "GROUP BY 1 ORDER BY 2 DESC LIMIT 10",
            (acct,),
        )
    ]
    sd_downloads = _scalar(
        "SELECT SUM(downloadshortlist) FROM tableau_schema.forestreet_usage_table "
        "WHERE companyname = %s",
        (acct,), default=0,
    )

    return _cache_put_and_return(key, {
        "window": window,
        "users": int(users or 0),
        "total_searches": int(searches or 0),
        "avg_searches_per_user": round(avg_per_user, 1),
        "total_visits": int(visits or 0),
        "total_time_mins": round(float(time_mins or 0), 1),
        "top_categories_searched": top_categories,
        "repeat_users_pct": round(float(repeat_pct or 0) * 100, 1),
        "top_regions_scoped": top_regions,
        "categories_pct_split": _na("inside_outside_flag column not present in any Forestreet table"),
        "suppliers_shortlisted_avg": _na("result-count per search not captured anywhere"),
        "sd_downloads": int(sd_downloads or 0),
        "source": "redshift",
    })


# ============================================================
# SHEET 5 — Supplier Monitoring Risk
# Source: tableau_schema.stg_user_cat_sup_report — PERMISSION DENIED.
# Only the time-spent KPI is computable via stg_user_session_log.
# ============================================================


def supplier_monitoring_bundle(acct: str, window: str = "90d") -> dict:
    key = ("sm", acct, window)
    if (c := _cache_get(key)) is not None:
        return c
    start, _ = _window_range(window)
    w = " AND supplier_added_date >= %s" if start else ""
    base = (acct, start) if start else (acct,)

    time_mins = _scalar(
        "SELECT SUM(s.totaltimespent_sec)/60.0 FROM tableau_schema.stg_user_session_log s "
        "JOIN tableau_schema.activity_per_user a ON a.email = s.email "
        "WHERE a.companyname = %s AND s.module ILIKE '%supplier%'",
        (acct,),
    )

    # 08-Jun · stg_user_cat_sup_report grants landed. supplier_id IS NOT NULL
    # marks a real supplier-add event (the table also stores bare category
    # opens with supplier_id NULL — those are excluded everywhere here).
    suppliers_monitored = _scalar(
        "SELECT COUNT(DISTINCT supplier_id) FROM tableau_schema.stg_user_cat_sup_report "
        "WHERE procurement_company_name = %s AND supplier_id IS NOT NULL",
        (acct,), default=0,
    )
    new_in_period = _scalar(
        "SELECT COUNT(DISTINCT supplier_id) FROM tableau_schema.stg_user_cat_sup_report "
        "WHERE procurement_company_name = %s AND supplier_id IS NOT NULL" + w,
        base, default=0,
    )
    users_adding = _scalar(
        "SELECT COUNT(DISTINCT email) FROM tableau_schema.stg_user_cat_sup_report "
        "WHERE procurement_company_name = %s AND supplier_id IS NOT NULL" + w,
        base, default=0,
    )

    # DNB rating 1-9 → low/medium/high buckets. NULL ratings tracked
    # separately so the UI can show "no data" honestly instead of
    # silently collapsing them into a tier.
    risk_rows = _rows(
        "SELECT CASE "
        "  WHEN supplier_dnb_rating BETWEEN 1 AND 3 THEN 'low' "
        "  WHEN supplier_dnb_rating BETWEEN 4 AND 6 THEN 'medium' "
        "  WHEN supplier_dnb_rating BETWEEN 7 AND 9 THEN 'high' "
        "  ELSE 'unknown' END AS tier, "
        "COUNT(DISTINCT supplier_id) "
        "FROM tableau_schema.stg_user_cat_sup_report "
        "WHERE procurement_company_name = %s AND supplier_id IS NOT NULL "
        "GROUP BY 1 ORDER BY 1",
        (acct,),
    )
    suppliers_by_risk = {r[0]: int(r[1] or 0) for r in risk_rows}

    mom_trend = [
        {"month": r[0], "suppliers_added": int(r[1] or 0)} for r in _rows(
            "SELECT TO_CHAR(DATE_TRUNC('month', supplier_added_date), 'YYYY-MM') AS m, "
            "COUNT(DISTINCT supplier_id) "
            "FROM tableau_schema.stg_user_cat_sup_report "
            "WHERE procurement_company_name = %s AND supplier_id IS NOT NULL "
            "AND supplier_added_date IS NOT NULL "
            "GROUP BY 1 ORDER BY 1",
            (acct,),
        )
    ]

    added_list = [
        {
            "email": r[0], "supplier_name": r[1], "category": r[2],
            "added_at": _date_iso(r[3]),
        }
        for r in _rows(
            "SELECT email, supplier_name, category_name, supplier_added_date "
            "FROM tableau_schema.stg_user_cat_sup_report "
            "WHERE procurement_company_name = %s AND supplier_id IS NOT NULL"
            + w + " ORDER BY supplier_added_date DESC NULLS LAST LIMIT 50",
            base,
        )
    ]

    return _cache_put_and_return(key, {
        "window": window,
        "total_time_mins": round(float(time_mins or 0), 1),
        "suppliers_monitored": int(suppliers_monitored or 0),
        "suppliers_by_risk_level": suppliers_by_risk,
        "new_suppliers_in_period": int(new_in_period or 0),
        "users_adding_suppliers": int(users_adding or 0),
        "mom_trend_suppliers_added": mom_trend,
        "data_refreshes_last_30d": _na("no refresh-event column in stg_user_cat_sup_report"),
        "suppliers_added_vs_contracted_pct": _na("offline — contracted slots not in Redshift"),
        "usage_vs_runway": _na("offline — contract runway not in Redshift"),
        "suppliers_added_list": added_list,
        "source": "redshift",
    })


# ============================================================
# SHEET 6 — Custom Usage (14 KPIs)
# Source: live_ai_incremental.freshservice_abi (spec's
# tableau_schema.live_ai_freshservice_abi does not exist).
# ============================================================


def custom_usage_bundle(acct: str, window: str = "fy") -> dict:
    key = ("custom", acct, window)
    if (c := _cache_get(key)) is not None:
        return c
    start, _ = _window_range(window)
    where = ' AND "created time" >= %s' if start else ""
    p: tuple = (acct, start) if start else (acct,)

    # Spec uses `SUM(credits)` — column does not exist in freshservice_abi.
    # Substitute: query COUNT by class as a proxy until the credits ETL lands.
    def class_count(prefix: str) -> int:
        return int(_scalar(
            f'SELECT COUNT(*) FROM live_ai_incremental.freshservice_abi '
            f'WHERE "company name" = %s AND abi_query_class ILIKE %s{where}',
            (acct, f"{prefix}%", start) if start else (acct, f"{prefix}%"), default=0,
        ) or 0)

    l1 = class_count("L1")
    l2 = class_count("L2")
    l3 = class_count("L3")
    l4 = class_count("L4")
    total = _scalar(
        f'SELECT COUNT(*) FROM live_ai_incremental.freshservice_abi '
        f'WHERE "company name" = %s{where}', p, default=0,
    )
    commodity_dash = _scalar(
        f'SELECT COUNT(*) FROM live_ai_incremental.freshservice_abi '
        f"WHERE \"company name\" = %s AND type_of_deliverable ILIKE '%commodity dashboard%'{where}",
        p, default=0,
    )
    country_reports = _scalar(
        f'SELECT COUNT(*) FROM live_ai_incremental.freshservice_abi '
        f"WHERE \"company name\" = %s AND type_of_deliverable ILIKE '%country report%'{where}",
        p, default=0,
    )
    feedback_score = _scalar(
        f"SELECT AVG(CASE WHEN feedback ~ '^[0-9.]+$' THEN feedback::float END) "
        f'FROM live_ai_incremental.freshservice_abi WHERE "company name" = %s{where}', p,
    )
    swat_vs_basics = [
        {"label": str(r[0] or "Unknown"), "count": int(r[1] or 0)} for r in _rows(
            f'SELECT "request type", COUNT(*) FROM live_ai_incremental.freshservice_abi '
            f'WHERE "company name" = %s{where} GROUP BY "request type"', p,
        )
    ]
    top_cats = [
        {"label": str(r[0] or "Other"), "count": int(r[1] or 0)} for r in _rows(
            f'SELECT "beroe core category", COUNT(*) FROM live_ai_incremental.freshservice_abi '
            f'WHERE "company name" = %s{where} GROUP BY "beroe core category" '
            f'ORDER BY 2 DESC LIMIT 10', p,
        )
    ]
    spendpools = [
        {"label": str(r[0] or "Unknown"), "count": int(r[1] or 0)} for r in _rows(
            f'SELECT categories_and_sourcing_reports, COUNT(*) '
            f'FROM live_ai_incremental.freshservice_abi '
            f'WHERE "company name" = %s{where} GROUP BY categories_and_sourcing_reports '
            f'ORDER BY 2 DESC LIMIT 10', p,
        )
    ]
    deliverables = [
        {"label": str(r[0] or "Other"), "count": int(r[1] or 0)} for r in _rows(
            f'SELECT type_of_deliverable, COUNT(*) FROM live_ai_incremental.freshservice_abi '
            f'WHERE "company name" = %s{where} GROUP BY type_of_deliverable '
            f'ORDER BY 2 DESC LIMIT 10', p,
        )
    ]

    return _cache_put_and_return(key, {
        "window": window,
        # NB: spec uses SUM(credits) but freshservice_abi has no credits
        # column — these are COUNT(*) by complexity class as a proxy.
        "credits_by_complexity": {"L1": l1, "L2": l2, "L3": l3, "L4": l4},
        "credits_by_complexity_note": "proxy: COUNT(*) — credits column missing in freshservice_abi",
        "total_credits_used": int(total or 0),
        "credits_estimated_active": _na("offline — SharePoint Custom file"),
        "credits_allocated_tier": _na("offline — SharePoint Custom file"),
        "credits_utilization_pct": _na("offline — denominator (allocation) is SharePoint"),
        "commodity_dashboards": int(commodity_dash or 0),
        "country_reports": int(country_reports or 0),
        "client_feedback_score": round(float(feedback_score), 2) if feedback_score else None,
        "ai_swat_vs_basics": swat_vs_basics,
        "top_categories": top_cats,
        "top_spendpools": spendpools,
        "top_deliverables": deliverables,
        "source": "redshift",
    })


# ============================================================
# SHEET 7 — Thought Leadership (4 KPIs)
# 08-Jun · stg_thoughtleadership grants landed — querying the real
# table directly (was substituted with the incremental view earlier).
# Same column shape: email + reportname + tltype + viewtime.
# ============================================================


def thought_leadership_bundle(acct: str, window: str = "90d") -> dict:
    key = ("tl", acct, window)
    if (c := _cache_get(key)) is not None:
        return c
    start, _ = _window_range(window)
    where = " AND t.viewtime >= %s" if start else ""
    p: tuple = (acct, start) if start else (acct,)

    def count_where(extra: str):
        return _scalar(
            f"SELECT COUNT(*) FROM tableau_schema.stg_thoughtleadership t "
            f"JOIN tableau_schema.activity_per_user a ON a.email = t.email "
            f"WHERE a.companyname = %s{where} AND {extra}",
            p, default=0,
        ) or 0

    webinars = count_where("t.tltype ILIKE '%webinar%'")
    articles = count_where("t.tltype ILIKE '%article%'")
    beige_views = count_where("t.reportname ILIKE '%beige%' AND t.viewtime IS NOT NULL")
    beige_downloads = count_where(
        "t.reportname ILIKE '%beige%' AND t.tltype ILIKE '%download%'"
    )
    by_type = [
        {"label": str(r[0] or "Other"), "count": int(r[1] or 0)} for r in _rows(
            f"SELECT t.tltype, COUNT(*) FROM tableau_schema.stg_thoughtleadership t "
            f"JOIN tableau_schema.activity_per_user a ON a.email = t.email "
            f"WHERE a.companyname = %s{where} GROUP BY t.tltype ORDER BY 2 DESC", p,
        )
    ]

    return _cache_put_and_return(key, {
        "window": window,
        "webinar_views": int(webinars),
        "articles_opened": int(articles),
        "beigebook_views": int(beige_views),
        "beigebook_downloads": int(beige_downloads),
        "by_type": by_type,
        "source": "redshift",
    })


# ============================================================
# SHEET 8 — DataHub (1 KPI) — permission denied
# ============================================================


def datahub_bundle(acct: str, window: str = "90d") -> dict:
    # 08-Jun · datahub_category_merged grants landed. `companyname` is on
    # the row directly so no join needed; `date` is the bucket column for
    # the optional window.
    key = ("datahub", acct, window)
    if (c := _cache_get(key)) is not None:
        return c
    start, _ = _window_range(window)
    where = " AND date >= %s" if start else ""
    p: tuple = (acct, start) if start else (acct,)
    data_pulls = _scalar(
        "SELECT COALESCE(SUM(frequency), 0) "
        "FROM tableau_schema.datahub_category_merged "
        "WHERE companyname = %s" + where,
        p, default=0,
    )
    return _cache_put_and_return(key, {
        "window": window,
        "data_pulls": int(data_pulls or 0),
        "source": "redshift",
    })


# ============================================================
# SHEET 9 — Inflation Watch GIT (8 KPIs)
# Union of git_home_report + git_addition_report + git_custom_cd,
# joined to activity_per_user for account scoping (substitute for
# mt_table_user_level).
# ============================================================


_GIT_UNION = (
    "(SELECT email, session_login, session_logout, event_timestamp, event_action "
    " FROM live_ai_incremental.git_home_report "
    " UNION ALL "
    " SELECT email, session_login, session_logout, event_timestamp, event_action "
    " FROM live_ai_incremental.git_addition_report "
    " UNION ALL "
    " SELECT email, session_login, session_logout, event_timestamp, event_action "
    " FROM live_ai_incremental.git_custom_cd) g"
)


def inflation_watch_bundle(acct: str, window: str = "90d") -> dict:
    key = ("iw", acct, window)
    if (c := _cache_get(key)) is not None:
        return c
    start, _ = _window_range(window)
    where = " AND g.event_timestamp >= %s" if start else ""
    p: tuple = (acct, start) if start else (acct,)

    visitors = _scalar(
        f"SELECT COUNT(DISTINCT g.email) FROM {_GIT_UNION} "
        f"JOIN tableau_schema.activity_per_user a ON a.email = g.email "
        f"WHERE a.companyname = %s{where}", p, default=0,
    )
    sessions = _scalar(
        f"SELECT COUNT(*) FROM (SELECT DISTINCT g.email, g.session_login, g.session_logout "
        f"FROM {_GIT_UNION} JOIN tableau_schema.activity_per_user a ON a.email = g.email "
        f"WHERE a.companyname = %s{where}) s", p, default=0,
    )
    time_mins = _scalar(
        f"SELECT ROUND(SUM(DATEDIFF(second, s.session_login, s.session_logout))/60.0, 1) "
        f"FROM (SELECT DISTINCT g.email, g.session_login, g.session_logout FROM {_GIT_UNION} "
        f"JOIN tableau_schema.activity_per_user a ON a.email = g.email "
        f"WHERE a.companyname = %s{where}) s", p, default=0,
    )
    avg_sessions = (float(sessions or 0) / visitors) if visitors else 0.0
    avg_session_mins = (float(time_mins or 0) / sessions) if sessions else 0.0
    avg_time_per_visitor = (float(time_mins or 0) / visitors) if visitors else 0.0

    top_features = [
        {"feature": str(r[0]), "visitors": int(r[1]), "views": int(r[2])} for r in _rows(
            f"SELECT g.event_action, COUNT(DISTINCT g.email) AS visitors, COUNT(*) AS views "
            f"FROM live_ai_incremental.git_home_report g "
            f"JOIN tableau_schema.activity_per_user a ON a.email = g.email "
            f"WHERE a.companyname = %s"
            f"{(' AND g.event_timestamp >= %s' if start else '')} "
            f"GROUP BY g.event_action ORDER BY views DESC LIMIT 15", p,
        )
    ]

    sm = _rows(
        "SELECT "
        "  COUNT(DISTINCT CASE WHEN g.event_action='Create_CS' THEN g.email END) AS ran, "
        "  COUNT(DISTINCT CASE WHEN g.event_action ILIKE '%save%' "
        "     OR g.message ILIKE '%scenario%save%' THEN g.email END) AS saved "
        "FROM live_ai_incremental.git_home_report g "
        "JOIN tableau_schema.activity_per_user a ON a.email = g.email "
        "WHERE a.companyname = %s",
        (acct,),
    )
    scenario_modelling = {
        "ran": int(sm[0][0] or 0) if sm else 0,
        "saved": int(sm[0][1] or 0) if sm else 0,
    }

    return _cache_put_and_return(key, {
        "window": window,
        "unique_visitors": int(visitors or 0),
        "total_sessions": int(sessions or 0),
        "total_time_mins": round(float(time_mins or 0), 1),
        "avg_sessions_per_visitor": round(avg_sessions, 1),
        "avg_session_time_mins": round(avg_session_mins, 1),
        "avg_time_per_visitor_mins": round(avg_time_per_visitor, 1),
        "top_features": top_features,
        "scenario_modelling": scenario_modelling,
        "top_pages": [
            {"page": str(r[0] or "(blank)"), "views": int(r[1] or 0)} for r in _rows(
                "SELECT url, COUNT(*) "
                "FROM tableau_schema.stg_piwik_cirtuoreport "
                "WHERE company_name = %s AND url IS NOT NULL AND url <> '' "
                + (" AND time_accessed >= %s" if start else "")
                + " GROUP BY 1 ORDER BY 2 DESC LIMIT 15",
                (acct, start) if start else (acct,),
            )
        ],
        "source": "redshift",
    })


# ============================================================
# SHEETS 10-12 — Cirtuo / nnamu / Upply — all OFFLINE (CSV / SharePoint)
# ============================================================


def cirtuo_bundle(acct: str, window: str = "fy") -> dict:
    # Phase 3 — query public.intel_cirtuo_projects. Returns NA when the
    # loader hasn't run yet (no rows for this companyname).
    key = ("cirtuo", acct, window)
    if (c := _cache_get(key)) is not None:
        return c
    rs = _pg_rows(
        "SELECT SUM(categories_supported), SUM(feedback_received), SUM(feedback_total), "
        "AVG(feedback_score_avg) FROM public.intel_cirtuo_projects "
        "WHERE company_name = %s",
        (acct,),
    )
    has_data = rs and rs[0][0] is not None
    if not has_data:
        return _cache_put_and_return(key, {
            "window": window,
            "categories_supported": _na("Awaiting offline CSV load — scripts/intel_loaders/load_cirtuo.py"),
            "feedback_captured_pct": _na("Awaiting offline CSV load — scripts/intel_loaders/load_cirtuo.py"),
            "average_feedback": _na("Awaiting offline CSV load — scripts/intel_loaders/load_cirtuo.py"),
            "source": "offline",
        })
    cat_total, fb_recv, fb_total, fb_avg = rs[0]
    fb_pct = (float(fb_recv or 0) / float(fb_total)) * 100 if fb_total else None
    return _cache_put_and_return(key, {
        "window": window,
        "categories_supported": int(cat_total or 0),
        "feedback_captured_pct": round(fb_pct, 1) if fb_pct is not None else None,
        "average_feedback": round(float(fb_avg), 2) if fb_avg is not None else None,
        "source": "offline",
    })


def nnamu_bundle(acct: str, window: str = "fy") -> dict:
    # Phase 3 — query public.intel_nnamu_savings.
    key = ("nnamu", acct, window)
    if (c := _cache_get(key)) is not None:
        return c
    rs = _pg_rows(
        "SELECT SUM(initial_comparison_price), SUM(final_comparison_price), "
        "SUM(absolute_savings) FROM public.intel_nnamu_savings "
        "WHERE company_name = %s",
        (acct,),
    )
    has_data = rs and rs[0][0] is not None
    if not has_data:
        reason = "Awaiting offline CSV load — scripts/intel_loaders/load_nnamu.py"
        return _cache_put_and_return(key, {
            "window": window,
            "total_spend_negotiated": _na(reason),
            "total_final_price": _na(reason),
            "total_absolute_savings": _na(reason),
            "avg_relative_savings_pct": _na(reason),
            "savings_by_customer": _na(reason),
            "customers_with_savings": _na(reason),
            "source": "offline",
        })
    initial, final, abs_savings = rs[0]
    initial_f = float(initial or 0); final_f = float(final or 0)
    pct = (initial_f - final_f) / initial_f * 100 if initial_f else None
    customers_with_savings = _pg_scalar(
        "SELECT COUNT(DISTINCT company_name) FROM public.intel_nnamu_savings "
        "WHERE absolute_savings > 0", default=0,
    )
    return _cache_put_and_return(key, {
        "window": window,
        "total_spend_negotiated": round(initial_f, 2),
        "total_final_price": round(final_f, 2),
        "total_absolute_savings": round(float(abs_savings or initial_f - final_f), 2),
        "avg_relative_savings_pct": round(pct, 1) if pct is not None else None,
        "savings_by_customer": [
            {"company_name": r[0], "absolute_savings": float(r[1] or 0)}
            for r in _pg_rows(
                "SELECT company_name, SUM(absolute_savings) FROM public.intel_nnamu_savings "
                "GROUP BY company_name ORDER BY 2 DESC NULLS LAST LIMIT 20",
            )
        ],
        "customers_with_savings": int(customers_with_savings or 0),
        "source": "offline",
    })


def upply_bundle(acct: str, window: str = "90d") -> dict:
    # Phase 3 — query public.intel_upply_tracking.
    key = ("upply", acct, window)
    if (c := _cache_get(key)) is not None:
        return c
    start, _ = _window_range(window)
    where = " AND request_date >= %s" if start else ""
    p: tuple = (acct, start) if start else (acct,)
    total = _pg_scalar(
        f"SELECT COUNT(*) FROM public.intel_upply_tracking WHERE company_name = %s{where}",
        p, default=0,
    )
    if not total:
        reason = "Awaiting offline CSV load — scripts/intel_loaders/load_upply.py"
        return _cache_put_and_return(key, {
            "window": window,
            "routes_benchmarked": _na(reason),
            "unique_users": _na(reason),
            "avg_routes_per_user": _na(reason),
            "routes_by_medium": _na(reason),
            "top_lanes": _na(reason),
            "benchmarks_trend_monthly": _na(reason),
            "source": "offline",
        })
    unique = _pg_scalar(
        f"SELECT COUNT(DISTINCT user_email) FROM public.intel_upply_tracking "
        f"WHERE company_name = %s{where}", p, default=0,
    )
    by_medium = [{"label": r[0] or "Unknown", "count": int(r[1])}
                 for r in _pg_rows(
                     f"SELECT medium, COUNT(*) FROM public.intel_upply_tracking "
                     f"WHERE company_name = %s{where} GROUP BY medium ORDER BY 2 DESC", p,
                 )]
    top_lanes = [{"origin": r[0], "destination": r[1], "count": int(r[2])}
                 for r in _pg_rows(
                     f"SELECT origin, destination, COUNT(*) FROM public.intel_upply_tracking "
                     f"WHERE company_name = %s{where} GROUP BY origin, destination "
                     f"ORDER BY 3 DESC LIMIT 10", p,
                 )]
    trend = [{"month": str(r[0])[:7], "count": int(r[1])}
             for r in _pg_rows(
                 f"SELECT DATE_TRUNC('month', request_date)::date, COUNT(*) "
                 f"FROM public.intel_upply_tracking WHERE company_name = %s{where} "
                 f"GROUP BY 1 ORDER BY 1", p,
             )]
    return _cache_put_and_return(key, {
        "window": window,
        "routes_benchmarked": int(total),
        "unique_users": int(unique or 0),
        "avg_routes_per_user": round(float(total) / unique, 1) if unique else 0.0,
        "routes_by_medium": by_medium,
        "top_lanes": top_lanes,
        "benchmarks_trend_monthly": trend,
        "source": "offline",
    })


# ============================================================
# SHEET 13 — Alerts (4 KPIs)
# Table readable, but ads_historical_dump has NO email/companyname
# column — only user_id. Account scoping not possible; returning
# portfolio-wide stats with a marker.
# ============================================================


def alerts_bundle(acct: str, window: str = "90d") -> dict:
    key = ("alerts", acct, window)
    if (c := _cache_get(key)) is not None:
        return c

    types = [
        {"label": str(r[0] or "Unknown"), "count": int(r[1] or 0)} for r in _rows(
            "SELECT message_sub_category, COUNT(*) "
            "FROM live_ai_incremental.ads_historical_dump "
            "GROUP BY message_sub_category ORDER BY 2 DESC LIMIT 20",
        )
    ]
    open_rate = _scalar(
        "SELECT SUM(CASE WHEN alert_opened ILIKE 'yes' OR alert_opened ILIKE 'true' "
        "THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*),0) "
        "FROM live_ai_incremental.ads_historical_dump",
        default=0.0,
    )
    by_category = [
        {"label": str(r[0] or "Unknown"), "open_rate_pct": round(float(r[1] or 0) * 100, 1)}
        for r in _rows(
            "SELECT sub_category_name, AVG(CASE WHEN alert_opened ILIKE 'yes' "
            "OR alert_opened ILIKE 'true' THEN 1.0 ELSE 0 END) "
            "FROM live_ai_incremental.ads_historical_dump "
            "GROUP BY sub_category_name ORDER BY 2 DESC LIMIT 20",
        )
    ]
    by_reachout = [
        {"label": str(r[0] or "Unknown"), "open_rate_pct": round(float(r[1] or 0) * 100, 1)}
        for r in _rows(
            "SELECT message_sub_category, AVG(CASE WHEN alert_opened ILIKE 'yes' "
            "OR alert_opened ILIKE 'true' THEN 1.0 ELSE 0 END) "
            "FROM live_ai_incremental.ads_historical_dump "
            "GROUP BY message_sub_category ORDER BY 2 DESC LIMIT 20",
        )
    ]

    return _cache_put_and_return(key, {
        "window": window,
        "_scope_note": "portfolio-wide — ads_historical_dump has no account key",
        "types_sent": types,
        "open_rate_pct": round(float(open_rate or 0) * 100, 1),
        "open_rate_by_category": by_category,
        "open_rate_by_reachout": by_reachout,
        "source": "redshift",
    })


# ============================================================
# SHEETS 14-15 — Platform Training / NPS — both OFFLINE
# ============================================================


def training_bundle(acct: str, window: str = "fy") -> dict:
    # Phase 3 — query public.intel_training_attendance.
    key = ("training", acct, window)
    if (c := _cache_get(key)) is not None:
        return c
    rs = _pg_rows(
        "SELECT SUM(users_attended), SUM(users_invited) FROM public.intel_training_attendance "
        "WHERE company_name = %s",
        (acct,),
    )
    attended, invited = (rs[0] if rs else (None, None))
    if attended is None:
        reason = "Awaiting offline CSV load — scripts/intel_loaders/load_training.py"
        return _cache_put_and_return(key, {
            "window": window,
            "users_attended": _na(reason),
            "users_attended_pct": _na(reason),
            "source": "offline",
        })
    pct = (float(attended) / float(invited)) * 100 if invited else None
    return _cache_put_and_return(key, {
        "window": window,
        "users_attended": int(attended or 0),
        "users_attended_pct": round(pct, 1) if pct is not None else None,
        "source": "offline",
    })


def nps_bundle(acct: str, window: str = "fy") -> dict:
    # Phase 3 — query public.intel_nps_scores. Uses the latest period.
    key = ("nps", acct, window)
    if (c := _cache_get(key)) is not None:
        return c
    rs = _pg_rows(
        "SELECT nps_score, report_period FROM public.intel_nps_scores "
        "WHERE company_name = %s ORDER BY report_period DESC LIMIT 1",
        (acct,),
    )
    if not rs:
        return _cache_put_and_return(key, {
            "window": window,
            "average_feedback_nps": _na(
                "Awaiting offline CSV load — scripts/intel_loaders/load_nps.py"
            ),
            "source": "offline",
        })
    score, period = rs[0]
    return _cache_put_and_return(key, {
        "window": window,
        "average_feedback_nps": float(score) if score is not None else None,
        "report_period": period.isoformat() if period else None,
        "source": "offline",
    })


# ============================================================
# SHEET 16 — Super Users (12 KPIs)
# Spec: tableau_schema.mt_table_user_level (missing). Substitute:
# activity_per_user (per-user rollup) + stg_user_session_log for
# last_login.
# ============================================================


def super_users_bundle(acct: str, top_n: int = 20) -> dict:
    key = ("super_users", acct, top_n)
    if (c := _cache_get(key)) is not None:
        return c

    rows = _rows(
        "SELECT email, logins, ci_report_downloads, pages_viewed, searches, "
        "mmd_actions, sm_supplieractions, queries, mmd_timeinseconds, "
        "sm_timeinseconds, sm_suppliers, total_value "
        "FROM tableau_schema.activity_per_user WHERE companyname = %s "
        "ORDER BY total_value DESC NULLS LAST LIMIT %s",
        (acct, top_n),
    )
    users = []
    for r in rows:
        (email, logins, downloads, pages, searches,
         mmd_actions, sm_actions, queries, mmd_secs, sm_secs, sm_suppliers, total) = r
        users.append({
            "email": email,
            "logins": int(logins or 0),
            "report_downloads": int(downloads or 0),
            "pages_viewed": int(pages or 0),
            "sd_searches": int(searches or 0),
            "mmd_actions": int(mmd_actions or 0),
            "supplier_actions": int(sm_actions or 0),
            "suppliers_added": int(sm_suppliers or 0),
            "abi_queries": int(queries or 0),
            "mmd_time_mins": round(float(mmd_secs or 0) / 60.0, 1),
            "sm_time_mins": round(float(sm_secs or 0) / 60.0, 1),
            "activity_score": int(total or 0),
        })

    total_logins = sum(u["logins"] for u in users) or 1
    login_distribution = [
        {"email": u["email"], "logins": u["logins"],
         "share_pct": round(u["logins"] / total_logins * 100, 1)}
        for u in sorted(users, key=lambda u: u["logins"], reverse=True)[:5]
    ]

    last_logins = {r[0]: r[1] for r in _rows(
        "SELECT s.email, MAX(s.sessionlogin) FROM tableau_schema.stg_user_session_log s "
        "JOIN tableau_schema.activity_per_user a ON a.email = s.email "
        "WHERE a.companyname = %s GROUP BY s.email",
        (acct,),
    )}
    for u in users:
        u["last_login"] = _date_iso(last_logins.get(u["email"]))

    # Total time per user (spec param 12) — sum of MMD + SM minutes from
    # the same activity_per_user row.
    for u in users:
        u["total_platform_mins"] = round(u["mmd_time_mins"] + u["sm_time_mins"], 1)

    return _cache_put_and_return(key, {
        "users": users,
        "top_n": top_n,
        "login_distribution_top5": login_distribution,
        "benchmark_per_user": _na("benchmark per-user fields not in activity_per_user"),
        "category_intelligence_per_user": _na("CI per-user time fields not in activity_per_user"),
        "source": "redshift",
    })


# Backwards-compatible alias (older route handler kept the name).
def benchmarks_bundle(acct: str, window: str = "90d") -> dict:
    """Spec source stg_benchmark is permission-denied — surfaced via
    `category_watch_bundle().benchmarks`. Kept for API back-compat."""
    return category_watch_bundle(acct, window)["benchmarks"] | {"window": window, "source": "redshift"}
