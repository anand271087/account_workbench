"""M15.1 — VPD candidate-goals extraction (stub) + downstream wire-up."""

from __future__ import annotations

from app.services.claude import (
    _classify_goal_category,
    _stub_cs_goals_extract,
    extract_cs_goals_from_vpd,
)


# ============================================================
# Category classifier
# ============================================================


def test_classify_goal_category_cost_savings() -> None:
    assert (
        _classify_goal_category("Save $2M annually on commodity procurement")
        == "cost_savings"
    )


def test_classify_goal_category_base_rationalization() -> None:
    assert (
        _classify_goal_category("Consolidate supplier base from 47 to 12 vendors")
        == "base_rationalization"
    )


def test_classify_goal_category_risk_mitigation() -> None:
    assert (
        _classify_goal_category("Mitigate single-source risk on critical inputs")
        == "risk_mitigation"
    )


def test_classify_goal_category_adoption() -> None:
    assert _classify_goal_category("Drive adoption across 5 categories") == "adoption"


def test_classify_goal_category_other_fallback() -> None:
    assert _classify_goal_category("Quarterly cadence meetings") == "other"


# ============================================================
# Stub extractor — deterministic
# ============================================================


def test_stub_extract_returns_goals_from_bullets() -> None:
    text = """
    Key outcomes:
    - Save 8-12% on cocoa, palm oil, and wheat through benchmark-driven negotiations
    - Reduce supplier base from 47 to 12 across packaging and ingredients
    - Mitigate single-source risk on three critical SKUs by Q3 2026
    - Improve adoption of the Beroe platform across the procurement team
    - quarterly cadence meetings  (low signal — should still be filtered, no outcome verb)
    - generic text
    """
    out = _stub_cs_goals_extract(text)
    assert out["is_stub"] is True
    titles = [g["title"] for g in out["goals"]]
    assert any("Save 8-12%" in t for t in titles)
    assert any("Reduce supplier base" in t for t in titles)
    assert any("Mitigate single-source risk" in t for t in titles)
    # Filler line is filtered out.
    assert not any("generic text" in t for t in titles)


def test_stub_extract_caps_at_six() -> None:
    text = "\n".join(f"- Save ${i}M on category {i}" for i in range(20))
    out = _stub_cs_goals_extract(text)
    assert len(out["goals"]) == 6


def test_stub_extract_classifies_each_goal() -> None:
    text = """
    - Save $5M on commodity contracts
    - Consolidate supplier base from 60 to 15
    - Mitigate compliance risk in EU operations
    - Drive platform adoption across 4 BUs
    """
    out = _stub_cs_goals_extract(text)
    cats = [g["category"] for g in out["goals"]]
    assert "cost_savings" in cats
    assert "base_rationalization" in cats
    assert "risk_mitigation" in cats
    assert "adoption" in cats


def test_stub_extract_empty_input_returns_empty_list() -> None:
    assert _stub_cs_goals_extract("")["goals"] == []
    assert _stub_cs_goals_extract("")["is_stub"] is True


# ============================================================
# Public entry point routes through stub when key isn't real
# ============================================================


def test_extract_cs_goals_falls_back_to_stub_without_real_key() -> None:
    """Default test config has no real Anthropic key → stub path."""
    out = extract_cs_goals_from_vpd(
        "- Save $2M on cocoa\n- Reduce supplier base from 47 to 12"
    )
    assert out["is_stub"] is True
    assert len(out["goals"]) == 2
