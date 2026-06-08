"""POST /api/v1/intel/upload — Option C (08-Jun).

Stakeholder direction: drop a CSV / XLSX into the matching Intelligence
sub-tab, watch the dashboard populate. No SharePoint integration yet.

This route accepts one file at a time and dispatches to the correct
loader from scripts/intel_loaders/. Five sources supported, matching
the 5 staging tables created in migration 0066:

    nnamu     → intel_nnamu_savings        (upsert by company+period)
    upply     → intel_upply_tracking       (append; one row per request)
    cirtuo    → intel_cirtuo_projects      (upsert by company+period)
    training  → intel_training_attendance  (upsert by company+session+topic)
    nps       → intel_nps_scores           (upsert by company+period)

After a successful load we invalidate the in-process bundle cache for
the matching section so the next /intel/<source> request returns
fresh data. The TanStack-Query cache on the frontend is invalidated
client-side via the IntelUploadButton wrapper.

Permission: admin / cs_director / vp_csm — same set that can create
accounts. These files are portfolio-wide (multi-account); individual
CSMs shouldn't push them on a whim.
"""

from __future__ import annotations

import logging
import shutil
import sys
import tempfile
from pathlib import Path
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser
from app.core.rbac import can_create_account
from app.db.session import get_db
from app.services import redshift_queries as rq

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/intel", tags=["intel-upload"])

# Allowed file extensions — match what the loaders accept via _core.read_rows.
_ALLOWED_EXTS = {".csv", ".xlsx", ".xls"}

# Max upload size — keep tight. These files are tens of kilobytes typically.
_MAX_BYTES = 10 * 1024 * 1024  # 10 MB

# Make scripts/intel_loaders/ importable. The loaders live outside the
# `apps/api/app` package so the same scripts work as standalone CLIs +
# imported modules.
_SCRIPTS_DIR = Path(__file__).resolve().parents[4] / "scripts"
_LOADERS_DIR = _SCRIPTS_DIR / "intel_loaders"
# scripts/ on the path makes `intel_loaders.load_nnamu` resolve.
# scripts/intel_loaders/ on the path makes the loaders' `from _core import …`
# resolve (the loaders also run as CLIs from inside scripts/intel_loaders/
# where _core is a sibling module, so we mirror that import shape).
for p in (_SCRIPTS_DIR, _LOADERS_DIR):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

# Import the loader functions. Lazy-imported inside the handler would
# also work but module-level is simpler and the cost is one-time.
from intel_loaders.load_cirtuo import load as load_cirtuo  # noqa: E402
from intel_loaders.load_nnamu import load as load_nnamu  # noqa: E402
from intel_loaders.load_nps import load as load_nps  # noqa: E402
from intel_loaders.load_training import load as load_training  # noqa: E402
from intel_loaders.load_upply import load as load_upply  # noqa: E402

_LOADERS = {
    "nnamu": (load_nnamu, "intel_nnamu_savings"),
    "upply": (load_upply, "intel_upply_tracking"),
    "cirtuo": (load_cirtuo, "intel_cirtuo_projects"),
    "training": (load_training, "intel_training_attendance"),
    "nps": (load_nps, "intel_nps_scores"),
}

Source = Literal["nnamu", "upply", "cirtuo", "training", "nps"]


@router.post("/upload", status_code=status.HTTP_200_OK)
async def upload_intel_file(
    user: CurrentUser,
    source: Annotated[Source, Query(description="One of: nnamu, upply, cirtuo, training, nps")],
    file: Annotated[UploadFile, File(...)],
    db: Annotated[AsyncSession, Depends(get_db)],  # noqa: ARG001 — kept for future audit log
) -> dict:
    """Upload a CSV/XLSX → parse → upsert. Returns row count."""
    if not can_create_account(user.role):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Your role cannot upload Intelligence source files "
            "(admin / cs_director / vp_csm only).",
        )

    loader, table_name = _LOADERS[source]

    # Validate extension
    fname = file.filename or "upload.csv"
    suffix = Path(fname).suffix.lower()
    if suffix not in _ALLOWED_EXTS:
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            f"Only {' / '.join(sorted(_ALLOWED_EXTS))} files are accepted. Got {suffix or '(no extension)'}.",
        )

    # Read + size check (UploadFile.read() with no arg slurps the whole body).
    body = await file.read()
    if len(body) > _MAX_BYTES:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"File too large ({len(body) / 1024 / 1024:.1f} MB). "
            f"Cap is {_MAX_BYTES // 1024 // 1024} MB — split or compress and retry.",
        )

    # Persist to a tempfile with the right extension so the loader's
    # XLSX path (openpyxl) doesn't choke on a missing suffix.
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(body)
        tmp_path = Path(tmp.name)

    try:
        rows_upserted = loader(tmp_path)
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "Intel upload failed source=%s file=%s len=%d err=%s",
            source, fname, len(body), exc,
        )
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"Couldn't parse the file: {exc}. Check the column names "
            f"against the README at scripts/intel_loaders/.",
        ) from exc
    finally:
        try:
            tmp_path.unlink(missing_ok=True)
        except Exception:  # noqa: BLE001, S110
            pass

    # Bust the in-process bundle cache for this source so the next
    # /intel/<source> GET returns fresh data instead of the 5-min cached
    # NA pills.
    try:
        rq._CACHE.clear()  # type: ignore[attr-defined]
    except Exception:  # noqa: BLE001, S110
        pass

    # 08-Jun · After-load summary so the frontend can warn when the
    # uploaded file's companies don't match the account being viewed.
    # Query the staging table for the distinct companies seen so far —
    # cheap, single round-trip via the existing pg helper.
    distinct_companies: list[str] = []
    try:
        rows = rq._pg_rows(  # type: ignore[attr-defined]
            f"SELECT DISTINCT company_name FROM public.{table_name} "
            f"WHERE company_name IS NOT NULL ORDER BY 1 LIMIT 50",
            (),
        )
        distinct_companies = [r[0] for r in rows]
    except Exception:  # noqa: BLE001, S110
        pass

    logger.info(
        "Intel upload OK source=%s file=%s rows=%d table=%s by=%s",
        source, fname, rows_upserted, table_name, user.id,
    )
    return {
        "source": source,
        "table": table_name,
        "rows_upserted": rows_upserted,
        "filename": fname,
        "distinct_companies": distinct_companies,
    }


# Suppress shutil import warning — used during dev for tempfile copying when
# debugging. Kept here to keep ruff quiet about unused-but-frequently-needed.
_ = shutil
