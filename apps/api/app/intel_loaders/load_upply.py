#!/usr/bin/env python
"""Load Upply_Tracking_Report → public.intel_upply_tracking.

Expected columns (case-insensitive, aliases work):
  CompanyName / company / customer            → company_name
  UserEmail / email                           → user_email
  Medium / medium  (AIR | OCEAN | ROADEMEA | ROADNA) → medium
  Origin                                      → origin
  Destination                                 → destination
  RequestDate / date                          → request_date

This loader appends — one row per request. Re-running the same file
will create duplicates; clear the table first if you want a clean
reload (truncate public.intel_upply_tracking).

Run:
  uv run python scripts/intel_loaders/load_upply.py path/to/upply.csv
"""

from __future__ import annotations

from pathlib import Path

from ._core import execute, parse_date, parser, read_rows

ALIASES = {
    "company_name": ("CompanyName", "company_name", "company", "Customer", "customer"),
    "user_email":   ("UserEmail", "user_email", "email", "Email"),
    "medium":       ("Medium", "medium", "Mode", "Transport"),
    "origin":       ("Origin", "origin", "From"),
    "destination":  ("Destination", "destination", "To"),
    "request_date": ("RequestDate", "request_date", "Date", "date"),
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
insert into public.intel_upply_tracking
  (company_name, user_email, medium, origin, destination, request_date)
values (%s, %s, %s, %s, %s, %s);
"""


def load(path: Path, *, dry_run: bool = False) -> int:
    """Parse + append into intel_upply_tracking. Returns rows inserted."""
    rows = read_rows(path)
    prepared = []
    for r in rows:
        company = pick(r, "company_name")
        if not company:
            continue
        prepared.append((
            str(company).strip(),
            str(pick(r, "user_email") or "").strip() or None,
            str(pick(r, "medium") or "").strip() or None,
            str(pick(r, "origin") or "").strip() or None,
            str(pick(r, "destination") or "").strip() or None,
            parse_date(pick(r, "request_date")),
        ))
    if dry_run:
        return len(prepared)
    return execute(SQL, prepared)


def main() -> None:
    args = parser(__doc__.splitlines()[0] if __doc__ else "upply loader").parse_args()
    n = load(args.file, dry_run=args.dry_run)
    verb = "would insert" if args.dry_run else "inserted"
    print(f"{verb} {n} rows into public.intel_upply_tracking")


if __name__ == "__main__":
    main()
