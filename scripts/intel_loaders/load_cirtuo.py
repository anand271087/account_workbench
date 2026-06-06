#!/usr/bin/env python
"""Load Cirtuo project tracker → public.intel_cirtuo_projects.

Expected columns (case-insensitive, aliases work):
  customer / company                          → company_name
  period / report_period / month              → report_period (YYYY-MM-01)
  categories_supported / projects             → categories_supported
  feedback_received                           → feedback_received
  feedback_total / delivered                  → feedback_total
  feedback_score_avg / avg_feedback           → feedback_score_avg

Run:
  uv run python scripts/intel_loaders/load_cirtuo.py path/to/cirtuo.xlsx
"""

from __future__ import annotations

from _core import execute, parse_date, parse_number, parse_int, parser, read_rows

ALIASES = {
    "company_name": ("customer", "company", "company_name", "Customer", "Company Name"),
    "report_period": ("period", "report_period", "month", "Period", "Month", "Date"),
    "categories_supported": ("categories_supported", "categories", "projects", "Projects Executed"),
    "feedback_received": ("feedback_received", "received", "Feedback Received"),
    "feedback_total": ("feedback_total", "delivered", "Total Delivered"),
    "feedback_score_avg": ("feedback_score_avg", "avg_feedback", "Average Feedback", "Avg Rating"),
}


def pick(row: dict, key: str):
    for alias in ALIASES[key]:
        if alias in row and row[alias] not in (None, ""):
            return row[alias]
        for actual in row.keys():
            if actual.lower() == alias.lower() and row[actual] not in (None, ""):
                return row[actual]
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


def main() -> None:
    args = parser(__doc__.splitlines()[0] if __doc__ else "cirtuo loader").parse_args()
    rows = read_rows(args.file)
    prepared = []
    for r in rows:
        company = pick(r, "company_name")
        period = parse_date(pick(r, "report_period"))
        if not company or not period:
            continue
        prepared.append((
            str(company).strip(), period,
            parse_int(pick(r, "categories_supported")),
            parse_int(pick(r, "feedback_received")),
            parse_int(pick(r, "feedback_total")),
            parse_number(pick(r, "feedback_score_avg")),
        ))
    print(f"parsed {len(prepared)} rows (of {len(rows)} total)")
    if args.dry_run:
        for r in prepared[:5]: print(" ", r)
        return
    n = execute(SQL, prepared)
    print(f"upserted {n} rows into public.intel_cirtuo_projects")


if __name__ == "__main__":
    main()
