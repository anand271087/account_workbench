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
  live_ai_incremental.thoughtleadershipreportview  (stg_thoughtleadership substitute)
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

from app.core.redshift import get_connection

logger = logging.getLogger(__name__)


# ============================================================
# In-process TTL cache (per worker). 5-minute TTL matches the per-tab
# refresh expectation; clears between deploys.
# ============================================================
_CACHE: dict[tuple, tuple[float, Any]] = {}
_CACHE_TTL = 300.0


def _cache_get(key: tuple) -> Any | None:
    hit = _CACHE.get(key)
    if not hit:
        return None
    when, value = hit
    if (time.time() - when) > _CACHE_TTL:
        _CACHE.pop(key, None)
        return None
    return value


def _cache_put_and_return(key: tuple, value: Any) -> Any:
    _CACHE[key] = (time.time(), value)
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
# ============================================================


def _scalar(sql: str, params: tuple = (), default: Any = None) -> Any:
    conn = None
    try:
        conn = get_connection()
        cur = conn.cursor()
        cur.execute(sql, params)
        row = cur.fetchone()
        cur.close()
        return row[0] if row and row[0] is not None else default
    except Exception as exc:  # noqa: BLE001
        logger.warning("redshift scalar failed: %s — %s", sql[:120].replace("\n", " "), exc)
        return default
    finally:
        if conn:
            try: conn.close()
            except Exception: pass  # noqa: BLE001


def _rows(sql: str, params: tuple = ()) -> list[tuple]:
    conn = None
    try:
        conn = get_connection()
        cur = conn.cursor()
        cur.execute(sql, params)
        rs = cur.fetchall()
        cur.close()
        return rs or []
    except Exception as exc:  # noqa: BLE001
        logger.warning("redshift rows failed: %s — %s", sql[:120].replace("\n", " "), exc)
        return []
    finally:
        if conn:
            try: conn.close()
            except Exception: pass  # noqa: BLE001


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
        "suppliers_added": _na("stg_user_cat_sup_report permission denied"),
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

    cat_intel: dict[str, Any] = {
        "categories_unlocked": _na("stg_user_cat_sup_report permission denied"),
        "avg_categories_per_user": _na("stg_user_cat_sup_report permission denied"),
        "categories_added_monthly_trend": _na("stg_user_cat_sup_report permission denied"),
        "categories_newly_added_period": _na("stg_user_cat_sup_report permission denied"),
        "category_type_breakdown": _na("category→type mapping not in source"),
        "category_visits": _na("stg_categoryview_reporttype does not exist"),
        "category_revisit_pct": _na("stg_categoryview_reporttype does not exist"),
        "report_downloads_total": _na("stg_categorydownloaded_reporttype does not exist"),
        "report_views_total": _na("stg_categoryview_reporttype does not exist"),
        "top_report_views": _na("stg_categoryview_reporttype does not exist"),
        "top_report_downloads": _na("stg_categorydownloaded_reporttype does not exist"),
        "reports_downloaded_monthly_trend": _na("stg_categorydownloaded_reporttype does not exist"),
        "added_categories_detail": _na("stg_user_cat_sup_report permission denied"),
        "spend_pool_top_n": _na("stg_categoryview_reporttype does not exist"),
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

    benchmarks: dict[str, Any] = {
        "total_benchmark_responses": _na("stg_benchmark permission denied"),
        "total_subscribers_responded": _na("stg_benchmark permission denied"),
        "benchmark_question_categories": _na("stg_benchmark permission denied"),
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

    return _cache_put_and_return(key, {
        "window": window,
        "users": int(users or 0),
        "total_searches": int(searches or 0),
        "avg_searches_per_user": round(avg_per_user, 1),
        "total_visits": int(visits or 0),
        "total_time_mins": round(float(time_mins or 0), 1),
        "top_categories_searched": top_categories,
        "repeat_users_pct": round(float(repeat_pct or 0) * 100, 1),
        "top_regions_scoped": _na("forestreet_usage_table.countrydropdown not in substitute"),
        "categories_pct_split": _na("forestreet_usage_table.inside_outside_flag not in substitute"),
        "suppliers_shortlisted_avg": _na("result-count per search not captured anywhere"),
        "sd_downloads": _na("forestreet_usage_table.downloadshortlist not in substitute"),
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

    time_mins = _scalar(
        "SELECT SUM(s.totaltimespent_sec)/60.0 FROM tableau_schema.stg_user_session_log s "
        "JOIN tableau_schema.activity_per_user a ON a.email = s.email "
        "WHERE a.companyname = %s AND s.module ILIKE '%supplier%'",
        (acct,),
    )

    return _cache_put_and_return(key, {
        "window": window,
        "total_time_mins": round(float(time_mins or 0), 1),
        "suppliers_monitored": _na("stg_user_cat_sup_report permission denied"),
        "suppliers_by_risk_level": _na("stg_user_cat_sup_report permission denied"),
        "new_suppliers_in_period": _na("stg_user_cat_sup_report permission denied"),
        "users_adding_suppliers": _na("stg_user_cat_sup_report permission denied"),
        "mom_trend_suppliers_added": _na("stg_user_cat_sup_report permission denied"),
        "data_refreshes_last_30d": _na("stg_user_cat_sup_report permission denied"),
        "suppliers_added_vs_contracted_pct": _na("offline — contracted slots not in Redshift"),
        "usage_vs_runway": _na("offline — contract runway not in Redshift"),
        "suppliers_added_list": _na("stg_user_cat_sup_report permission denied"),
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
# Spec: stg_thoughtleadership (permission denied). Substitute:
# live_ai_incremental.thoughtleadershipreportview (joined via
# activity_per_user for account scoping).
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
            f"SELECT COUNT(*) FROM live_ai_incremental.thoughtleadershipreportview t "
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
            f"SELECT t.tltype, COUNT(*) FROM live_ai_incremental.thoughtleadershipreportview t "
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
    return {
        "window": window,
        "data_pulls": _na("datahub_category_merged permission denied (live_ai schema)"),
        "source": "redshift",
    }


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
        "top_pages": _na("stg_piwik_cirtuoreport permission denied"),
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
