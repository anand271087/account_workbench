"""M29 — Platform Intelligence tests."""

from __future__ import annotations

from fastapi.testclient import TestClient

from .conftest import mint_jwt


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _find_id(client: TestClient, admin_uid, slug: str) -> str:
    r = client.get(
        f"/api/v1/accounts?q={slug}", headers=_auth(mint_jwt(admin_uid))
    )
    return r.json()["items"][0]["id"]


# ============================================================
# GET — seeded accounts have data, others don't
# ============================================================


def test_get_returns_seeded_data_for_mondelez(
    client: TestClient, seeded_users: dict
) -> None:
    """Migration 0039 + 0040 seeded Mondelez with platform_intel content."""
    mondelez = _find_id(client, seeded_users["admin"], "mondelez")
    r = client.get(
        f"/api/v1/accounts/{mondelez}/platform-intel",
        headers=_auth(mint_jwt(seeded_users["admin"])),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["has_data"] is True

    # Spot-check the seeded shape — M29 sections.
    assert body["cat_intel"]["section_avg"]["price"] > 0
    assert len(body["cat_intel"]["top_cats"]) >= 3
    assert body["supplier_watch"]["tracked"] > 0
    assert body["abi"]["total_queries"] > 0
    assert body["benchmark"]["avg_health"] > 0
    assert body["engagement"]["alerts"] >= 0
    assert body["nps"]["score"] is not None
    assert len(body["nps"]["voc"]) >= 1

    # M30 — analytics sections seeded by migration 0040.
    assert len(body["usage"]["monthly_logins"]) == 12
    assert len(body["usage"]["monthly_active"]) == 12
    assert body["usage"]["licensed_users"] > 0
    assert body["modules"]["mmd"] > 0
    assert len(body["modules"]["monthly"]["mmd"]) == 12
    assert len(body["super_users"]) >= 3


def test_get_returns_empty_state_for_unseeded_account(
    client: TestClient, seeded_users: dict
) -> None:
    sanofi = _find_id(client, seeded_users["admin"], "sanofi")
    r = client.get(
        f"/api/v1/accounts/{sanofi}/platform-intel",
        headers=_auth(mint_jwt(seeded_users["admin"])),
    )
    assert r.status_code == 200
    body = r.json()
    assert body["has_data"] is False


# ============================================================
# PATCH — section-level replace
# ============================================================


def test_patch_replaces_single_section(
    client: TestClient, seeded_users: dict
) -> None:
    sanofi = _find_id(client, seeded_users["admin"], "sanofi")
    admin = seeded_users["admin"]

    r = client.patch(
        f"/api/v1/accounts/{sanofi}/platform-intel",
        headers=_auth(mint_jwt(admin)),
        json={
            "nps": {
                "score": 55,
                "voc": [
                    {
                        "quote": "Pricing intel saved us $300K this quarter.",
                        "author": "Test User",
                        "role": "Procurement Lead",
                        "sentiment": "positive",
                        "date": "2026-05-01",
                    }
                ],
            }
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["nps"]["score"] == 55
    assert body["nps"]["voc"][0]["quote"].startswith("Pricing intel")
    # Other sections untouched / still empty.
    assert body["cat_intel"]["top_cats"] == []


def test_patch_then_clear_section_via_null(
    client: TestClient, seeded_users: dict
) -> None:
    """Sending null on a key pops it from the merged jsonb."""
    sanofi = _find_id(client, seeded_users["admin"], "sanofi")
    admin = seeded_users["admin"]

    client.patch(
        f"/api/v1/accounts/{sanofi}/platform-intel",
        headers=_auth(mint_jwt(admin)),
        json={"nps": {"score": 42, "voc": []}},
    )
    r = client.patch(
        f"/api/v1/accounts/{sanofi}/platform-intel",
        headers=_auth(mint_jwt(admin)),
        json={"nps": None},
    )
    assert r.status_code == 200
    # Cleared back to schema default.
    assert r.json()["nps"]["score"] is None


# ============================================================
# RBAC
# ============================================================


def test_solutioning_manager_can_view_not_write(
    client: TestClient, seeded_users: dict
) -> None:
    mondelez = _find_id(client, seeded_users["admin"], "mondelez")
    sol = seeded_users["solutioning_manager"]

    r = client.get(
        f"/api/v1/accounts/{mondelez}/platform-intel",
        headers=_auth(mint_jwt(sol)),
    )
    assert r.status_code == 200
    assert r.json()["is_editable"] is False

    r = client.patch(
        f"/api/v1/accounts/{mondelez}/platform-intel",
        headers=_auth(mint_jwt(sol)),
        json={"nps": {"score": 99}},
    )
    assert r.status_code == 403


def test_csm_on_own_account_can_patch(
    client: TestClient, seeded_users: dict
) -> None:
    mondelez = _find_id(client, seeded_users["admin"], "mondelez")
    csm = seeded_users["csm"]
    r = client.patch(
        f"/api/v1/accounts/{mondelez}/platform-intel",
        headers=_auth(mint_jwt(csm)),
        json={
            "benchmark": {
                "avg_health": 75,
                "avg_seat_pct": 60,
                "avg_abi": 230,
                "avg_logins": 250,
                "avg_engagement": 40,
            }
        },
    )
    assert r.status_code == 200
    assert r.json()["benchmark"]["avg_health"] == 75
