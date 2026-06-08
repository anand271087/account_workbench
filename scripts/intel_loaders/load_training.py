#!/usr/bin/env python
"""Load Platform Training attendance → public.intel_training_attendance.

Expected columns (case-insensitive, aliases work):
  company / customer                          → company_name
  session_date / date                         → session_date
  topic / title                               → topic (default 'General')
  users_attended / attended                   → users_attended
  users_invited / invited / total             → users_invited

Run:
  uv run python scripts/intel_loaders/load_training.py path/to/training.xlsx
"""

from __future__ import annotations

from pathlib import Path

from _core import execute, parse_date, parse_int, parser, read_rows

ALIASES = {
    "company_name": ("company_name", "company", "customer", "Customer"),
    "session_date": ("session_date", "date", "Date", "Training Date"),
    "topic":        ("topic", "title", "Topic", "Training Topic"),
    "users_attended": ("users_attended", "attended", "Attendees"),
    "users_invited": ("users_invited", "invited", "Total Users", "Licensed Users"),
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
insert into public.intel_training_attendance
  (company_name, session_date, topic, users_attended, users_invited)
values (%s, %s, %s, %s, %s)
on conflict (company_name, session_date, topic) do update set
  users_attended = excluded.users_attended,
  users_invited  = excluded.users_invited,
  loaded_at      = now();
"""


def load(path: Path, *, dry_run: bool = False) -> int:
    """Parse + upsert into intel_training_attendance. Returns rows upserted."""
    rows = read_rows(path)
    prepared = []
    for r in rows:
        company = pick(r, "company_name")
        sdate = parse_date(pick(r, "session_date"))
        if not company or not sdate:
            continue
        prepared.append((
            str(company).strip(), sdate,
            str(pick(r, "topic") or "General").strip(),
            parse_int(pick(r, "users_attended")),
            parse_int(pick(r, "users_invited")),
        ))
    if dry_run:
        return len(prepared)
    return execute(SQL, prepared)


def main() -> None:
    args = parser(__doc__.splitlines()[0] if __doc__ else "training loader").parse_args()
    n = load(args.file, dry_run=args.dry_run)
    verb = "would upsert" if args.dry_run else "upserted"
    print(f"{verb} {n} rows into public.intel_training_attendance")


if __name__ == "__main__":
    main()
