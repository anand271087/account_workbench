"""AK03.a — engagement endpoints + audit writer + AI quality check + lookups."""

import asyncio
import os
from uuid import UUID

import asyncpg
import pytest
from fastapi.testclient import TestClient

from .conftest import mint_jwt


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _find_id(client: TestClient, admin_uid, slug: str) -> str:
    r = client.get(f"/api/v1/accounts?q={slug}", headers=_auth(mint_jwt(admin_uid)))
    return r.json()["items"][0]["id"]


# ============================================================
# GET /accounts/:id/engagement
# ============================================================


def test_engagement_unauth_401(client: TestClient, seeded_users: dict) -> None:
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    r = client.get(f"/api/v1/accounts/{siemens}/engagement")
    assert r.status_code == 401


def test_engagement_admin_get(client: TestClient, seeded_users: dict) -> None:
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    r = client.get(
        f"/api/v1/accounts/{siemens}/engagement",
        headers=_auth(mint_jwt(seeded_users["admin"])),
    )
    assert r.status_code == 200
    body = r.json()
    assert body["spoc_text"] == "Gunter Braun (VP Procurement)"
    assert "Direct Materials" in body["target_categories"]
    assert body["procurement_maturity"] == "high"
    assert body["is_editable"] is True


def test_engagement_csm_readonly_on_other_csm(client: TestClient, seeded_users: dict) -> None:
    """Harish (csm) is NOT csm on Sanofi (csm2 is). View=yes, edit=no."""
    sanofi = _find_id(client, seeded_users["admin"], "sanofi")
    r = client.get(
        f"/api/v1/accounts/{sanofi}/engagement",
        headers=_auth(mint_jwt(seeded_users["csm"])),
    )
    assert r.status_code == 200
    assert r.json()["is_editable"] is False


def test_engagement_solutioning_view_only(client: TestClient, seeded_users: dict) -> None:
    """Matrix Q3: solutioning_manager VIEW only on engagement info."""
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    r = client.get(
        f"/api/v1/accounts/{siemens}/engagement",
        headers=_auth(mint_jwt(seeded_users["solutioning_manager"])),
    )
    assert r.status_code == 200
    assert r.json()["is_editable"] is False


def test_engagement_404_unknown_account(client: TestClient, seeded_users: dict) -> None:
    r = client.get(
        "/api/v1/accounts/00000000-0000-0000-0000-000000000000/engagement",
        headers=_auth(mint_jwt(seeded_users["admin"])),
    )
    assert r.status_code == 404


# ============================================================
# PATCH /accounts/:id/engagement + audit writer
# ============================================================


