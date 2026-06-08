#!/usr/bin/env python
"""Load Cirtuo project tracker → public.intel_cirtuo_projects.

Two shapes supported, auto-detected:

  A. Pre-aggregated (legacy) — one row per (company, period):
       customer / company                          → company_name
       period / report_period / month              → report_period
       categories_supported / projects             → categories_supported
       feedback_received                           → feedback_received
       feedback_total / delivered                  → feedback_total
       feedback_score_avg / avg_feedback           → feedback_score_avg

  B. Per-project export (real Cirtuo CRM dump) — one row per project:
       "Company Name"                              → company_name
       "Closed Time" / "End Date" / "Resolved Time"→ used to bucket projects
                                                     into a report_period (YYYY-MM-01).
                                                     Closed Time wins; falls back in order.
       "Status" ∈ {Closed, Resolved}               → counted as "delivered"
                                                     (= feedback_received)
       Each row counted as one project             → categories_supported, feedback_total
       (no rating data in the per-project export)  → feedback_score_avg stays NULL

In shape B the loader aggregates internally so the upsert key
(company_name, report_period) stays one row per bucket. Internal /
self rows (Company Name in {"", "Cirtuo GmbH", "Beroe"}) are skipped.

Run:
  uv run python scripts/intel_loaders/load_cirtuo.py path/to/cirtuo.xls
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime
from pathlib import Path
from typing import Any

from _core import execute, parse_date, parse_int, parse_number, parser, read_rows

ALIASES = {
    "company_name": (
        "customer", "company", "company_name",
        "Customer", "Company Name",
    ),
    "report_period": (
        "period", "report_period", "month",
        "Period", "Month", "Date",
    ),
    "categories_supported": (
        "categories_supported", "categories", "projects", "Projects Executed",
    ),
    "feedback_received": ("feedback_received", "received", "Feedback Received"),
    "feedback_total": ("feedback_total", "delivered", "Total Delivered"),
    "feedback_score_avg": (
        "feedback_score_avg", "avg_feedback",
        "Average Feedback", "Avg Rating",
    ),
}

# Companies to drop from per-project aggregation (internal / vendor rows).
_INTERNAL_COMPANIES = {"", "cirtuo gmbh", "beroe"}

# Status values that mean "project delivered" (the feedback_received analogue).
_DELIVERED_STATUSES = {"closed", "resolved"}

# Date columns used to bucket projects into a month — first non-empty wins.
_DATE_COLS = ("Closed Time", "End Date", "Resolved Time", "Start Date")


def pick(row: dict, key: str) -> Any:
    for alias in ALIASES[key]:
        if alias in row and row[alias] not in (None, ""):
            return row[alias]
        for actual in row.keys():
            if actual.lower() == alias.lower() and row[actual] not in (None, ""):
                return row[actual]
    return None


def _first_month(row: dict) -> date | None:
    """Find the first non-empty date column and truncate to the first of the month."""
    for col in _DATE_COLS:
        v = row.get(col)
        if v in (None, ""):
            # case-insensitive fallback
            v = next(
                (row[k] for k in row if k.lower() == col.lower() and row[k] not in (None, "")),
                None,
            )
        if v in (None, ""):
            continue
        # xlrd cell-date conversion already gave us a datetime; CSVs give strings.
        if isinstance(v, datetime):
            return date(v.year, v.month, 1)
        if isinstance(v, date):
            return date(v.year, v.month, 1)
        # String — strip a "HH:MM:SS" suffix if present so parse_date() can match.
        s = str(v).strip()
        if " " in s:
            s = s.split(" ", 1)[0]
        d = parse_date(s)
        if d:
            return date(d.year, d.month, 1)
    return None


SQL = """
insert into public.intel_cirtuo_projects
  (company_name, report_period, categories_supported,
   feedback_received, feedback_total, feedback_score_avg)
values (%s, %s, %s, %s, %s, %s)
on conflict (company_name, report_period) do update set
  categories_supported = excluded.categories_supported,
  feedback_received    = excluded.feedback_received,
  feedback_total       = excluded.feedback_total,
  feedback_score_avg   = excluded.feedback_score_avg,
  loaded_at            = now();
"""


def _looks_per_project(sample_row: dict) -> bool:
    """Heuristic: per-project export carries 'Status' or 'Ticket Id', and the
    legacy alias columns (categories_supported / feedback_*) are absent."""
    keys_lower = {k.lower() for k in sample_row.keys()}
    has_project_markers = bool(
        keys_lower & {"status", "ticket id", "closed time", "end date"}
    )
    has_legacy_marker = bool(
        keys_lower & {
            "categories_supported", "feedback_received", "feedback_total",
            "projects executed", "feedback received", "total delivered",
        }
    )
    return has_project_markers and not has_legacy_marker


def _build_aggregated_prepared(rows: list[dict]) -> list[tuple]:
    """Shape A — one row per (company, period). Map columns directly."""
    out = []
    for r in rows:
        company = pick(r, "company_name")
        period = parse_date(pick(r, "report_period"))
        if not company or not period:
            continue
        out.append((
            str(company).strip(), period,
            parse_int(pick(r, "categories_supported")),
            parse_int(pick(r, "feedback_received")),
            parse_int(pick(r, "feedback_total")),
            parse_number(pick(r, "feedback_score_avg")),
        ))
    return out


def _build_per_project_prepared(rows: list[dict]) -> list[tuple]:
    """Shape B — per-project rows. Aggregate to (company, month). Skip internal
    Cirtuo / Beroe-self rows so the customer dashboard isn't polluted with
    internal QA tickets."""
    # {(company, month_date): [project_count, delivered_count]}
    buckets: dict[tuple[str, date], list[int]] = defaultdict(lambda: [0, 0])
    for r in rows:
        company = str(r.get("Company Name") or "").strip()
        if not company or company.lower() in _INTERNAL_COMPANIES:
            continue
        bucket_month = _first_month(r)
        if not bucket_month:
            continue
        delivered = str(r.get("Status") or "").strip().lower() in _DELIVERED_STATUSES
        key = (company, bucket_month)
        buckets[key][0] += 1
        if delivered:
            buckets[key][1] += 1
    return [
        (company, period, projects, delivered, projects, None)
        for (company, period), (projects, delivered) in buckets.items()
    ]


def load(path: Path, *, dry_run: bool = False) -> int:
    """Parse + upsert into intel_cirtuo_projects. Returns rows upserted."""
    rows = read_rows(path)
    if not rows:
        return 0
    if _looks_per_project(rows[0]):
        prepared = _build_per_project_prepared(rows)
    else:
        prepared = _build_aggregated_prepared(rows)
    if dry_run:
        return len(prepared)
    return execute(SQL, prepared)


def main() -> None:
    args = parser(__doc__.splitlines()[0] if __doc__ else "cirtuo loader").parse_args()
    n = load(args.file, dry_run=args.dry_run)
    verb = "would upsert" if args.dry_run else "upserted"
    print(f"{verb} {n} rows into public.intel_cirtuo_projects")


if __name__ == "__main__":
    main()
