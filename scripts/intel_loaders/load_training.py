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


def main() -> None:
    args = parser(__doc__.splitlines()[0] if __doc__ else "training loader").parse_args()
    rows = read_rows(args.file)
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
    print(f"parsed {len(prepared)} rows (of {len(rows)} total)")
    if args.dry_run:
        for r in prepared[:5]: print(" ", r)
        return
    n = execute(SQL, prepared)
    print(f"upserted {n} rows into public.intel_training_attendance")


if __name__ == "__main__":
    main()