def test_engagement_patch_admin_succeeds_and_audits(client: TestClient, seeded_users: dict) -> None:
    """An admin PATCH must succeed AND write an audit_log entry per changed field."""
    import time

    novo = _find_id(client, seeded_users["admin"], "novo")
    # Per-run unique suffix so the audit listener actually sees a change
    # (re-running against the same DB would otherwise be a no-op).
    suffix = str(int(time.time() * 1000))
    new_objective = (
        f"Real-time GLP-1 supply chain intelligence for Ozempic/Wegovy ramp ({suffix}). "
        "Reduce supplier-disruption response time from 14 days to under 24 hours by Q4 2025. "
        "Monitor 20 critical API and packaging suppliers. Target: zero unplanned production halts."
    )
    new_categories = [f"Direct Materials {suffix}", f"Logistics {suffix}"]
    r = client.patch(
        f"/api/v1/accounts/{novo}/engagement",
        headers=_auth(mint_jwt(seeded_users["admin"])),
        json={
            "engagement_objective": new_objective,
            "target_categories": new_categories,
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["engagement_objective"] == new_objective
    assert any(c.startswith("Logistics") for c in body["target_categories"])

    # Confirm audit_log entries appear in the activity feed
    feed = client.get(
        f"/api/v1/accounts/{novo}/activity",
        headers=_auth(mint_jwt(seeded_users["admin"])),
    )
    assert feed.status_code == 200
    items = feed.json()["items"]
    eng_entries = [
        it for it in items if it["table_name"] == "account_engagement" and it["action"] == "update"
    ]
    fields_changed = {it["field_name"] for it in eng_entries}
    assert "engagement_objective" in fields_changed
    assert "target_categories" in fields_changed


def test_engagement_patch_csm_forbidden_on_other_csm(client: TestClient, seeded_users: dict) -> None:
    """harish (csm) cannot edit Sanofi's engagement (csm2 is the assigned CSM)."""
    sanofi = _find_id(client, seeded_users["admin"], "sanofi")
    r = client.patch(
        f"/api/v1/accounts/{sanofi}/engagement",
        headers=_auth(mint_jwt(seeded_users["csm"])),
        json={"engagement_objective": "should be rejected"},
    )
    assert r.status_code == 403


def test_engagement_patch_solutioning_forbidden(client: TestClient, seeded_users: dict) -> None:
    """Matrix Q3: solutioning_manager cannot edit engagement info."""
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    r = client.patch(
        f"/api/v1/accounts/{siemens}/engagement",
        headers=_auth(mint_jwt(seeded_users["solutioning_manager"])),
        json={"sdr_lead": "should be rejected"},
    )
    assert r.status_code == 403


def test_engagement_patch_csm_own_succeeds(client: TestClient, seeded_users: dict) -> None:
    """harish (csm) is the csm on Mondelez → can edit it."""
    mondelez = _find_id(client, seeded_users["admin"], "mondelez")
    r = client.patch(
        f"/api/v1/accounts/{mondelez}/engagement",
        headers=_auth(mint_jwt(seeded_users["csm"])),
        json={"sdr_lead": "Updated by harish"},
    )
    assert r.status_code == 200
    assert r.json()["sdr_lead"] == "Updated by harish"


def test_engagement_objective_change_resets_dismissed(client: TestClient, seeded_users: dict) -> None:
    """Dismissing the AI warning then changing the text should re-arm the check."""
    mondelez = _find_id(client, seeded_users["admin"], "mondelez")
    # Dismiss
    client.patch(
        f"/api/v1/accounts/{mondelez}/engagement",
        headers=_auth(mint_jwt(seeded_users["admin"])),
        json={"ai_quality_dismissed": True},
    )
    # Change text — dismissal should clear
    r = client.patch(
        f"/api/v1/accounts/{mondelez}/engagement",
        headers=_auth(mint_jwt(seeded_users["admin"])),
        json={"engagement_objective": "Brand new text completely different now."},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["ai_quality_dismissed"] is False
    assert body["ai_quality_score"] is None


# ============================================================
# AI quality check
# ============================================================


def test_ai_quality_check_short_text_low_score(client: TestClient, seeded_users: dict) -> None:
    r = client.post(
        "/api/v1/ai/quality-check",
        headers=_auth(mint_jwt(seeded_users["admin"])),
        json={"text": "Cost savings."},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["score"] <= 2  # Stub or real: must be low
    assert body["word_count"] == 2


def test_ai_quality_check_strong_text_high_score(client: TestClient, seeded_users: dict) -> None:
    strong = (
        "Reduce category procurement spend by 15% in 18 months by combining Beroe price intelligence "
        "with quarterly should-cost benchmarks. Replace 3 fragmented intelligence vendors with a "
        "single unified platform supporting our nearshoring of 8 European categories. Success "
        "measured by documented €2.4M cost-out by Q4 2025 and 40 onboarded power users delivering "
        "weekly category insights to the CPO. Outcomes drive supplier risk reduction and faster "
        "renegotiation cycles across the energy portfolio."
    )
    r = client.post(
        "/api/v1/ai/quality-check",
        headers=_auth(mint_jwt(seeded_users["admin"])),
        json={"text": strong},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["score"] >= 4


def test_ai_quality_check_empty_text_400(client: TestClient, seeded_users: dict) -> None:
    r = client.post(
        "/api/v1/ai/quality-check",
        headers=_auth(mint_jwt(seeded_users["admin"])),
        json={"text": "  "},
    )
    assert r.status_code == 400


def test_ai_quality_check_unauth_401(client: TestClient) -> None:
    r = client.post("/api/v1/ai/quality-check", json={"text": "anything"})
    assert r.status_code == 401


# ============================================================
# Lookups: categories + geographies
# ============================================================


def test_list_categories_includes_seed(client: TestClient, seeded_users: dict) -> None:
    r = client.get(
        "/api/v1/lookups/categories", headers=_auth(mint_jwt(seeded_users["admin"]))
    )
    assert r.status_code == 200
    names = {c["name"] for c in r.json()}
    # 0003 seed inserted these
    assert "Direct Materials" in names


def test_propose_category_creates_pending(client: TestClient, seeded_users: dict) -> None:
    """Anyone authed can propose. Lands as approved=false. Idempotent on re-test via cleanup."""
    proposed_name = "M5 Test Category"
    # Ensure clean state
    asyncio.run(_delete_category_by_name(proposed_name))

    r = client.post(
        "/api/v1/lookups/categories",
        headers=_auth(mint_jwt(seeded_users["csm"])),
        json={"name": proposed_name},
    )
    assert r.status_code == 201
    body = r.json()
    assert body["name"] == proposed_name
    assert body["approved"] is False

    # Conflict on duplicate
    r2 = client.post(
        "/api/v1/lookups/categories",
        headers=_auth(mint_jwt(seeded_users["csm"])),
        json={"name": proposed_name},
    )
    assert r2.status_code == 409

    # Admin can approve
    r3 = client.post(
        f"/api/v1/lookups/categories/{body['id']}/approve",
        headers=_auth(mint_jwt(seeded_users["admin"])),
    )
    assert r3.status_code == 200
    assert r3.json()["approved"] is True

    # Cleanup
    asyncio.run(_delete_category_by_name(proposed_name))


def test_propose_category_non_admin_cannot_approve(client: TestClient, seeded_users: dict) -> None:
    proposed_name = "M5 Admin Approve Test"
    asyncio.run(_delete_category_by_name(proposed_name))
    r = client.post(
        "/api/v1/lookups/categories",
        headers=_auth(mint_jwt(seeded_users["csm"])),
        json={"name": proposed_name},
    )
    assert r.status_code == 201
    cid = r.json()["id"]

    # csm cannot approve
    r2 = client.post(
        f"/api/v1/lookups/categories/{cid}/approve",
        headers=_auth(mint_jwt(seeded_users["csm"])),
    )
    assert r2.status_code == 403
    asyncio.run(_delete_category_by_name(proposed_name))


def test_list_geographies(client: TestClient, seeded_users: dict) -> None:
    r = client.get(
        "/api/v1/lookups/geographies", headers=_auth(mint_jwt(seeded_users["admin"]))
    )
    assert r.status_code == 200
    names = {g["name"] for g in r.json()}
    assert "Europe" in names


# ============================================================
# Helpers
# ============================================================


async def _delete_category_by_name(name: str) -> None:
    url = os.environ["DATABASE_URL"].replace("postgresql+asyncpg://", "postgresql://")
    conn = await asyncpg.connect(url, statement_cache_size=0)
    try:
        await conn.execute("delete from public.lookup_categories where name = $1", name)
    finally:
        await conn.close()
