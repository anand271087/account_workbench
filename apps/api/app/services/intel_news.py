"""M28 — External Intelligence generation.

Two paths:

1. **Stub** — deterministic templated news items keyed on account name
   + industry. Used for demos / when no Anthropic key is configured.
   Produces 5–7 items spanning the 10-category space.
2. **Real Claude** — single completion that returns JSON-only news
   items. 24h cache keyed on `sha256(intel|account_name|industry)`.
   Falls back to stub on key absence or transient failure.
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
from datetime import date, timedelta
from typing import Any

from app.core.config import get_settings
from app.services.claude import (
    _JSON_FENCE_RE,
    _JSON_OBJECT_RE,
    _doc_cache,
    _is_transient_anthropic_error,
    _key_looks_real,
    _truncate_for_prompt,
)

logger = logging.getLogger(__name__)

_REAL_CACHE_TTL_SECONDS = 24 * 60 * 60

_CATEGORIES = (
    "financial_performance",
    "supply_chain",
    "supplier_strategy",
    "expansion_capex",
    "regulatory_compliance",
    "sustainability_esg",
    "digital_transformation",
    "risk_geopolitical",
    "product_innovation",
    "m_and_a",
)

# Stub templates per category — `{name}` and `{industry}` get substituted.
_STUB_TEMPLATES: dict[str, tuple[str, str, str]] = {
    "financial_performance": (
        "{name} reports Q3 cost pressure on raw materials",
        "Procurement spend at {name} flagged 8–12% above benchmark on key {industry} inputs. CFO commentary in latest earnings notes margin compression in core categories.",
        "Reuters",
    ),
    "supply_chain": (
        "{name} flags two-tier supplier risk in core categories",
        "Internal supply continuity review at {name} surfaced single-source exposure on three SKUs. Likely creates appetite for alternate-supplier scouting in {industry}.",
        "Industry Week",
    ),
    "supplier_strategy": (
        "{name} consolidates supplier panel — RFP cycle starts Q4",
        "Strategic sourcing team at {name} is rationalising the supplier base across {industry} categories. Expect new vendors invited to a structured RFP this quarter.",
        "Spend Matters",
    ),
    "expansion_capex": (
        "{name} announces capacity expansion in APAC",
        "{name} confirmed a multi-year capex programme into APAC operations. New production lines coming online in 2026; sourcing footprint will follow.",
        "Bloomberg",
    ),
    "regulatory_compliance": (
        "New {industry} import regulation tightens compliance burden",
        "Regulator published draft requirements affecting {name}'s {industry} supplier audits. Compliance team will need updated benchmarks before the rule lands.",
        "Compliance Week",
    ),
    "sustainability_esg": (
        "{name} commits to Scope-3 reduction target",
        "{name} published its sustainability roadmap with Scope-3 milestones across its {industry} value chain. Supplier ESG scoring will be embedded into next-cycle RFPs.",
        "GreenBiz",
    ),
    "digital_transformation": (
        "{name} kicks off procurement-tech refresh",
        "Procurement function at {name} is evaluating spend-analytics and intake-orchestration platforms. RFP shortlist expected by Q1.",
        "ProcureCon",
    ),
    "risk_geopolitical": (
        "Geopolitical exposure in {name}'s sourcing corridor flagged",
        "Trade tensions in a key {industry} sourcing region are raising the risk premium on supplier contracts touching {name}. Risk team likely re-pricing scenarios.",
        "FT",
    ),
    "product_innovation": (
        "{name} launches new product line in {industry}",
        "{name} announced an innovation roadmap with three new SKUs entering pilot. Material composition shift may open whitespace for category benchmarks.",
        "TechCrunch",
    ),
    "m_and_a": (
        "{name} explores bolt-on acquisition in {industry} space",
        "Press reports suggest {name} is in early-stage talks for a strategic acquisition. Integration would expand the addressable spend footprint by 15–20%.",
        "Reuters M&A",
    ),
}

_RELEVANCE_BY_CATEGORY = {
    "financial_performance": "high",
    "supply_chain": "high",
    "risk_geopolitical": "high",
    "expansion_capex": "medium",
    "supplier_strategy": "medium",
    "regulatory_compliance": "medium",
    "digital_transformation": "medium",
    "sustainability_esg": "low",
    "product_innovation": "low",
    "m_and_a": "high",
}


def stub_generate(
    *,
    account_name: str,
    industry: str | None,
    today: date | None = None,
) -> list[dict[str, Any]]:
    """Produce 5–7 deterministic news items spanning the category space.

    Seed: hash of account_name. Same account → same items every call →
    integration tests can assert stable shape."""
    today = today or date.today()
    seed_int = int(hashlib.sha256(account_name.encode()).hexdigest()[:8], 16)
    industry_label = industry or "procurement"
    # Pick 6 of the 10 categories deterministically from the seed.
    rotated = _CATEGORIES[seed_int % len(_CATEGORIES):] + _CATEGORIES[: seed_int % len(_CATEGORIES)]
    picks = list(rotated[:6])
    out: list[dict[str, Any]] = []
    for offset, cat in enumerate(picks):
        headline_tpl, summary_tpl, source = _STUB_TEMPLATES[cat]
        out.append(
            {
                "category": cat,
                "headline": headline_tpl.format(name=account_name, industry=industry_label),
                "summary": summary_tpl.format(name=account_name, industry=industry_label),
                "source": source,
                "source_url": None,
                "news_date": (today - timedelta(days=offset * 3)).isoformat(),
                "signal_relevance": _RELEVANCE_BY_CATEGORY.get(cat, "medium"),
                "ai_generated": True,
            }
        )
    return out


def _real_generate(
    *,
    account_name: str,
    industry: str | None,
    today: date,
) -> list[dict[str, Any]]:
    """One Claude call → 6 news items as structured JSON."""
    settings = get_settings()
    from anthropic import Anthropic  # type: ignore

    client = Anthropic(api_key=settings.anthropic_api_key.get_secret_value())
    industry_label = industry or "procurement"
    msg = client.messages.create(
        model=settings.anthropic_model,
        max_tokens=1800,
        system=(
            "You write concise market-intelligence items for a customer-success "
            "team monitoring an account's external environment.\n\n"
            "Output ONLY a JSON object — no markdown, no fences. Schema:\n"
            "{\n"
            '  "items": [\n'
            "    {\n"
            '      "category": <one of '
            "financial_performance | supply_chain | supplier_strategy | "
            "expansion_capex | regulatory_compliance | sustainability_esg | "
            "digital_transformation | risk_geopolitical | product_innovation | m_and_a"
            ">,\n"
            '      "headline": <≤120 chars>,\n'
            '      "summary": <≤300 chars, plain text>,\n'
            '      "source": <publication name or null>,\n'
            '      "source_url": <URL or null>,\n'
            '      "news_date": <ISO YYYY-MM-DD>,\n'
            '      "signal_relevance": <high | medium | low>\n'
            "    }\n"
            "  ]\n"
            "}\n"
            "Rules:\n"
            "  - Generate 6 distinct items spanning at least 4 different categories.\n"
            "  - All news_date values within the last 60 days, none in the future.\n"
            "  - Use real plausible publication names. No fabricated URLs (null instead).\n"
            "  - signal_relevance must reflect how directly the item affects the\n"
            "    account's procurement / sourcing posture.\n"
            "  - No filler. No prose outside the JSON."
        ),
        messages=[
            {
                "role": "user",
                "content": _truncate_for_prompt(
                    f"Account name: {account_name}\nIndustry: {industry_label}\n"
                    f"Today's date: {today.isoformat()}"
                ),
            }
        ],
    )
    raw = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")
    cleaned = _JSON_FENCE_RE.sub("", raw).strip()
    m = _JSON_OBJECT_RE.search(cleaned)
    candidate = m.group(0) if m else cleaned
    try:
        parsed = json.loads(candidate)
    except (json.JSONDecodeError, ValueError):
        return stub_generate(account_name=account_name, industry=industry, today=today)

    out: list[dict[str, Any]] = []
    for it in (parsed.get("items") or [])[:8]:
        if not isinstance(it, dict):
            continue
        cat = (it.get("category") or "").strip()
        if cat not in _CATEGORIES:
            continue
        head = (it.get("headline") or "").strip()
        if not head:
            continue
        rel = it.get("signal_relevance")
        if rel not in ("high", "medium", "low"):
            rel = _RELEVANCE_BY_CATEGORY.get(cat, "medium")
        out.append(
            {
                "category": cat,
                "headline": head[:400],
                "summary": (it.get("summary") or "").strip()[:2000] or None,
                "source": (it.get("source") or "").strip()[:240] or None,
                "source_url": (it.get("source_url") or None),
                "news_date": it.get("news_date") or today.isoformat(),
                "signal_relevance": rel,
                "ai_generated": True,
            }
        )
    return out or stub_generate(account_name=account_name, industry=industry, today=today)


def generate_intel_news(
    *,
    account_name: str,
    industry: str | None,
    today: date | None = None,
) -> tuple[list[dict[str, Any]], bool]:
    """Public entry point. Returns (items, is_stub)."""
    today = today or date.today()
    settings = get_settings()
    key = settings.anthropic_api_key.get_secret_value()
    if not _key_looks_real(key):
        return stub_generate(account_name=account_name, industry=industry, today=today), True

    digest = hashlib.sha256(
        f"intel|{settings.anthropic_model}|{account_name}|{industry or ''}".encode()
    ).hexdigest()
    now = time.time()
    cached = _doc_cache.get(digest)
    if cached and (now - cached[0]) < _REAL_CACHE_TTL_SECONDS:
        return cached[1], False

    last_err: BaseException | None = None
    for attempt in (1, 2):
        try:
            items = _real_generate(account_name=account_name, industry=industry, today=today)
            _doc_cache[digest] = (now, items)
            return items, False
        except Exception as e:  # noqa: BLE001
            last_err = e
            if attempt == 1 and _is_transient_anthropic_error(e):
                logger.warning(
                    "Claude intel-news transient error %s — retrying",
                    type(e).__name__,
                )
                time.sleep(0.8)
                continue
            break

    logger.warning(
        "Claude intel-news unavailable (%s); using stub",
        type(last_err).__name__ if last_err else "unknown",
    )
    return stub_generate(account_name=account_name, industry=industry, today=today), True
