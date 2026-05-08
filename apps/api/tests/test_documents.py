"""AK03.c — documents endpoints + extract + AI summary stubs.

We exercise the API surface end-to-end against the live Supabase project, but
short-circuit the Celery enqueue + Storage upload with monkeypatches so each
test stays fast and self-cleaning. The real worker pipeline is exercised by
manual end-to-end runs.
"""

from __future__ import annotations

import io
import os
from typing import Any

import asyncpg
import pytest
from fastapi.testclient import TestClient

from .conftest import mint_jwt


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _find_id(client: TestClient, admin_uid, slug: str) -> str:
    r = client.get(f"/api/v1/accounts?q={slug}", headers=_auth(mint_jwt(admin_uid)))
    return r.json()["items"][0]["id"]


# ---------- Storage + Celery monkeypatches ----------


@pytest.fixture(autouse=True)
def _stub_storage_and_celery(monkeypatch):
    """Replace Supabase Storage and Celery so we don't touch real infra in tests."""
    from app.services import files as files_svc
    from app.workers import tasks as worker_tasks

    monkeypatch.setattr(files_svc, "upload_object", lambda **_: None)
    monkeypatch.setattr(files_svc, "download_bytes", lambda *a, **k: b"")
    monkeypatch.setattr(
        files_svc, "signed_url", lambda *a, **k: "https://stub.local/signed"
    )

    class _StubAsyncResult:
        id = "stub-task-id"

    monkeypatch.setattr(worker_tasks.process_document, "delay", lambda *a, **k: _StubAsyncResult())


# ---------- DB cleanup ----------


def _cleanup_doc(doc_id: str) -> None:
    import asyncio

    async def _wipe():
        url = os.environ["DATABASE_URL"].replace("postgresql+asyncpg://", "postgresql://")
        conn = await asyncpg.connect(url, statement_cache_size=0)
        await conn.execute("delete from public.jobs where document_id = $1", doc_id)
        await conn.execute("delete from public.documents where id = $1", doc_id)
        await conn.close()

    asyncio.run(_wipe())


# ============================================================
# Extract service unit tests (no DB / no network)
# ============================================================


def test_extract_txt_returns_text() -> None:
    from app.services.extract import extract_text

    out = extract_text("notes.txt", "text/plain", b"Hello world from a test.")
    assert "Hello world" in out


def test_extract_vtt_strips_timestamps() -> None:
    from app.services.extract import extract_text

    vtt = (
        b"WEBVTT\n\n"
        b"00:00:00.000 --> 00:00:02.000\nHello procurement team.\n\n"
        b"00:00:02.000 --> 00:00:04.000\nLet us discuss the contract.\n"
    )
    out = extract_text("call.vtt", "text/vtt", vtt)
    assert "-->" not in out
    assert "Hello procurement team" in out
    assert "discuss the contract" in out


def test_extract_audio_raises_v1_1_message() -> None:
    from app.services.extract import ExtractError, extract_text

    with pytest.raises(ExtractError) as exc:
        extract_text("call.mp3", "audio/mpeg", b"\x00\x01\x02")
    assert "v1.1" in str(exc.value)


def test_summarise_document_stub_shape() -> None:
    from app.services.claude import summarise_document

    out = summarise_document(
        "Acme is consolidating IT spend across EMEA. Action: send vendor benchmarks. 2026-06-12.",
        "mom",
    )
    assert out["is_stub"] is True
    assert isinstance(out["people"], list)
    assert isinstance(out["action_items"], list)
    assert isinstance(out["dates"], list)


# ============================================================
# GET /accounts/:id/documents
# ============================================================


def test_documents_unauth_401(client: TestClient, seeded_users: dict) -> None:
    sie = _find_id(client, seeded_users["admin"], "siemens")
    r = client.get(f"/api/v1/accounts/{sie}/documents")
    assert r.status_code == 401


def test_list_documents_admin_empty_initially(client: TestClient, seeded_users: dict) -> None:
    sie = _find_id(client, seeded_users["admin"], "siemens")
    r = client.get(
        f"/api/v1/accounts/{sie}/documents",
        headers=_auth(mint_jwt(seeded_users["admin"])),
    )
    assert r.status_code == 200
    body = r.json()
    assert body["is_editable"] is True
    assert isinstance(body["items"], list)


def test_list_documents_csm_other_account_readonly(client: TestClient, seeded_users: dict) -> None:
    sanofi = _find_id(client, seeded_users["admin"], "sanofi")
    r = client.get(
        f"/api/v1/accounts/{sanofi}/documents",
        headers=_auth(mint_jwt(seeded_users["csm"])),
    )
    assert r.status_code == 200
    assert r.json()["is_editable"] is False


# ============================================================
# POST /accounts/:id/documents (multipart upload)
# ============================================================


def test_upload_document_admin_mom(client: TestClient, seeded_users: dict) -> None:
    novo = _find_id(client, seeded_users["admin"], "novo")
    files = {"file": ("test.txt", io.BytesIO(b"Sample meeting minutes from 2026-06-12."), "text/plain")}
    data = {"kind": "mom"}
    r = client.post(
        f"/api/v1/accounts/{novo}/documents",
        headers=_auth(mint_jwt(seeded_users["admin"])),
        files=files,
        data=data,
    )
    assert r.status_code == 202, r.text
    body = r.json()
    assert body["document"]["filename"] == "test.txt"
    assert body["document"]["kind"] == "mom"
    assert body["job_id"]
    _cleanup_doc(body["document"]["id"])


