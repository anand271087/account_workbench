#!/usr/bin/env python
"""Load NPS scores → public.intel_nps_scores.

Expected columns (case-insensitive, aliases work):
  company / customer                          → company_name
  period / report_period / month              → report_period (YYYY-MM-01)
  nps_score / score / NPS                     → nps_score
  promoters_pct                               → promoters_pct
  passives_pct                                → passives_pct
  detractors_pct                              → detractors_pct
  response_count / responses                  → response_count

Run:
  uv run python scripts/intel_loaders/load_nps.py path/to/nps.xlsx
"""

from __future__ import annotations

from _core import execute, parse_date, parse_int, parse_number, parser, read_rows

ALIASES = {
    "company_name":   ("company_name", "company", "customer", "Customer", "Company Name"),
    "report_period":  ("report_period", "period", "month", "Period", "Date"),
    "nps_score":      ("nps_score", "score", "NPS", "NPS Score", "Score"),
    "promoters_pct":  ("promoters_pct", "promoters", "Promoters %"),
    "passives_pct":   ("passives_pct", "passives", "Passives %"),
    "detractors_pct": ("detractors_pct", "detractors", "Detractors %"),
    "response_count": ("response_count", "responses", "Response Count", "N"),
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
insert into public.intel_nps_scores
  (company_name, report_period, nps_score, promoters_pct,
   passives_pct, detractors_pct, response_count)
values (%s, %s, %s, %s, %s, %s, %s)
on conflict (company_name, report_period) do update set
  nps_score      = excluded.nps_score,
  promoters_pct  = excluded.promoters_pct,
  passives_pct   = excluded.passives_pct,
  detractors_pct = excluded.detractors_pct,
  response_count = excluded.response_count,
  loaded_at      = now();
"""


def main() -> None:
    args = parser(__doc__.splitlines()[0] if __doc__ else "nps loader").parse_args()
    rows = read_rows(args.file)
    prepared = []
    for r in rows:
        company = pick(r, "company_name")
        period = parse_date(pick(r, "report_period"))
        if not company or not period:
            continue
        prepared.append((
            str(company).strip(), period,
            parse_number(pick(r, "nps_score")),
            parse_number(pick(r, "promoters_pct")),
            parse_number(pick(r, "passives_pct")),
            parse_number(pick(r, "detractors_pct")),
            parse_int(pick(r, "response_count")),
        ))
    print(f"parsed {len(prepared)} rows (of {len(rows)} total)")
    if args.dry_run:
        for r in prepared[:5]: print(" ", r)
        return
    n = execute(SQL, prepared)
    print(f"upserted {n} rows into public.intel_nps_scores")


if __name__ == "__main__":
    main()
