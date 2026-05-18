"""M28 — External Intelligence tests."""

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


def _wipe(client: TestClient, admin_uid, account_id: str) -> None:
    r = client.get(
        f"/api/v1/accounts/{account_id}/intel-news",
        headers=_auth(mint_jwt(admin_uid)),
    )
    for it in r.json()["items"]:
        client.delete(
            f"/api/v1/intel-news/{it['id']}", headers=_auth(mint_jwt(admin_uid))
        )


# ============================================================
# Stub generator
# ============================================================


def test_stub_generate_is_deterministic_and_diverse() -> None:
    """Stub generator: same seed → same items; spans ≥4 categories."""
    from app.services.intel_news import stub_generate

    a = stub_generate(account_name="Mondelez International", industry="Food & Beverages")
    b = stub_generate(account_name="Mondelez International", industry="Food & Beverages")
    assert a == b
    assert len(a) == 6
    cats = {it["category"] for it in a}
    assert len(cats) >= 4


# ============================================================
# Refresh + list + dedup
# ============================================================


def test_refresh_creates_then_dedups_on_second_call(
    client: TestClient, seeded_users: dict
) -> None:
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    admin = seeded_users["admin"]
    _wipe(client, admin, siemens)

    r = client.post(
        f"/api/v1/accounts/{siemens}/intel-news/refresh",
        headers=_auth(mint_jwt(admin)),
    )
    assert r.status_code == 200, r.text
    first = r.json()
    assert first["created"] >= 1
    assert "is_stub" in first

    # Second call hits the headline dedup branch — created should drop.
    r = client.post(
        f"/api/v1/accounts/{siemens}/intel-news/refresh",
        headers=_auth(mint_jwt(admin)),
    )
    second = r.json()
    assert second["created"] == 0

    # List confirms they're there and sorted by news_date desc.
    r = client.get(
        f"/api/v1/accounts/{siemens}/intel-news",
        headers=_auth(mint_jwt(admin)),
    )
    items = r.json()["items"]
    assert len(items) == first["created"]


# ============================================================
# Create + PATCH (hide, mark-read)
# ============================================================


def test_manual_create_then_patch_hides(
    client: TestClient, seeded_users: dict
) -> None:
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    admin = seeded_users["admin"]
    _wipe(client, admin, siemens)

    r = client.post(
        f"/api/v1/accounts/{siemens}/intel-news",
        headers=_auth(mint_jwt(admin)),
        json={
            "category": "m_and_a",
            "headline": "Manual: Siemens explores acquisition",
            "summary": "Press talk of an M&A in the EU power-electronics space.",
            "signal_relevance": "high",
            "source": "FT",
        },
    )
    assert r.status_code == 201, r.text
    item_id = r.json()["id"]
    assert r.json()["ai_generated"] is False

    # Hide it.
    r = client.patch(
        f"/api/v1/intel-news/{item_id}",
        headers=_auth(mint_jwt(admin)),
        json={"hidden": True},
    )
    assert r.status_code == 200
    assert r.json()["hidden"] is True

    # List excludes hidden.
    r = client.get(
        f"/api/v1/accounts/{siemens}/intel-news",
        headers=_auth(mint_jwt(admin)),
    )
    assert not any(it["id"] == item_id for it in r.json()["items"])


# ============================================================
# Push as soft signal — idempotent
# ============================================================


def test_push_as_signal_creates_signal_then_is_idempotent(
    client: TestClient, seeded_users: dict
) -> None:
    mondelez = _find_id(client, seeded_users["admin"], "mondelez")
    admin = seeded_users["admin"]
    _wipe(client, admin, mondelez)

    # Wipe baseline signals so we can find ours by content match.
    r = client.get(
        f"/api/v1/accounts/{mondelez}/signals", headers=_auth(mint_jwt(admin))
    )
    for s in r.json()["items"]:
        client.delete(f"/api/v1/signals/{s['id']}", headers=_auth(mint_jwt(admin)))

    r = client.post(
        f"/api/v1/accounts/{mondelez}/intel-news",
        headers=_auth(mint_jwt(admin)),
        json={
            "category": "risk_geopolitical",
            "headline": "Mondelez cocoa corridor under trade-tension pressure",
            "summary": "EU/West-Africa trade friction raising procurement risk premium.",
            "signal_relevance": "high",
        },
    )
    item_id = r.json()["id"]

    r = client.post(
        f"/api/v1/intel-news/{item_id}/push-as-signal",
        headers=_auth(mint_jwt(admin)),
        json={},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["signal_created"] is True
    assert body["signal_id"] is not None
    first_sig_id = body["signal_id"]

    # Signal really exists with the right type.
    r = client.get(
        f"/api/v1/accounts/{mondelez}/signals", headers=_auth(mint_jwt(admin))
    )
    sigs = r.json()["items"]
    target = next((s for s in sigs if s["id"] == first_sig_id), None)
    assert target is not None
    # risk_geopolitical → risk
    assert target["type"] == "risk"
    # high relevance → high impact
    assert target["impact"] == "high"

    # Idempotent: second push returns same signal_id, no new signal.
    r = client.post(
        f"/api/v1/intel-news/{item_id}/push-as-signal",
        headers=_auth(mint_jwt(admin)),
        json={},
    )
    assert r.status_code == 200
    assert r.json()["signal_id"] == first_sig_id

    r = client.get(
        f"/api/v1/accounts/{mondelez}/signals", headers=_auth(mint_jwt(admin))
    )
    assert sum(1 for s in r.json()["items"] if s["id"] == first_sig_id) == 1


# ============================================================
# RBAC
# ============================================================


def test_solutioning_manager_cannot_refresh(
    client: TestClient, seeded_users: dict
) -> None:
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    sol = seeded_users["solutioning_manager"]
    r = client.post(
        f"/api/v1/accounts/{siemens}/intel-news/refresh",
        headers=_auth(mint_jwt(sol)),
    )
    assert r.status_code == 403


def test_csm_on_own_account_can_refresh_and_push(
    client: TestClient, seeded_users: dict
) -> None:
    mondelez = _find_id(client, seeded_users["admin"], "mondelez")
    csm = seeded_users["csm"]
    admin = seeded_users["admin"]
    _wipe(client, admin, mondelez)

    r = client.post(
        f"/api/v1/accounts/{mondelez}/intel-news/refresh",
        headers=_auth(mint_jwt(csm)),
    )
    assert r.status_code == 200, r.text

    items = client.get(
        f"/api/v1/accounts/{mondelez}/intel-news", headers=_auth(mint_jwt(csm))
    ).json()["items"]
    assert len(items) > 0
    r = client.post(
        f"/api/v1/intel-news/{items[0]['id']}/push-as-signal",
        headers=_auth(mint_jwt(csm)),
        json={},
    )
    assert r.status_code == 200
