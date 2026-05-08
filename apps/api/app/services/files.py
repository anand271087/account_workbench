"""Supabase Storage helpers for AK03.c documents.

Uploads use the **service role key** (RLS-bypassing) so the API process is
the only thing that ever talks to Storage directly. Users get short-lived
signed URLs to download.

Naming convention: `<account_id>/<doc_id>__<sanitised_filename>` —
account-scoped paths make manual ops + bucket scrubbing easy.
"""

from __future__ import annotations

import hashlib
import re
from functools import lru_cache
from pathlib import PurePosixPath
from uuid import UUID

from supabase import Client, create_client

from app.core.config import get_settings


_BUCKET_FOR_KIND: dict[str, str] = {
    "vpd": "vpd",
    "mom": "meeting_records",
    "transcript": "meeting_records",
    "recording": "meeting_records",
    "email": "meeting_records",
    "other": "meeting_records",
}


def bucket_for_kind(kind: str) -> str:
    return _BUCKET_FOR_KIND.get(kind, "meeting_records")


@lru_cache(maxsize=1)
def _client() -> Client:
    s = get_settings()
    return create_client(s.supabase_url, s.supabase_service_role_key.get_secret_value())


_SAFE = re.compile(r"[^A-Za-z0-9._-]+")


def sanitised_filename(name: str) -> str:
    """Trim path traversal + collapse hostile chars. Storage keys disallow `/`."""
    base = PurePosixPath(name).name or "upload"
    return _SAFE.sub("_", base)[:200]


def storage_key(account_id: UUID, document_id: UUID, original_filename: str) -> str:
    return f"{account_id}/{document_id}__{sanitised_filename(original_filename)}"


def hash_bytes(data: bytes) -> str:
    """SHA-256 over the raw file. Used for per-account dedup (UNIQUE in DB)."""
    return hashlib.sha256(data).hexdigest()


def upload_object(*, bucket: str, key: str, data: bytes, content_type: str) -> None:
    """Upload raw bytes. Raises on Supabase error — caller decides whether to retry."""
    res = _client().storage.from_(bucket).upload(
        path=key,
        file=data,
        file_options={"content-type": content_type, "upsert": "false"},
    )
    # The supabase-py client returns the upload result; on duplicate, it raises StorageException
    # which the route catches. We treat anything else as success.
    return res


def download_bytes(bucket: str, key: str) -> bytes:
    """Server-side download for the worker (no signed URL needed)."""
    return _client().storage.from_(bucket).download(key)


def signed_url(bucket: str, key: str, expires_in_seconds: int = 300) -> str:
    """Short-lived signed URL handed back to the browser for downloads."""
    res = _client().storage.from_(bucket).create_signed_url(key, expires_in_seconds)
    # supabase-py returns {"signedURL": "..."} or {"signedUrl": "..."} depending on version.
    return res.get("signedURL") or res.get("signedUrl") or ""


def delete_object(bucket: str, key: str) -> None:
    """Used when a hard-delete cron eventually scrubs soft-deleted docs (admin sprint)."""
    _client().storage.from_(bucket).remove([key])
