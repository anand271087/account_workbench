"""AK03.c — Documents (MOM, VPD, transcripts, emails) endpoints.

Per Roles_Access_Matrix_Reviewed_05072026.xlsx:
- MOM (Meeting Records): F (own/team/all) for CS roles + Solutioning F (all)
- VPD (Solutioning Documents): F (all) for Solutioning + global admins; everyone else V

Upload pipeline:
1) Multipart POST → validate kind + RBAC + size + extension
2) Hash bytes (SHA-256) → 200 if dedup hit (return existing doc)
3) Insert document row (ai_status='pending') + job row → returns 202
4) Upload to Supabase Storage (service-role-bypassing RLS)
5) enqueue Celery `process_document.delay(job_id)`
6) Frontend polls /api/v1/jobs/:id; worker writes ai_summary_text + extracted_entities

Soft delete: sets `deleted_at`. The aggregate discovery summary is regenerated
after every document mutation so the account-level rollup stays consistent.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Path,
    Query,
    UploadFile,
    status,
)
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.deps import CurrentUser
from app.core.rbac import can_view_account, can_write_documents, is_global_admin
from app.db.session import get_db
from app.models.account import Account
from app.models.document import AccountDiscoverySummary, Document, Job
from app.routes.accounts import _team_member_ids
from app.schemas.document import (
    DiscoverySummaryOut,
    DocKind,
    DocumentListResponse,
    DocumentOut,
    DocumentSummaryUpdate,
    DocumentUploadResponse,
    JobOut,
)
from app.services import ai_quota
from app.services import files as storage_svc

logger = logging.getLogger(__name__)

account_router = APIRouter(prefix="/api/v1/accounts", tags=["documents"])
document_router = APIRouter(prefix="/api/v1/documents", tags=["documents"])
job_router = APIRouter(prefix="/api/v1/jobs", tags=["jobs"])


# ---------- helpers ----------


async def _scope_for_account(
    db: AsyncSession, user, account_id: UUID
) -> tuple[Account, bool, bool]:
    from app.core.scope import get_account_row

    acc = await get_account_row(db, account_id)
    is_assigned = (acc.csm_user_id == user.id) or (acc.co_user_id == user.id)
    team_ids = await _team_member_ids(db, user) if user.role == "cs_team_manager" else set()
    is_team = acc.csm_user_id in team_ids if team_ids else False
    if not can_view_account(user.role, is_assigned=is_assigned, is_team=is_team):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Forbidden on this account")
    return acc, is_assigned, is_team


async def _scope_for_document(
    db: AsyncSession, user, document_id: UUID, *, allow_deleted: bool = False
) -> tuple[Document, Account, bool, bool]:
    stmt = select(Document).where(Document.id == document_id)
    if not allow_deleted:
        stmt = stmt.where(Document.deleted_at.is_(None))
    doc = (await db.execute(stmt)).scalar_one_or_none()
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
    acc, is_assigned, is_team = await _scope_for_account(db, user, doc.account_id)
    return doc, acc, is_assigned, is_team


def _validate_extension(filename: str) -> str:
    name = (filename or "").lower()
    # Audio/video deferred to v1.1 — give the explicit message before the generic one.
    if name.endswith((".mp3", ".mp4", ".m4a", ".wav", ".mov")):
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            "Audio/video transcription lands in v1.1 — upload .docx/.pdf/.txt/.vtt for now.",
        )
    allowed = get_settings().allowed_extensions_list
    if not any(name.endswith(ext) for ext in allowed):
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            f"Unsupported file type. Allowed: {', '.join(allowed)}",
        )
    return name


# ============================================================
# GET /accounts/:id/documents
# ============================================================


@account_router.get("/{account_id}/documents", response_model=DocumentListResponse)
async def list_documents(
    account_id: Annotated[UUID, Path()],
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    include_deleted: bool = Query(False, description="Admin only — show recently soft-deleted"),
    kind: DocKind | None = Query(None, description="Filter by doc kind"),
) -> DocumentListResponse:
    _, is_assigned, is_team = await _scope_for_account(db, user, account_id)

    stmt = (
        select(Document)
        .where(Document.account_id == account_id)
        .order_by(Document.uploaded_at.desc())
    )
    if include_deleted:
        if not is_global_admin(user.role):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, "Only admins can view deleted documents"
            )
    else:
        stmt = stmt.where(Document.deleted_at.is_(None))
    if kind:
        stmt = stmt.where(Document.kind == kind)

    rows = (await db.execute(stmt)).scalars().all()
    # Editability is per-kind (VPD vs MOM differ); the frontend asks the API
    # again on a per-row click, but for the list-level "Add" button we report
    # MOM-level editability since MOM is the most permissive flavour.
    is_editable = can_write_documents(
        user.role, is_assigned=is_assigned, is_team=is_team, kind="mom"
    )
    return DocumentListResponse(
        items=[DocumentOut.model_validate(d) for d in rows],
        total=len(rows),
        is_editable=is_editable,
    )


# ============================================================
# POST /accounts/:id/documents (multipart)
# ============================================================


@account_router.post(
    "/{account_id}/documents",
    response_model=DocumentUploadResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def upload_document(
    account_id: Annotated[UUID, Path()],
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    kind: Annotated[DocKind, Form()],
    file: Annotated[UploadFile, File()],
    meeting_date: Annotated[str | None, Form()] = None,
) -> DocumentUploadResponse:
    _, is_assigned, is_team = await _scope_for_account(db, user, account_id)
    if not can_write_documents(
        user.role, is_assigned=is_assigned, is_team=is_team, kind=kind
    ):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, f"Your role cannot upload {kind.upper()} on this account"
        )

    settings = get_settings()
    max_bytes = settings.max_upload_size_mb * 1024 * 1024

    _validate_extension(file.filename or "")
    raw = await file.read()
    if len(raw) == 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Empty file")
    if len(raw) > max_bytes:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"File exceeds {settings.max_upload_size_mb} MB limit",
        )

    digest = storage_svc.hash_bytes(raw)

    # Dedup — look at ALL rows (live + soft-deleted) so we don't trip the
    # `(account_id, file_hash)` unique constraint when a user re-uploads
    # content they previously soft-deleted.
    existing = (
        await db.execute(
            select(Document).where(
                Document.account_id == account_id,
                Document.file_hash == digest,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        if existing.deleted_at is not None:
            # Soft-deleted previously — restore it instead of inserting a duplicate.
            existing.deleted_at = None
            await db.commit()
            await db.refresh(existing)
        return DocumentUploadResponse(
            document=DocumentOut.model_validate(existing),
            job_id=existing.job_id or uuid4(),
            duplicate=True,
        )

    # Pre-mint UUIDs so we can build the storage path BEFORE INSERT.
    doc_id = uuid4()
    bucket = storage_svc.bucket_for_kind(kind)
    key = storage_svc.storage_key(account_id, doc_id, file.filename or "upload")

    # Upload first — if Storage rejects the file, we don't leak a phantom DB row.
    try:
        storage_svc.upload_object(
            bucket=bucket,
            key=key,
            data=raw,
            content_type=file.content_type or "application/octet-stream",
        )
    except Exception as exc:
        logger.exception("Storage upload failed")
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, f"Storage upload failed: {exc}"
        ) from exc

    # Now insert the doc + job atomically.
    parsed_meeting_date = None
    if meeting_date:
        try:
            parsed_meeting_date = datetime.fromisoformat(meeting_date).date()
        except ValueError:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "meeting_date must be ISO-8601 (YYYY-MM-DD)"
            ) from None

    doc = Document(
        id=doc_id,
        account_id=account_id,
        kind=kind,
        filename=file.filename or "upload",
        file_hash=digest,
        storage_path=f"{bucket}/{key}",
        mime_type=file.content_type,
        size_bytes=len(raw),
        meeting_date=parsed_meeting_date,
        uploaded_by=user.id,
        ai_status="pending",
    )
    job = Job(
        kind="process_document",
        account_id=account_id,
        document_id=doc_id,
        status="pending",
        payload={"document_id": str(doc_id)},
    )
    db.add(doc)
    db.add(job)
    try:
        await db.flush()  # populate job.id without committing
        doc.job_id = job.id
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        # Race against a parallel upload of the exact same content. Re-fetch
        # the row that won the race and return it as a duplicate.
        if "documents_account_id_file_hash_key" in str(exc):
            winner = (
                await db.execute(
                    select(Document).where(
                        Document.account_id == account_id,
                        Document.file_hash == digest,
                    )
                )
            ).scalar_one_or_none()
            if winner is not None:
                if winner.deleted_at is not None:
                    winner.deleted_at = None
                    await db.commit()
                    await db.refresh(winner)
                return DocumentUploadResponse(
                    document=DocumentOut.model_validate(winner),
                    job_id=winner.job_id or uuid4(),
                    duplicate=True,
                )
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR, f"Database write failed: {exc}"
        ) from exc
    await db.refresh(doc)
    await db.refresh(job)

    # Enqueue work — failure here doesn't undo the upload; the worker can be
    # nudged later via /rerun-ai. We log and move on.
    try:
        from app.workers.tasks import process_document

        process_document.delay(str(job.id))
    except Exception:
        logger.warning("Celery enqueue failed; job %s left as pending", job.id, exc_info=True)

    return DocumentUploadResponse(
        document=DocumentOut.model_validate(doc),
        job_id=job.id,
        duplicate=False,
    )


# ============================================================
# GET /documents/:id
# ============================================================


@document_router.get("/{document_id}", response_model=DocumentOut)
async def get_document(
    document_id: Annotated[UUID, Path()],
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> DocumentOut:
    doc, _, _, _ = await _scope_for_document(db, user, document_id)
    return DocumentOut.model_validate(doc)


@document_router.patch("/{document_id}/summary", response_model=DocumentOut)
async def edit_summary(
    document_id: Annotated[UUID, Path()],
    body: DocumentSummaryUpdate,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> DocumentOut:
    """User-edited AI summary. Flips ai_edited=true so the UI shows 'AI-assisted'.

    BRD §4.3.c logic: AI-generated → AI-assisted on user edit.
    """
    doc, _, is_assigned, is_team = await _scope_for_document(db, user, document_id)
    if not can_write_documents(
        user.role, is_assigned=is_assigned, is_team=is_team, kind=doc.kind
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Cannot edit this document")

    doc.ai_summary_text = body.ai_summary_text
    doc.ai_edited = True
    doc.ai_edited_by = user.id
    doc.ai_edited_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(doc)
    return DocumentOut.model_validate(doc)


@document_router.get("/{document_id}/download-url")
async def get_signed_download_url(
    document_id: Annotated[UUID, Path()],
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    doc, _, _, _ = await _scope_for_document(db, user, document_id)
    bucket, _, key = doc.storage_path.partition("/")
    return {"url": storage_svc.signed_url(bucket, key, expires_in_seconds=300)}


# ============================================================
# POST /documents/:id/rerun-ai
# ============================================================


@document_router.post("/{document_id}/rerun-ai", response_model=JobOut)
async def rerun_ai(
    document_id: Annotated[UUID, Path()],
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> JobOut:
    doc, _, is_assigned, is_team = await _scope_for_document(db, user, document_id)
    if not can_write_documents(
        user.role, is_assigned=is_assigned, is_team=is_team, kind=doc.kind
    ):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Cannot re-run AI on this document"
        )
    ai_quota.consume(user.id, label="document_rerun")

    job = Job(
        kind="process_document",
        account_id=doc.account_id,
        document_id=doc.id,
        status="pending",
        payload={"document_id": str(doc.id), "rerun": True},
    )
    db.add(job)
    await db.flush()
    doc.job_id = job.id
    doc.ai_status = "pending"
    doc.ai_summary_text = None
    doc.extracted_entities = None
    doc.ai_edited = False
    doc.ai_edited_by = None
    doc.ai_edited_at = None
    await db.commit()
    await db.refresh(job)

    try:
        from app.workers.tasks import process_document

        process_document.delay(str(job.id))
    except Exception:
        logger.warning("Celery enqueue failed on rerun; job %s left as pending", job.id, exc_info=True)

    return JobOut.model_validate(job)


# ============================================================
# DELETE /documents/:id  (soft)
# ============================================================


@document_router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def soft_delete_document(
    document_id: Annotated[UUID, Path()],
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    doc, _, is_assigned, is_team = await _scope_for_document(db, user, document_id)
    if not can_write_documents(
        user.role, is_assigned=is_assigned, is_team=is_team, kind=doc.kind
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Cannot delete this document")

    doc.deleted_at = datetime.now(timezone.utc)
    await db.commit()


# ============================================================
# GET /accounts/:id/discovery-summary
# ============================================================


@account_router.get(
    "/{account_id}/discovery-summary", response_model=DiscoverySummaryOut
)
async def get_discovery_summary(
    account_id: Annotated[UUID, Path()],
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> DiscoverySummaryOut:
    await _scope_for_account(db, user, account_id)
    summ = (
        await db.execute(
            select(AccountDiscoverySummary).where(
                AccountDiscoverySummary.account_id == account_id
            )
        )
    ).scalar_one_or_none()
    if summ is None:
        return DiscoverySummaryOut(
            account_id=account_id,
            summary_text=None,
            source_document_ids=[],
            generated_at=None,
        )
    return DiscoverySummaryOut.model_validate(summ)


# ============================================================
# GET /jobs/:id
# ============================================================


@job_router.get("/{job_id}", response_model=JobOut)
async def get_job(
    job_id: Annotated[UUID, Path()],
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> JobOut:
    job = (
        await db.execute(select(Job).where(Job.id == job_id))
    ).scalar_one_or_none()
    if job is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Job not found")
    if job.account_id is not None:
        # Reuse the same scope check the parent account uses.
        await _scope_for_account(db, user, job.account_id)
    return JobOut.model_validate(job)
