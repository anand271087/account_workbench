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
    client: TestClient, seeded_users: dict, monkeypatch
) -> None:
    # The stub-fallback path was removed when GDELT shipped (real-only).
    # Patch the GDELT fetcher + classifier with deterministic fakes so the
    # route still produces predictable items for this RBAC + dedup test.
    from app.services import intel_news
    from app.services import llm as _llm_mod
    from app.services.claude import _doc_cache

    _doc_cache.clear()
    monkeypatch.setattr(_llm_mod, "is_configured", lambda: True)
    monkeypatch.setattr(_llm_mod, "backend_label", lambda: "test")
    monkeypatch.setattr(intel_news, "_GDELT_MIN_INTERVAL_S", 0.0)
    fake_articles = [
        {
            "title": "Siemens wins major grid contract in EU",
            "url": "https://example.test/siemens-grid",
            "domain": "example.test",
            "seendate": "2026-05-20",
            "country": "Germany",
        },
    ]
    monkeypatch.setattr(intel_news, "_fetch_gdelt_articles", lambda **kw: fake_articles)
    monkeypatch.setattr(
        intel_news,
        "_classify_gdelt_with_llm",
        lambda **kw: [
            {
                "category": "expansion_capex",
                "headline": fake_articles[0]["title"],
                "summary": "Grid contract win — sourcing should anticipate steel/copper draw.",
                "source": "example.test",
                "source_url": fake_articles[0]["url"],
                "news_date": "2026-05-20",
                "signal_relevance": "high",
                "ai_generated": True,
            }
        ],
    )

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

    # List confirms they're there.
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
    client: TestClient, seeded_users: dict, monkeypatch
) -> None:
    # Same fake-GDELT patch as the dedup test — exercises the RBAC + push
    # flow without needing real GDELT (which is rate-limited + non-deterministic).
    from app.services import intel_news
    from app.services import llm as _llm_mod
    from app.services.claude import _doc_cache

    _doc_cache.clear()
    monkeypatch.setattr(_llm_mod, "is_configured", lambda: True)
    monkeypatch.setattr(_llm_mod, "backend_label", lambda: "test")
    monkeypatch.setattr(intel_news, "_GDELT_MIN_INTERVAL_S", 0.0)
    monkeypatch.setattr(
        intel_news,
        "_fetch_gdelt_articles",
        lambda **kw: [
            {
                "title": "Mondelez signs cocoa-sustainability deal",
                "url": "https://example.test/mdlz-cocoa",
                "domain": "example.test",
                "seendate": "2026-05-20",
                "country": "United States",
            }
        ],
    )
    monkeypatch.setattr(
        intel_news,
        "_classify_gdelt_with_llm",
        lambda **kw: [
            {
                "category": "sustainability_esg",
                "headline": "Mondelez signs cocoa-sustainability deal",
                "summary": "ESG-aligned cocoa sourcing — locks supplier criteria for next-cycle RFPs.",
                "source": "example.test",
                "source_url": "https://example.test/mdlz-cocoa",
                "news_date": "2026-05-20",
                "signal_relevance": "medium",
                "ai_generated": True,
            }
        ],
    )

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


# ============================================================
# GDELT path — real headlines fed to Claude for classification
# ============================================================


