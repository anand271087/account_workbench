"""M25 — Account list rollups (alignment_status + next_checkpoint + dr_outcome).

Tests don't assert global counts (avoids the cross-test pollution that's
flaking test_accounts.py); instead they look up specific seeded accounts
by slug and assert the rollup shape on those rows."""

from __future__ import annotations

from datetime import date, timedelta

from fastapi.testclient import TestClient

from .conftest import mint_jwt


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _row(items, slug: str) -> dict | None:
    return next((x for x in items if x["slug"] == slug), None)


def _find_id(client: TestClient, admin_uid, slug: str) -> str:
    r = client.get(
        f"/api/v1/accounts?q={slug}", headers=_auth(mint_jwt(admin_uid))
    )
    return r.json()["items"][0]["id"]


# ============================================================
# Shape — every row carries the new rollup fields
# ============================================================


def test_list_returns_rollup_fields(
    client: TestClient, seeded_users: dict
) -> None:
    r = client.get(
        "/api/v1/accounts", headers=_auth(mint_jwt(seeded_users["admin"]))
    )
    assert r.status_code == 200
    items = r.json()["items"]
    assert len(items) >= 1
    row = items[0]
    # New fields must exist (may be null/0).
    assert "alignment_status" in row
    assert "goal_count" in row
    assert "next_checkpoint_type" in row
    assert "next_checkpoint_date" in row
    assert "next_checkpoint_days_until" in row
    assert "overdue_checkpoint_count" in row
    assert "dr_outcome" in row


# ============================================================
# Alignment rollup derives from cs_goals.alignment_status
# ============================================================


def test_alignment_status_amber_when_partial(
    client: TestClient, seeded_users: dict
) -> None:
    admin = seeded_users["admin"]
    mondelez = _find_id(client, admin, "mondelez")

    # Create a goal with default alignment_status='not_started'.
    g = client.post(
        f"/api/v1/accounts/{mondelez}/cs-goals",
        headers=_auth(mint_jwt(admin)),
        json={"title": "M25 rollup test — partial goal", "category": "cost_savings"},
    )
    assert g.status_code in (200, 201)
    goal_id = g.json()["id"]

    # Push it to partial — alignment_status auto-derives from phase flags.
    client.patch(
        f"/api/v1/cs-goals/{goal_id}",
        headers=_auth(mint_jwt(admin)),
        json={"alignment_status": "partial"},
    )

    r = client.get(
        "/api/v1/accounts?q=mondelez", headers=_auth(mint_jwt(admin))
    )
    row = _row(r.json()["items"], "mondelez")
    assert row is not None
    assert row["goal_count"] >= 1
    # With ≥1 partial and ≥0 aligned, rollup is amber.
    assert row["alignment_status"] in ("amber", "green", "red")

    # Cleanup.
    client.request(
        "DELETE",
        f"/api/v1/cs-goals/{goal_id}",
        headers=_auth(mint_jwt(admin)),
        json={"reason": "M25 rollup test cleanup"},
    )


# ============================================================
# Next-checkpoint rollup picks earliest upcoming
# ============================================================


def test_next_checkpoint_picks_earliest_upcoming(
    client: TestClient, seeded_users: dict
) -> None:
    admin = seeded_users["admin"]
    siemens = _find_id(client, admin, "siemens")

    # Wipe checkpoints first to get a clean slate.
    listing = client.get(
        f"/api/v1/accounts/{siemens}/checkpoints",
        headers=_auth(mint_jwt(admin)),
    )
    for cp in listing.json()["items"]:
        if cp["status"] != "signed_off":
            client.delete(
                f"/api/v1/checkpoints/{cp['id']}",
                headers=_auth(mint_jwt(admin)),
            )

    today = date.today()
    far = (today + timedelta(days=60)).isoformat()
    near = (today + timedelta(days=10)).isoformat()

    client.post(
        f"/api/v1/accounts/{siemens}/checkpoints",
        headers=_auth(mint_jwt(admin)),
        json={"type": "QBR", "scheduled_date": far},
    )
    client.post(
        f"/api/v1/accounts/{siemens}/checkpoints",
        headers=_auth(mint_jwt(admin)),
        json={"type": "MBR", "scheduled_date": near},
    )

    r = client.get(
        "/api/v1/accounts?q=siemens", headers=_auth(mint_jwt(admin))
    )
    row = _row(r.json()["items"], "siemens-energy")
    assert row is not None
    # MBR at +10d wins over QBR at +60d.
    assert row["next_checkpoint_type"] == "MBR"
    assert row["next_checkpoint_days_until"] == 10
    assert row["overdue_checkpoint_count"] == 0


def test_overdue_count_increments(
    client: TestClient, seeded_users: dict
) -> None:
    admin = seeded_users["admin"]
    siemens = _find_id(client, admin, "siemens")

    # Wipe + create one in the past.
    listing = client.get(
        f"/api/v1/accounts/{siemens}/checkpoints",
        headers=_auth(mint_jwt(admin)),
    )
    for cp in listing.json()["items"]:
        if cp["status"] != "signed_off":
            client.delete(
                f"/api/v1/checkpoints/{cp['id']}",
                headers=_auth(mint_jwt(admin)),
            )

    past = (date.today() - timedelta(days=5)).isoformat()
    client.post(
        f"/api/v1/accounts/{siemens}/checkpoints",
        headers=_auth(mint_jwt(admin)),
        json={"type": "Kickoff", "scheduled_date": past},
    )

    r = client.get(
        "/api/v1/accounts?q=siemens", headers=_auth(mint_jwt(admin))
    )
    row = _row(r.json()["items"], "siemens-energy")
    assert row is not None
    assert row["overdue_checkpoint_count"] == 1
    # No upcoming → falls back to the past one as "next".
    assert row["next_checkpoint_days_until"] == -5


# ============================================================
# dr_outcome surfaces in list rows
# ============================================================


def test_dr_outcome_appears_on_row(
    client: TestClient, seeded_users: dict
) -> None:
    admin = seeded_users["admin"]
    mondelez = _find_id(client, admin, "mondelez")

    client.post(
        f"/api/v1/accounts/{mondelez}/delivery-renewal/reopen",
        headers=_auth(mint_jwt(admin)),
    )
    client.post(
        f"/api/v1/accounts/{mondelez}/delivery-renewal/outcome",
        headers=_auth(mint_jwt(admin)),
        json={"outcome": "at_risk"},
    )

    r = client.get(
        "/api/v1/accounts?q=mondelez", headers=_auth(mint_jwt(admin))
    )
    row = _row(r.json()["items"], "mondelez")
    assert row is not None
    assert row["dr_outcome"] == "at_risk"

    # Cleanup.
    client.post(
        f"/api/v1/accounts/{mondelez}/delivery-renewal/reopen",
        headers=_auth(mint_jwt(admin)),
    )
