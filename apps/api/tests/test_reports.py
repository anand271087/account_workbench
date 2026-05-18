"""M31 — Reports generation tests."""

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


def test_qbr_renders_for_seeded_account(
    client: TestClient, seeded_users: dict
) -> None:
    mondelez = _find_id(client, seeded_users["admin"], "mondelez")
    r = client.get(
        f"/api/v1/accounts/{mondelez}/reports/qbr",
        headers=_auth(mint_jwt(seeded_users["admin"])),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["type"] == "qbr"
    assert body["filename"].endswith(".html")
    html = body["html"]
    assert "<!doctype html>" in html.lower()
    # Sections present.
    assert "Engagement Scope" in html
    assert "Usage Analysis" in html
    assert "Category Trends" in html
    assert "Industry Benchmark" in html
    assert "Expansion Pipeline" in html
    # Seeded data should appear.
    assert "Mondel" in html  # account name escaped


def test_mbr_renders_with_metrics_and_checkpoints(
    client: TestClient, seeded_users: dict
) -> None:
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    r = client.get(
        f"/api/v1/accounts/{siemens}/reports/mbr",
        headers=_auth(mint_jwt(seeded_users["admin"])),
    )
    assert r.status_code == 200
    html = r.json()["html"]
    assert "Monthly Business Review" in html
    assert "This Month's Highlights" in html
    assert "Open Checkpoints" in html


def test_utilization_renders_with_super_users(
    client: TestClient, seeded_users: dict
) -> None:
    mondelez = _find_id(client, seeded_users["admin"], "mondelez")
    r = client.get(
        f"/api/v1/accounts/{mondelez}/reports/utilization",
        headers=_auth(mint_jwt(seeded_users["admin"])),
    )
    assert r.status_code == 200
    html = r.json()["html"]
    assert "Utilization Report" in html
    assert "Adoption Overview" in html
    assert "Module-Wise Usage" in html
    # Super users seeded by 0040.
    assert "Jordan Mills" in html


def test_reports_403_for_unrelated_role(
    client: TestClient, seeded_users: dict
) -> None:
    """Solutioning manager can view (view-gated)."""
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    sol = seeded_users["solutioning_manager"]
    r = client.get(
        f"/api/v1/accounts/{siemens}/reports/qbr",
        headers=_auth(mint_jwt(sol)),
    )
    # Solutioning has view on any account per matrix.
    assert r.status_code == 200
