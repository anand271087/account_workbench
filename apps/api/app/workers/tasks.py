"""Celery tasks for AK03.c.

Single task: `process_document(job_id)`. End-to-end:
  1) load Job + Document
  2) mark job running, doc ai_status='processing'
  3) download bytes from Supabase Storage
  4) extract text (docx/pdf/txt/vtt)
  5) Claude per-doc summary → write doc.ai_summary_text + extracted_entities
  6) regenerate aggregate Sales Discovery summary for the account
  7) mark job complete

Errors become job.status='failed' with the exception message in job.error
and doc.ai_status='failed' so the UI can show a retry button. We log but
never raise out — Celery would otherwise retry forever and rack up bills.

The task is sync (Celery's natural mode); we use asyncio.run() to drive
the existing async SQLAlchemy + Supabase clients.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select

from app.db.session import new_worker_engine, new_worker_session
from app.models.document import AccountDiscoverySummary, Document, Job
from app.services import files as storage_svc
from app.services.claude import (
    aggregate_account_summary,
    extract_vpd_fields,
    summarise_document,
)
from app.services.extract import ExtractError, extract_text
from app.services.extract_mom import extract_from_mom
from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="process_document", bind=True, max_retries=2)
def process_document(self, job_id: str) -> dict:  # noqa: ANN001
    """Synchronous Celery entry point. Drives the async pipeline."""
    try:
        return asyncio.run(_process(UUID(job_id)))
    except Exception as exc:  # noqa: BLE001 — final boundary; never re-raise
        logger.exception("process_document failed for %s", job_id)
        # Persist the failure so the API can show it.
        try:
            asyncio.run(_mark_failed(UUID(job_id), str(exc)))
        except Exception:
            logger.exception("Could not record failure for job %s", job_id)
        return {"ok": False, "error": str(exc)}


async def _process(job_id: UUID) -> dict:
    # Fresh engine per task — prevents "Future attached to a different loop"
    # under Celery prefork (asyncio.run creates a new loop each call).
    eng = new_worker_engine()
    Session = new_worker_session(eng)
    async with Session() as db:
        job = (await db.execute(select(Job).where(Job.id == job_id))).scalar_one_or_none()
        if job is None:
            return {"ok": False, "error": f"Job {job_id} not found"}
        if job.document_id is None:
            await _mark_failed_db(db, job, "Job has no document_id")
            return {"ok": False, "error": "Job has no document_id"}

        doc = (
            await db.execute(select(Document).where(Document.id == job.document_id))
        ).scalar_one_or_none()
        if doc is None:
            await _mark_failed_db(db, job, "Document not found")
            return {"ok": False, "error": "Document not found"}

        # mark running
        job.status = "running"
        job.progress = 5
        job.started_at = datetime.now(timezone.utc)
        doc.ai_status = "processing"
        await db.commit()

        # download from Supabase Storage
        try:
            bucket, _, key = doc.storage_path.partition("/")
            raw = storage_svc.download_bytes(bucket, key)
        except Exception as exc:  # noqa: BLE001
            await _mark_failed_db(db, job, f"Storage download failed: {exc}")
            doc.ai_status = "failed"
            await db.commit()
            return {"ok": False, "error": str(exc)}

        # extract text
        try:
            text = extract_text(doc.filename, doc.mime_type, raw)
        except ExtractError as exc:
            await _mark_failed_db(db, job, str(exc))
            doc.ai_status = "failed"
            await db.commit()
            return {"ok": False, "error": str(exc)}

        job.progress = 35
        await db.commit()

        # per-doc summary via Claude (or stub)
        result = summarise_document(text, doc.kind)
        doc.ai_summary_text = result.get("summary") or ""
        doc.extracted_entities = {
            "people": result.get("people", []),
            "decisions": result.get("decisions", []),
            "action_items": result.get("action_items", []),
            "dates": result.get("dates", []),
            "is_stub": result.get("is_stub", True),
        }
        doc.ai_status = "complete"
        job.progress = 75
        await db.commit()

        # VPD-only: pull structured Solutioning candidates and persist them
        # on the document row. The frontend polling loop picks this up and
        # one-shot applies the values as a dirty draft on the Solutioning
        # form — user reviews, then clicks Save.
        if doc.kind == "vpd":
            try:
                vpd_extracted = extract_vpd_fields(text)
                doc.vpd_extracted_fields = vpd_extracted
                doc.vpd_extracted_at = datetime.now(timezone.utc)
                await db.commit()
            except Exception:
                logger.exception("VPD field extraction failed (non-fatal)")

        # MoM-only: extract structured fields (engagement / brief / contacts)
        # and persist on the document row. The frontend polling loop picks
        # this up and one-shot applies it as a dirty draft on Pre-Sales +
        # Brief — no user click needed.
        if doc.kind == "mom":
            try:
                extracted = extract_from_mom(doc.id, text)
                doc.mom_extracted_fields = extracted.model_dump(mode="json")
                doc.mom_extracted_at = datetime.now(timezone.utc)
                await db.commit()
            except Exception:
                logger.exception("MoM field extraction failed (non-fatal)")

        # aggregate regen for the account
        await _regenerate_aggregate(db, doc.account_id, job.id)

        job.status = "complete"
        job.progress = 100
        job.finished_at = datetime.now(timezone.utc)
        job.result = {"document_id": str(doc.id), "is_stub": doc.extracted_entities.get("is_stub", True)}
        await db.commit()
        return {"ok": True, "document_id": str(doc.id)}


async def _regenerate_aggregate(db, account_id: UUID, job_id: UUID) -> None:
    rows = (
        await db.execute(
            select(Document).where(
                Document.account_id == account_id,
                Document.deleted_at.is_(None),
                Document.ai_status == "complete",
            )
        )
    ).scalars().all()
    summaries = [d.ai_summary_text for d in rows if d.ai_summary_text]
    text = aggregate_account_summary(summaries)

    summ = (
        await db.execute(
            select(AccountDiscoverySummary).where(
                AccountDiscoverySummary.account_id == account_id
            )
        )
    ).scalar_one_or_none()
    if summ is None:
        summ = AccountDiscoverySummary(account_id=account_id)
        db.add(summ)
    summ.summary_text = text
    summ.source_document_ids = [d.id for d in rows]
    summ.generated_at = datetime.now(timezone.utc)
    summ.generated_by_job_id = job_id
    await db.commit()


async def _mark_failed(job_id: UUID, message: str) -> None:
    eng = new_worker_engine()
    Session = new_worker_session(eng)
    async with Session() as db:
        job = (await db.execute(select(Job).where(Job.id == job_id))).scalar_one_or_none()
        if job is None:
            return
        await _mark_failed_db(db, job, message)


async def _mark_failed_db(db, job: Job, message: str) -> None:
    job.status = "failed"
    job.error = message[:1000]
    job.finished_at = datetime.now(timezone.utc)
    await db.commit()
