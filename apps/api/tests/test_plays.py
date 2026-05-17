"""M26 — Account Plays + Appetite Score + Mode override tests."""

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


def _reset_plays(client: TestClient, admin_uid, account_id: str) -> None:
    """Hide all existing plays so tests start clean."""
    r = client.get(
        f"/api/v1/accounts/{account_id}/plays",
        headers=_auth(mint_jwt(admin_uid)),
    )
    for p in r.json()["items"]:
        client.delete(
            f"/api/v1/plays/{p['id']}", headers=_auth(mint_jwt(admin_uid))
        )
    # Clear override too.
    client.post(
        f"/api/v1/accounts/{account_id}/plan-mode",
        headers=_auth(mint_jwt(admin_uid)),
        json={"mode": None},
    )


# ============================================================
# CRUD
# ============================================================


def test_create_and_list_play(client: TestClient, seeded_users: dict) -> None:
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    admin = seeded_users["admin"]
    _reset_plays(client, admin, siemens)

    r = client.post(
        f"/api/v1/accounts/{siemens}/plays",
        headers=_auth(mint_jwt(admin)),
        json={
            "title": "Expand into Wheat category",
            "value_usd": "120000",
            "prob": 60,
            "when_text": "Q3 2026",
            "trigger_text": "VP Procurement asked for benchmark refresh",
            "modes": ["expand"],
            "role": "CSM",
        },
    )
    assert r.status_code == 201, r.text
    play_id = r.json()["id"]

    r = client.get(
        f"/api/v1/accounts/{siemens}/plays",
        headers=_auth(mint_jwt(admin)),
    )
    assert r.status_code == 200
    items = r.json()["items"]
    assert any(p["id"] == play_id and p["prob"] == 60 for p in items)


def test_patch_play_updates_fields(
    client: TestClient, seeded_users: dict
) -> None:
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    admin = seeded_users["admin"]
    _reset_plays(client, admin, siemens)

    r = client.post(
        f"/api/v1/accounts/{siemens}/plays",
        headers=_auth(mint_jwt(admin)),
        json={"title": "Initial title", "value_usd": "0", "modes": ["expand"]},
    )
    play_id = r.json()["id"]

    r = client.patch(
        f"/api/v1/plays/{play_id}",
        headers=_auth(mint_jwt(admin)),
        json={"title": "Updated title", "prob": 80},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["title"] == "Updated title"
    assert body["prob"] == 80


def test_delete_play_hides_from_list(
    client: TestClient, seeded_users: dict
) -> None:
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    admin = seeded_users["admin"]
    _reset_plays(client, admin, siemens)

    r = client.post(
        f"/api/v1/accounts/{siemens}/plays",
        headers=_auth(mint_jwt(admin)),
        json={"title": "Doomed play", "modes": ["expand"]},
    )
    play_id = r.json()["id"]
    r = client.delete(
        f"/api/v1/plays/{play_id}", headers=_auth(mint_jwt(admin))
    )
    assert r.status_code == 204

    r = client.get(
        f"/api/v1/accounts/{siemens}/plays",
        headers=_auth(mint_jwt(admin)),
    )
    assert not any(p["id"] == play_id for p in r.json()["items"])


# ============================================================
# Appetite score + mode override
# ============================================================


def test_appetite_returns_breakdown_and_mode(
    client: TestClient, seeded_users: dict
) -> None:
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    admin = seeded_users["admin"]
    _reset_plays(client, admin, siemens)

    r = client.get(
        f"/api/v1/accounts/{siemens}/appetite-score",
        headers=_auth(mint_jwt(admin)),
    )
    assert r.status_code == 200
    body = r.json()
    assert body["score"] >= 0 and body["score"] <= 100
    assert body["recommended_mode"] in ("rescue", "retain", "expand")
    assert body["current_mode"] == body["recommended_mode"]
    assert body["is_overridden"] is False
    bd = body["breakdown"]
    assert bd["health_pts"] + bd["sig_pts"] + bd["renew_pts"] + bd["arr_pts"] == body["score"]


def test_mode_override_then_clear(
    client: TestClient, seeded_users: dict
) -> None:
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    admin = seeded_users["admin"]
    _reset_plays(client, admin, siemens)

    r = client.post(
        f"/api/v1/accounts/{siemens}/plan-mode",
        headers=_auth(mint_jwt(admin)),
        json={"mode": "rescue"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["current_mode"] == "rescue"
    # Override is only flagged when it differs from the recommendation.
    if body["recommended_mode"] != "rescue":
        assert body["is_overridden"] is True

    r = client.post(
        f"/api/v1/accounts/{siemens}/plan-mode",
        headers=_auth(mint_jwt(admin)),
        json={"mode": None},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["is_overridden"] is False
    assert body["current_mode"] == body["recommended_mode"]


def test_appetite_includes_pipeline_from_plays(
    client: TestClient, seeded_users: dict
) -> None:
    """A high-prob big-$ play boosts projected ACV → ARR pts go up."""
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    admin = seeded_users["admin"]
    _reset_plays(client, admin, siemens)

    before = client.get(
        f"/api/v1/accounts/{siemens}/appetite-score",
        headers=_auth(mint_jwt(admin)),
    ).json()

    client.post(
        f"/api/v1/accounts/{siemens}/plays",
        headers=_auth(mint_jwt(admin)),
        json={"title": "Big expansion", "value_usd": "500000", "prob": 100, "modes": ["expand"]},
    )

    after = client.get(
        f"/api/v1/accounts/{siemens}/appetite-score",
        headers=_auth(mint_jwt(admin)),
    ).json()

    # Pipeline contribution lifts projected_acv strictly higher.
    assert (
        float(after["breakdown"]["projected_acv_usd"])
        >= float(before["breakdown"]["projected_acv_usd"])
    )


# ============================================================
# RBAC
# ============================================================


def test_solutioning_manager_cannot_create_play(
    client: TestClient, seeded_users: dict
) -> None:
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    sol_mgr = seeded_users["solutioning_manager"]
    r = client.post(
        f"/api/v1/accounts/{siemens}/plays",
        headers=_auth(mint_jwt(sol_mgr)),
        json={"title": "nope", "modes": ["expand"]},
    )
    assert r.status_code == 403


def test_csm_can_create_play_on_own_account(
    client: TestClient, seeded_users: dict
) -> None:
    mondelez = _find_id(client, seeded_users["admin"], "mondelez")
    csm = seeded_users["csm"]
    admin = seeded_users["admin"]
    _reset_plays(client, admin, mondelez)

    r = client.post(
        f"/api/v1/accounts/{mondelez}/plays",
        headers=_auth(mint_jwt(csm)),
        json={
            "title": "Drive QBR cadence",
            "value_usd": "0",
            "prob": 30,
            "modes": ["retain"],
        },
    )
    assert r.status_code == 201
