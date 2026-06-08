"""Shared utilities for the offline-source loaders.

Each loader reads a CSV/XLSX → normalises columns → upserts into the
matching public.intel_* table. The loaders are used two ways:

1. Imported by app.routes.intel_upload to handle in-app uploads from
   the Intelligence & Reports tab (Option C). DATABASE_URL comes from
   the live process env (Render injects it).
2. Run as CLIs from the host:
       uv run python -m app.intel_loaders.load_nnamu path/to/file.xlsx
   In that case load_env() pulls DATABASE_URL out of apps/api/.env.

Loaders accept --dry-run to validate parse + show row counts without
writing.
"""

from __future__ import annotations

import argparse
import csv
import os
import sys
from collections.abc import Iterable
from datetime import date, datetime
from pathlib import Path
from typing import Any

# File lives at apps/api/app/intel_loaders/_core.py. parents[2] = apps/api,
# where the .env file sits for the CLI case. Inside the container env vars
# come from the process environment, so the .env file won't exist there
# and load_env() early-returns harmlessly.
API_ENV = Path(__file__).resolve().parents[2] / ".env"


def load_env() -> None:
    """Populate os.environ from apps/api/.env if vars aren't already set."""
    if not API_ENV.exists():
        return
    for line in API_ENV.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def pg_dsn() -> str:
    load_env()
    url = os.environ.get("DATABASE_URL", "")
    if url.startswith("postgresql+asyncpg://"):
        url = url.replace("postgresql+asyncpg://", "postgresql://")
    if not url:
        sys.exit("ERR: DATABASE_URL not set in apps/api/.env")
    return url


def read_rows(path: Path) -> list[dict]:
    """Read a CSV or XLSX into a list of dicts. Header row is required."""
    suffix = path.suffix.lower()
    if suffix == ".csv":
        with path.open(newline="", encoding="utf-8-sig") as f:
            return list(csv.DictReader(f))
    if suffix == ".xlsx":
        try:
            import openpyxl
        except ImportError:
            sys.exit("ERR: install openpyxl (uv add openpyxl) for xlsx loaders")
        wb = openpyxl.load_workbook(path, data_only=True)
        ws = wb.active
        if ws is None:
            sys.exit("ERR: workbook has no active sheet")
        rows_iter: Iterable[Any] = ws.iter_rows(values_only=True)
        header = list(next(rows_iter))
        out: list[dict] = []
        for row in rows_iter:
            if all(c is None for c in row):
                continue
            out.append({str(header[i]).strip() if header[i] else f"col{i}": row[i]
                        for i in range(len(header))})
        return out
    if suffix == ".xls":
        # Legacy binary .xls — openpyxl can't read it; use xlrd (which since
        # 2.0 supports ONLY .xls, having dropped .xlsx). Cirtuo + a few other
        # vendor exports still arrive in this format.
        try:
            import xlrd
        except ImportError:
            sys.exit("ERR: install xlrd (uv add xlrd) for .xls loaders")
        book = xlrd.open_workbook(str(path))
        sheet = book.sheet_by_index(0)
        if sheet.nrows == 0:
            return []
        header = [str(sheet.cell_value(0, c)).strip() or f"col{c}"
                  for c in range(sheet.ncols)]
        out2: list[dict] = []
        for r in range(1, sheet.nrows):
            row_vals = [sheet.cell_value(r, c) for c in range(sheet.ncols)]
            # Excel dates come back as floats; convert via xlrd's date helper
            # so downstream parse_date() sees an actual datetime.
            for c in range(sheet.ncols):
                if sheet.cell_type(r, c) == xlrd.XL_CELL_DATE:
                    try:
                        tup = xlrd.xldate_as_tuple(row_vals[c], book.datemode)
                        row_vals[c] = datetime(*tup)
                    except Exception:  # noqa: BLE001
                        pass
            if all(v in (None, "") for v in row_vals):
                continue
            out2.append({header[c]: row_vals[c] for c in range(sheet.ncols)})
        return out2
    sys.exit(f"ERR: unsupported file type {suffix}; use .csv, .xlsx, or .xls")


def parse_date(v: Any) -> date | None:
    if v is None or v == "":
        return None
    if isinstance(v, date) and not isinstance(v, datetime):
        return v
    if isinstance(v, datetime):
        return v.date()
    s = str(v).strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y", "%d-%m-%Y", "%d %b %Y", "%b %Y", "%Y-%m"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def parse_number(v: Any) -> float | None:
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace(",", "").replace("€", "").replace("$", "")
    if s.endswith("%"):
        s = s[:-1]
    try:
        return float(s)
    except ValueError:
        return None


def parse_int(v: Any) -> int | None:
    n = parse_number(v)
    return int(n) if n is not None else None


def parser(description: str) -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=description)
    p.add_argument("file", type=Path, help="CSV or XLSX to load")
    p.add_argument("--dry-run", action="store_true", help="Parse but don't write")
    return p


def execute(sql: str, rows: list[tuple]) -> int:
    """Run an executemany against the configured DSN."""
    import psycopg
    with psycopg.connect(pg_dsn(), autocommit=False) as conn:
        with conn.cursor() as cur:
            cur.executemany(sql, rows)
            n = cur.rowcount
        conn.commit()
    return n