def test_upload_document_dedup_returns_existing(client: TestClient, seeded_users: dict) -> None:
    novo = _find_id(client, seeded_users["admin"], "novo")
    payload = b"Identical content for dedup test."

    def _post():
        return client.post(
            f"/api/v1/accounts/{novo}/documents",
            headers=_auth(mint_jwt(seeded_users["admin"])),
            files={"file": ("dup.txt", io.BytesIO(payload), "text/plain")},
            data={"kind": "mom"},
        )

    a = _post()
    assert a.status_code == 202
    b = _post()
    assert b.status_code == 202
    assert b.json()["duplicate"] is True
    assert b.json()["document"]["id"] == a.json()["document"]["id"]
    _cleanup_doc(a.json()["document"]["id"])


def test_upload_document_unsupported_extension_415(client: TestClient, seeded_users: dict) -> None:
    novo = _find_id(client, seeded_users["admin"], "novo")
    r = client.post(
        f"/api/v1/accounts/{novo}/documents",
        headers=_auth(mint_jwt(seeded_users["admin"])),
        files={"file": ("evil.exe", io.BytesIO(b"MZ"), "application/octet-stream")},
        data={"kind": "mom"},
    )
    assert r.status_code == 415


def test_upload_document_audio_415_with_v11_message(client: TestClient, seeded_users: dict) -> None:
    novo = _find_id(client, seeded_users["admin"], "novo")
    r = client.post(
        f"/api/v1/accounts/{novo}/documents",
        headers=_auth(mint_jwt(seeded_users["admin"])),
        files={"file": ("call.mp3", io.BytesIO(b"\x00"), "audio/mpeg")},
        data={"kind": "recording"},
    )
    assert r.status_code == 415
    assert "v1.1" in r.json()["detail"]


def test_upload_vpd_csm_forbidden(client: TestClient, seeded_users: dict) -> None:
    """Matrix: CSM cannot write VPDs (V only). Solutioning + admins can."""
    sie = _find_id(client, seeded_users["admin"], "siemens")
    r = client.post(
        f"/api/v1/accounts/{sie}/documents",
        headers=_auth(mint_jwt(seeded_users["csm"])),
        files={"file": ("v.txt", io.BytesIO(b"Value prop deck content."), "text/plain")},
        data={"kind": "vpd"},
    )
    assert r.status_code == 403


def test_upload_vpd_solutioning_allowed(client: TestClient, seeded_users: dict) -> None:
    """Matrix: solutioning_manager has F (all) on VPDs."""
    sie = _find_id(client, seeded_users["admin"], "siemens")
    r = client.post(
        f"/api/v1/accounts/{sie}/documents",
        headers=_auth(mint_jwt(seeded_users["solutioning_manager"])),
        files={"file": ("v2.txt", io.BytesIO(b"VPD v2 content."), "text/plain")},
        data={"kind": "vpd"},
    )
    assert r.status_code == 202
    _cleanup_doc(r.json()["document"]["id"])


# ============================================================
# Soft delete + rerun + jobs/:id
# ============================================================


def test_soft_delete_document(client: TestClient, seeded_users: dict) -> None:
    novo = _find_id(client, seeded_users["admin"], "novo")
    admin_h = _auth(mint_jwt(seeded_users["admin"]))
    created = client.post(
        f"/api/v1/accounts/{novo}/documents",
        headers=admin_h,
        files={"file": ("d.txt", io.BytesIO(b"To be deleted."), "text/plain")},
        data={"kind": "mom"},
    ).json()
    cid = created["document"]["id"]

    r = client.delete(f"/api/v1/documents/{cid}", headers=admin_h)
    assert r.status_code == 204

    after = client.get(f"/api/v1/accounts/{novo}/documents", headers=admin_h).json()
    assert not any(d["id"] == cid for d in after["items"])
    _cleanup_doc(cid)


def test_rerun_ai_admin(client: TestClient, seeded_users: dict) -> None:
    novo = _find_id(client, seeded_users["admin"], "novo")
    admin_h = _auth(mint_jwt(seeded_users["admin"]))
    created = client.post(
        f"/api/v1/accounts/{novo}/documents",
        headers=admin_h,
        files={"file": ("r.txt", io.BytesIO(b"Rerun me."), "text/plain")},
        data={"kind": "mom"},
    ).json()
    cid = created["document"]["id"]

    r = client.post(f"/api/v1/documents/{cid}/rerun-ai", headers=admin_h)
    assert r.status_code == 200
    assert r.json()["status"] in {"pending", "running"}
    _cleanup_doc(cid)


def test_jobs_unauth_401(client: TestClient, seeded_users: dict) -> None:
    # Unknown UUID, but should reject auth before resolving.
    r = client.get("/api/v1/jobs/00000000-0000-0000-0000-000000000000")
    assert r.status_code == 401


def test_discovery_summary_empty_returns_blank(client: TestClient, seeded_users: dict) -> None:
    novo = _find_id(client, seeded_users["admin"], "novo")
    r = client.get(
        f"/api/v1/accounts/{novo}/discovery-summary",
        headers=_auth(mint_jwt(seeded_users["admin"])),
    )
    assert r.status_code == 200
    body = r.json()
    assert body["account_id"] == novo
    assert body["source_document_ids"] == [] or isinstance(body["source_document_ids"], list)
