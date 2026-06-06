"""Shared utilities for the offline-source loaders.

Each loader reads a CSV/XLSX → normalises columns → upserts into the
matching public.intel_* table. Loaders are run from the repo root:

    uv run python scripts/intel_loaders/load_nnamu.py path/to/nnamu.xlsx

The DSN is read from apps/api/.env (DATABASE_URL). Loaders accept
--dry-run to validate parse + show row counts without writing.
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

REPO_ROOT = Path(__file__).resolve().parents[2]
API_ENV = REPO_ROOT / "apps" / "api" / ".env"


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
    if suffix in (".xlsx", ".xls"):
        try:
            import openpyxl  # local to keep core lean
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
    sys.exit(f"ERR: unsupported file type {suffix}; use .csv or .xlsx")


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
