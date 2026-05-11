"""M12 — Pre-Meeting Brief (MOM) endpoints + JSONB shape validation."""

from __future__ import annotations

from fastapi.testclient import TestClient

from .conftest import mint_jwt


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _find_id(client: TestClient, admin_uid, slug: str) -> str:
    r = client.get(f"/api/v1/accounts?q={slug}", headers=_auth(mint_jwt(admin_uid)))
    return r.json()["items"][0]["id"]


def _reset_brief(client: TestClient, admin_uid, account_id: str) -> None:
    """DELETE so each test sees a blank brief."""
    client.delete(
        f"/api/v1/accounts/{account_id}/meeting-brief",
        headers=_auth(mint_jwt(admin_uid)),
    )


# ============================================================
# GET returns a blank brief when no row exists yet
# ============================================================


def test_brief_blank_get_returns_empty_arrays(
    client: TestClient, seeded_users: dict
) -> None:
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    admin = seeded_users["admin"]
    _reset_brief(client, admin, siemens)

    r = client.get(
        f"/api/v1/accounts/{siemens}/meeting-brief",
        headers=_auth(mint_jwt(admin)),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    for coll in (
        "company_snapshot", "call_timer", "attendees", "minefields", "objectives",
        "discovery_questions", "value_anchors", "email_insights", "public_signals",
        "news", "annual_reports", "closing_scenarios",
        "cheat_sheet_never_say", "cheat_sheet_opening_asks",
    ):
        assert body[coll] == [], f"{coll} should be empty on blank brief"
    assert body["call_type"] is None
    assert body["win_condition"] is None
    assert body["is_editable"] is True


# ============================================================
# Whole-document PATCH roundtrip across all JSONB collections
# ============================================================


def test_brief_full_patch_roundtrip(client: TestClient, seeded_users: dict) -> None:
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    admin = seeded_users["admin"]
    _reset_brief(client, admin, siemens)

    payload = {
        "call_type": "first_discovery",
        "call_date": "2026-06-01",
        "call_time": "10:00–11:00 AM CET",
        "call_platform": "Microsoft Teams",
        "call_duration_minutes": 60,
        "win_condition": "Get a 2-week trial on copper / aluminium / REE.",
        "cheat_sheet_win_condition_short": "Earn the trial.",
        "company_snapshot": [
            {"num": "€96B", "label": "Annual revenue", "sub": "FY 2024"},
            {"num": "100k", "label": "Employees", "sub": None},
        ],
        "call_timer": [
            {"time": "0:00–8:00", "label": "Intros"},
            {"time": "8:00–25:00", "label": "Discovery"},
        ],
        "attendees": [
            {
                "initials": "KR",
                "name": "Dr. Klaus Richter",
                "role": "CPO",
                "company": "client",
                "is_self": False,
                "avatar_color": "#001137",
                "objectives": ["Cost Savings"],
                "primary_objective": "Cost Savings",
                "background": ["Final sign-off", "Strategic thinker"],
                "opening_ask": "What's the one thing none of your current vendors get right?",
            },
            {
                "initials": "AC",
                "name": "Alekh Chatterji",
                "role": "Sales",
                "company": "beroe",
                "is_self": True,
                "avatar_color": None,
                "objectives": [],
                "primary_objective": None,
                "background": ["Lead the discovery"],
                "opening_ask": None,
            },
        ],
        "minefields": [
            {
                "severity": "high",
                "type": "Competitive",
                "text": "Do not reference Wood Mackenzie directly",
                "why": "Gunter likely has an existing contract.",
            },
        ],
        "objectives": [
            {
                "rank": 1,
                "name": "Commodity Price Intelligence",
                "confidence": 5,
                "bullets": ["Copper + aluminium top spend", "Need 3–6 month forecasts"],
                "beroe": "Same-day intelligence with forward forecasts.",
                "sources": [],
            }
        ],
        "discovery_questions": [
            {
                "objective": "Commodity Price Intelligence",
                "rank": 1,
                "person": "Gunter Braun",
                "from_email": False,
                "text": "How far ahead do you have reliable price forecasts?",
            }
        ],
        "value_anchors": [
            {
                "objective": "Commodity Price Intelligence",
                "points": [
                    {
                        "text": "Beroe's copper forecasts within 3% accuracy 8 quarters running.",
                        "note": "Energy-sector reference",
                    }
                ],
            }
        ],
        "email_insights": [
            {"meta": "Gunter — May 18", "bullets": ["Wants ROI in 6 months"]}
        ],
        "public_signals": [
            {
                "person": "Dr. Richter",
                "headline": "Posted about nearshoring",
                "text": "Strategic shift into Eastern Europe",
                "url": "https://linkedin.com/example",
                "tag": "LinkedIn",
            }
        ],
        "news": [
            {
                "days_ago": 7,
                "headline": "Siemens Energy reports record orders",
                "source": "Bloomberg",
                "signal": "Procurement scale-up likely.",
                "url": None,
                "tag": "Earnings",
            }
        ],
        "annual_reports": [
            {
                "title": "Siemens Energy AR 2024",
                "year": 2024,
                "url": None,
                "bullets": ["Net zero target 2035", "Grid investment up 12%"],
            }
        ],
        "closing_scenarios": [
            {"type": "good", "label": "Strong close", "text": "2-week trial agreed."},
            {"type": "neutral", "label": None, "text": "Coverage sample requested."},
            {"type": "poor", "label": None, "text": "Defer to procurement review."},
        ],
        "cheat_sheet_never_say": ["Wood Mackenzie", "Fastmarkets"],
        "cheat_sheet_opening_asks": [
            "What's the one thing none of your current vendors get right?"
        ],
    }
    r = client.patch(
        f"/api/v1/accounts/{siemens}/meeting-brief",
        headers=_auth(mint_jwt(admin)),
        json=payload,
    )
    assert r.status_code == 200, r.text
    body = r.json()

    # Spot-check every collection survived the roundtrip with structure intact.
    assert body["call_type"] == "first_discovery"
    assert body["call_date"] == "2026-06-01"
    assert body["call_duration_minutes"] == 60
    assert len(body["attendees"]) == 2
    assert body["attendees"][0]["initials"] == "KR"
    assert body["attendees"][0]["objectives"] == ["Cost Savings"]
    assert body["attendees"][1]["is_self"] is True
    assert body["minefields"][0]["severity"] == "high"
    assert body["objectives"][0]["confidence"] == 5
    assert body["objectives"][0]["bullets"] == ["Copper + aluminium top spend", "Need 3–6 month forecasts"]
    assert body["discovery_questions"][0]["from_email"] is False
    assert body["value_anchors"][0]["points"][0]["note"] == "Energy-sector reference"
    assert body["news"][0]["days_ago"] == 7
    assert body["annual_reports"][0]["year"] == 2024
    assert len(body["closing_scenarios"]) == 3
    assert body["cheat_sheet_never_say"] == ["Wood Mackenzie", "Fastmarkets"]

    # Re-fetch to confirm persistence (not just echo).
    g = client.get(
        f"/api/v1/accounts/{siemens}/meeting-brief",
        headers=_auth(mint_jwt(admin)),
    )
    g_body = g.json()
    assert g_body["attendees"] == body["attendees"]
    assert g_body["objectives"] == body["objectives"]

    _reset_brief(client, admin, siemens)


# ============================================================
# Validation rejects malformed JSONB rows
# ============================================================


def test_brief_invalid_severity_rejected(
    client: TestClient, seeded_users: dict
) -> None:
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    r = client.patch(
        f"/api/v1/accounts/{siemens}/meeting-brief",
        headers=_auth(mint_jwt(seeded_users["admin"])),
        json={
            "minefields": [
                {"severity": "extreme", "type": "Bad", "text": "x", "why": None}
            ]
        },
    )
    assert r.status_code == 422


def test_brief_invalid_confidence_rejected(
    client: TestClient, seeded_users: dict
) -> None:
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    r = client.patch(
        f"/api/v1/accounts/{siemens}/meeting-brief",
        headers=_auth(mint_jwt(seeded_users["admin"])),
        json={
            "objectives": [
                {
                    "rank": 1,
                    "name": "Bad",
                    "confidence": 9,  # > 5
                    "bullets": [],
                    "beroe": None,
                    "sources": [],
                }
            ]
        },
    )
    assert r.status_code == 422


def test_brief_invalid_call_type_rejected(
    client: TestClient, seeded_users: dict
) -> None:
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    r = client.patch(
        f"/api/v1/accounts/{siemens}/meeting-brief",
        headers=_auth(mint_jwt(seeded_users["admin"])),
        json={"call_type": "casual_chat"},
    )
    assert r.status_code == 422


# ============================================================
# RBAC: solutioning_manager can edit (matches engagement-write rule),
# CSM cannot edit on accounts they don't own.
# ============================================================


def test_brief_solutioning_can_edit(client: TestClient, seeded_users: dict) -> None:
    """Matrix: solutioning team is part of the Pre-Sales write set."""
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    _reset_brief(client, seeded_users["admin"], siemens)
    r = client.patch(
        f"/api/v1/accounts/{siemens}/meeting-brief",
        headers=_auth(mint_jwt(seeded_users["solutioning_manager"])),
        json={"win_condition": "Trial on copper."},
    )
    assert r.status_code == 200, r.text
    assert r.json()["win_condition"] == "Trial on copper."
    _reset_brief(client, seeded_users["admin"], siemens)


def test_brief_csm_readonly_on_other_csm(
    client: TestClient, seeded_users: dict
) -> None:
    """Harish (csm) is not the owning CSM on Sanofi — view yes, edit no."""
    sanofi = _find_id(client, seeded_users["admin"], "sanofi")
    g = client.get(
        f"/api/v1/accounts/{sanofi}/meeting-brief",
        headers=_auth(mint_jwt(seeded_users["csm"])),
    )
    assert g.status_code == 200
    assert g.json()["is_editable"] is False

    r = client.patch(
        f"/api/v1/accounts/{sanofi}/meeting-brief",
        headers=_auth(mint_jwt(seeded_users["csm"])),
        json={"win_condition": "Should fail."},
    )
    assert r.status_code == 403


# ============================================================
# DELETE clears the entire brief
# ============================================================


def test_brief_delete_clears(client: TestClient, seeded_users: dict) -> None:
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    admin = seeded_users["admin"]
    # Seed something first.
    client.patch(
        f"/api/v1/accounts/{siemens}/meeting-brief",
        headers=_auth(mint_jwt(admin)),
        json={"win_condition": "Some win."},
    )

    r = client.delete(
        f"/api/v1/accounts/{siemens}/meeting-brief",
        headers=_auth(mint_jwt(admin)),
    )
    assert r.status_code == 204

    g = client.get(
        f"/api/v1/accounts/{siemens}/meeting-brief",
        headers=_auth(mint_jwt(admin)),
    )
    # Blank brief returned, win_condition is gone.
    assert g.json()["win_condition"] is None


def test_brief_delete_forbidden_for_csm_on_other(
    client: TestClient, seeded_users: dict
) -> None:
    sanofi = _find_id(client, seeded_users["admin"], "sanofi")
    r = client.delete(
        f"/api/v1/accounts/{sanofi}/meeting-brief",
        headers=_auth(mint_jwt(seeded_users["csm"])),
    )
    assert r.status_code == 403
