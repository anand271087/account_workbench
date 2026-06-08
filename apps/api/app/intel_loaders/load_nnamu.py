#!/usr/bin/env python
"""Load nnamu Savings Report → public.intel_nnamu_savings.

Expected columns (case-insensitive, any of these aliases works):
  company / customer / Company Name           → company_name
  period / report_period / month / date       → report_period (YYYY-MM-01)
  initial / initial_comparison_price          → initial_comparison_price
  final / final_comparison_price              → final_comparison_price
  savings / absolute_savings                  → absolute_savings (optional; derived)
  savings_pct / Savings %                     → savings_pct (optional; derived)

Run:
  uv run python scripts/intel_loaders/load_nnamu.py path/to/nnamu.xlsx
  uv run python scripts/intel_loaders/load_nnamu.py path/to/nnamu.csv --dry-run
"""

from __future__ import annotations

from pathlib import Path

from ._core import execute, parse_date, parse_number, parser, read_rows

COMPANY_KEYS = ("company_name", "company", "customer", "Customer", "Company Name", "CompanyName")
PERIOD_KEYS = ("report_period", "period", "month", "date", "Date", "Period")
INITIAL_KEYS = ("initial_comparison_price", "initial", "Initial Comparison Price", "Initial Price")
FINAL_KEYS = ("final_comparison_price", "final", "Final Comparison Price", "Final Price")
SAVINGS_KEYS = ("absolute_savings", "savings", "Absolute Savings", "Savings (EUR)")
PCT_KEYS = ("savings_pct", "Savings %", "Savings Pct")


def pick(row: dict, keys: tuple[str, ...]):
    for k in keys:
        if k in row and row[k] not in (None, ""):
            return row[k]
        # case-insensitive scan
        for actual in row.keys():
            if actual.lower() == k.lower() and row[actual] not in (None, ""):
                return row[actual]
    return None


SQL = """
insert into public.intel_nnamu_savings
  (company_name, report_period, initial_comparison_price,
   final_comparison_price, absolute_savings, savings_pct)
values (%s, %s, %s, %s, %s, %s)
on conflict (company_name, report_period) do update set
  initial_comparison_price = excluded.initial_comparison_price,
  final_comparison_price   = excluded.final_comparison_price,
  absolute_savings         = excluded.absolute_savings,
  savings_pct              = excluded.savings_pct,
  loaded_at                = now();
"""


def load(path: Path, *, dry_run: bool = False) -> int:
    """Parse the file at *path* and upsert into intel_nnamu_savings.

    Returns the number of rows upserted (or — when dry_run=True —
    the number of rows that WOULD have been upserted). 0 means nothing
    parseable was found.
    """
    rows = read_rows(path)
    if not rows:
        return 0
    prepared = []
    for r in rows:
        company = pick(r, COMPANY_KEYS)
        period = parse_date(pick(r, PERIOD_KEYS))
        if not company or not period:
            continue
        initial = parse_number(pick(r, INITIAL_KEYS))
        final = parse_number(pick(r, FINAL_KEYS))
        abs_s = parse_number(pick(r, SAVINGS_KEYS))
        if abs_s is None and initial is not None and final is not None:
            abs_s = initial - final
        pct = parse_number(pick(r, PCT_KEYS))
        if pct is None and initial and abs_s is not None:
            pct = abs_s / initial * 100
        prepared.append((str(company).strip(), period, initial, final, abs_s, pct))

    if dry_run:
        return len(prepared)
    return execute(SQL, prepared)


def main() -> None:
    args = parser(__doc__.splitlines()[0] if __doc__ else "nnamu loader").parse_args()
    n = load(args.file, dry_run=args.dry_run)
    verb = "would upsert" if args.dry_run else "upserted"
    print(f"{verb} {n} rows into public.intel_nnamu_savings")


if __name__ == "__main__":
    main()