def test_gdelt_path_succeeds_and_passes_to_classifier(monkeypatch) -> None:
    """GDELT returns articles → classifier enriches → generate_intel_news
    returns real headlines with AI-spun procurement summaries."""
    from datetime import date

    from app.services import intel_news

    monkeypatch.setattr(intel_news, "_gdelt_last_hit_at", 0.0)
    monkeypatch.setattr(intel_news, "_GDELT_MIN_INTERVAL_S", 0.0)

    fake_articles = [
        {
            "title": "Mondelez beats Q4 estimates with 12% organic growth",
            "url": "https://reuters.example/mdlz-q4",
            "domain": "reuters.example",
            "seendate": "2026-05-20",
            "country": "United States",
        },
        {
            "title": "Cocoa prices surge on West Africa supply concerns",
            "url": "https://ft.example/cocoa-spike",
            "domain": "ft.example",
            "seendate": "2026-05-18",
            "country": "United Kingdom",
        },
    ]
    monkeypatch.setattr(
        intel_news, "_fetch_gdelt_articles", lambda **kw: fake_articles
    )

    fake_classified = [
        {
            "category": "financial_performance",
            "headline": fake_articles[0]["title"],
            "summary": "Strong Q4 with organic growth — Mondelez has pricing power; sourcing strategy should optimise for input-cost stability over discount-chasing.",
            "source": "reuters.example",
            "source_url": fake_articles[0]["url"],
            "news_date": "2026-05-20",
            "signal_relevance": "high",
            "ai_generated": True,
        },
        {
            "category": "supply_chain",
            "headline": fake_articles[1]["title"],
            "summary": "Cocoa supply pressure in West Africa — Mondelez procurement should lock multi-source contracts and accelerate alt-supplier scouting.",
            "source": "ft.example",
            "source_url": fake_articles[1]["url"],
            "news_date": "2026-05-18",
            "signal_relevance": "high",
            "ai_generated": True,
        },
    ]
    monkeypatch.setattr(
        intel_news, "_classify_gdelt_with_llm", lambda **kw: fake_classified
    )

    from app.services import llm as _llm_mod

    monkeypatch.setattr(_llm_mod, "is_configured", lambda: True)
    monkeypatch.setattr(_llm_mod, "backend_label", lambda: "test")
    from app.services.claude import _doc_cache

    _doc_cache.clear()

    items, is_stub = intel_news.generate_intel_news(
        account_name="Mondelez International",
        industry="Consumer Goods",
        today=date(2026, 5, 26),
    )
    assert is_stub is False
    assert len(items) == 2
    assert items[0]["headline"] == fake_articles[0]["title"]
    assert items[0]["source_url"] == fake_articles[0]["url"]
    assert items[1]["category"] == "supply_chain"


def test_gdelt_empty_returns_empty_no_stub(monkeypatch) -> None:
    """GDELT returns 0 articles → generate_intel_news returns an empty list.
    No stub fallback — the UI shows an empty state instead of inventing news."""
    from datetime import date

    from app.services import intel_news

    monkeypatch.setattr(intel_news, "_gdelt_last_hit_at", 0.0)
    monkeypatch.setattr(intel_news, "_GDELT_MIN_INTERVAL_S", 0.0)
    monkeypatch.setattr(intel_news, "_fetch_gdelt_articles", lambda **kw: [])

    from app.services import llm as _llm_mod

    monkeypatch.setattr(_llm_mod, "is_configured", lambda: True)
    monkeypatch.setattr(_llm_mod, "backend_label", lambda: "test")
    from app.services.claude import _doc_cache

    _doc_cache.clear()

    items, is_stub = intel_news.generate_intel_news(
        account_name="Mondelez International",
        industry="Consumer Goods",
        today=date(2026, 5, 26),
    )
    assert items == []
    assert is_stub is False


def test_gdelt_parses_seendate_format() -> None:
    """GDELT seendate timestamps look like '20260520T142503Z' → 'YYYY-MM-DD'."""
    from app.services.intel_news import _parse_gdelt_seendate

    assert _parse_gdelt_seendate("20260520T142503Z") == "2026-05-20"
    assert _parse_gdelt_seendate("20260101T000000Z") == "2026-01-01"
    assert _parse_gdelt_seendate("") is None
    assert _parse_gdelt_seendate("not-a-date") is None
    assert _parse_gdelt_seendate("2025") is None  # too short


def test_gdelt_fetcher_blocks_non_json_response(monkeypatch) -> None:
    """If GDELT returns an HTML throttle page, fetcher returns [] rather
    than crashing on JSON parse."""
    from app.services import intel_news

    monkeypatch.setattr(intel_news, "_gdelt_last_hit_at", 0.0)
    monkeypatch.setattr(intel_news, "_GDELT_MIN_INTERVAL_S", 0.0)

    class FakeResp:
        status_code = 200
        headers = {"content-type": "text/html"}
        text = "Please limit requests to one every 5 seconds"

        def json(self) -> dict:
            raise ValueError("invalid json")

    monkeypatch.setattr(intel_news.httpx, "get", lambda *a, **kw: FakeResp())

    out = intel_news._fetch_gdelt_articles(account_name="Mondelez")
    assert out == []
