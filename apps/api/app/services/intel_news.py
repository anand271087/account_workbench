"""M28 — External Intelligence generation.

Three paths, tried in order:

1. **GDELT + Claude classify** — pull real news headlines via the public
   GDELT DOC 2.0 API (no key needed), then ask Claude to classify each
   into one of our 10 categories, write a procurement-context summary,
   and assign relevance. Drops articles Claude flags as not procurement-
   relevant. This is the production path for live intel.
2. **Claude synthesised** — when GDELT returns nothing usable, fall back
   to a single Claude completion that fabricates plausible items.
   Items are clearly synthetic and useful only for demos.
3. **Stub** — deterministic templated news items keyed on account name +
   industry. Used when neither path is available (no key configured).
   Produces 5–7 items spanning the 10-category space.

24h cache keyed on `sha256(intel|backend|account_name|industry)`. Falls
back gracefully on key absence or transient failure.
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
from datetime import UTC, date, datetime, timedelta
from typing import Any

import httpx

from app.services.claude import (
    _JSON_FENCE_RE,
    _JSON_OBJECT_RE,
    _doc_cache,
    _is_transient_anthropic_error,
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
    """One LLM call → 6 news items as structured JSON."""
    from app.services import llm

    industry_label = industry or "procurement"
    raw = llm.chat_text(
        max_tokens=1800,
        system=(
            "You write concise market-intelligence items for a customer-success "
            "team monitoring an account's external environment. The audience is "
            "procurement / sourcing / supply-chain leaders; every item MUST have "
            "a clear, direct procurement angle (what should a CPO / category "
            "manager do differently because of this news?).\n\n"
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
            '      "summary": <≤300 chars, plain text — must explicitly name the procurement implication>,\n'
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
            "  - Every item MUST be procurement-relevant: financial moves that\n"
            "    affect contracting power, supply-side shocks, supplier strategy\n"
            "    shifts, regulatory burdens on sourcing, ESG-in-sourcing, digital\n"
            "    procurement tooling, geopolitical sourcing risk, innovation that\n"
            "    changes the addressable spend, M&A that changes the buying entity.\n"
            "    REJECT marketing / consumer / HR / general business stories without\n"
            "    a sourcing implication.\n"
            "  - signal_relevance must reflect how directly the item affects the\n"
            "    account's procurement / sourcing posture. Only emit signal_relevance=high\n"
            "    when the procurement implication is unambiguous and time-sensitive.\n"
            "  - No filler. No prose outside the JSON."
        ),
        user_content=_truncate_for_prompt(
            f"Account name: {account_name}\nIndustry: {industry_label}\n"
            f"Today's date: {today.isoformat()}"
        ),
    )
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


# ============================================================
# GDELT — public DOC 2.0 API for real headlines
# ============================================================
#
# Free, no API key, no auth. Returns up to 250 articles per query.
# We request English-language items from the last 30 days, then let
# Claude pick the most procurement-relevant ones + classify them.
#
# Docs: https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/

_GDELT_ENDPOINT = "https://api.gdeltproject.org/api/v2/doc/doc"
_GDELT_TIMEOUT_S = 15.0
_GDELT_MAX_RECORDS = 25
_GDELT_TIMESPAN = "30d"
# GDELT throttles unauthenticated callers to ~1 request / 5s. A 6.5s
# floor between successive hits keeps us under the throttle even when
# two accounts refresh concurrently in dev. Pure in-process — fine for
# Render's single-worker setup; revisit if we move to multi-worker.
_GDELT_MIN_INTERVAL_S = 6.5
_gdelt_last_hit_at: float = 0.0


def _parse_gdelt_seendate(s: str) -> str | None:
    """GDELT timestamps look like '20251108T142503Z'. Return ISO YYYY-MM-DD."""
    if not s or len(s) < 8:
        return None
    try:
        dt = datetime.strptime(s[:8], "%Y%m%d").replace(tzinfo=UTC)
        return dt.date().isoformat()
    except (ValueError, TypeError):
        return None


def _fetch_gdelt_articles(
    *, account_name: str, max_records: int = _GDELT_MAX_RECORDS
) -> list[dict[str, Any]]:
    """Hit GDELT DOC 2.0 ArtList mode. Returns raw articles (may be empty).

    Defensive: any network/parse error → empty list (caller falls back).
    GDELT occasionally returns malformed JSON; we catch and log.
    """
    # GDELT query syntax: quoted phrase forces exact-match on the account
    # name. sourcelang:eng filters to English news (3-letter ISO 639-3 code
    # — sourcelang:english returns German+French junk). Combined with the
    # 30-day timespan this gives us ~25 recent items per account.
    query = f'"{account_name}" sourcelang:eng'
    params = {
        "query": query,
        "mode": "ArtList",
        "format": "json",
        "maxrecords": str(max_records),
        "timespan": _GDELT_TIMESPAN,
        "sort": "DateDesc",
    }
    # Honour GDELT's "1 request / 5s" guidance — block briefly if a
    # previous caller hit the API less than _GDELT_MIN_INTERVAL_S ago.
    global _gdelt_last_hit_at
    elapsed = time.time() - _gdelt_last_hit_at
    if elapsed < _GDELT_MIN_INTERVAL_S:
        time.sleep(_GDELT_MIN_INTERVAL_S - elapsed)
    _gdelt_last_hit_at = time.time()
    # GDELT blocks the default `python-httpx/x.y.z` User-Agent (silent connect
    # timeout — no HTTP response, no error). A browser-style UA is required.
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (compatible; BeroeAWB/1.0; "
            "+https://beroe-inc.com) intel-news-fetch"
        ),
        "Accept": "application/json",
    }
    try:
        r = httpx.get(
            _GDELT_ENDPOINT, params=params, headers=headers, timeout=_GDELT_TIMEOUT_S
        )
        if r.status_code != 200:
            logger.warning("GDELT non-200: %s", r.status_code)
            return []
        # GDELT sometimes returns text/html on error pages; guard.
        ctype = r.headers.get("content-type", "")
        if "json" not in ctype and not r.text.lstrip().startswith("{"):
            logger.warning("GDELT returned non-JSON content-type: %s", ctype)
            return []
        try:
            data = r.json()
        except (json.JSONDecodeError, ValueError) as e:
            logger.warning("GDELT JSON parse failed: %s", e)
            return []
        articles = data.get("articles") or []
        out: list[dict[str, Any]] = []
        seen_titles: set[str] = set()
        for a in articles:
            if not isinstance(a, dict):
                continue
            title = (a.get("title") or "").strip()
            url = (a.get("url") or "").strip()
            if not title or not url:
                continue
            # Dedupe by case-insensitive title prefix (different outlets
            # syndicate the same story under near-identical headlines).
            dedup_key = title.lower()[:80]
            if dedup_key in seen_titles:
                continue
            seen_titles.add(dedup_key)
            out.append(
                {
                    "title": title,
                    "url": url,
                    "domain": (a.get("domain") or "").strip() or None,
                    "seendate": _parse_gdelt_seendate(a.get("seendate") or ""),
                    "country": (a.get("sourcecountry") or "").strip() or None,
                }
            )
        return out
    except (httpx.HTTPError, httpx.TimeoutException) as e:
        logger.warning("GDELT fetch failed: %s", type(e).__name__)
        return []


def _classify_gdelt_with_llm(
    *,
    account_name: str,
    industry: str | None,
    articles: list[dict[str, Any]],
    today: date,
) -> list[dict[str, Any]]:
    """Send a batch of GDELT headlines to Claude. Get back enriched items.

    Drops items Claude flags as not procurement-relevant. Returns up to 8.
    Returns [] on any parse failure — caller falls back.
    """
    from app.services import llm

    industry_label = industry or "procurement"
    # Format input for Claude: numbered list of raw headlines + URLs.
    lines = []
    for i, a in enumerate(articles[:15], start=1):
        date_part = a.get("seendate") or today.isoformat()
        src_part = a.get("domain") or "unknown source"
        lines.append(f"[{i}] {a['title']} — {src_part} ({date_part})")
    raw_block = "\n".join(lines)

    raw = llm.chat_text(
        max_tokens=2500,
        system=(
            "You are filtering and enriching real news headlines for a customer-"
            "success team monitoring an account's procurement / sourcing exposure.\n\n"
            "You will receive a numbered list of REAL news headlines pulled from "
            "the GDELT news index. Your job:\n"
            "  1. KEEP only items with a clear procurement implication — financial "
            "moves that affect contracting power, supply-side shocks, supplier "
            "strategy shifts, regulatory burdens on sourcing, ESG-in-sourcing, "
            "digital procurement tooling, geopolitical sourcing risk, innovation "
            "that changes the addressable spend, M&A that changes the buying entity.\n"
            "  2. REJECT marketing / consumer / HR / sports / executive-bio / general "
            "business stories that don't move procurement.\n"
            "  3. For each kept item: classify into ONE category, rewrite the "
            "summary in procurement context (what should a CPO act on?), and "
            "assign signal_relevance.\n\n"
            "Output ONLY a JSON object — no markdown, no fences. Schema:\n"
            "{\n"
            '  "items": [\n'
            "    {\n"
            '      "input_index": <integer matching the [N] index from the input>,\n'
            '      "category": <one of '
            "financial_performance | supply_chain | supplier_strategy | "
            "expansion_capex | regulatory_compliance | sustainability_esg | "
            "digital_transformation | risk_geopolitical | product_innovation | m_and_a"
            ">,\n"
            '      "summary": <≤300 chars, plain text — name the procurement implication>,\n'
            '      "signal_relevance": <high | medium | low>\n'
            "    }\n"
            "  ]\n"
            "}\n"
            "Rules:\n"
            "  - Aim for 5–8 items spanning ≥3 different categories.\n"
            "  - If fewer than 3 input items have a procurement angle, emit only those.\n"
            "  - signal_relevance=high ONLY when the procurement implication is "
            "unambiguous and time-sensitive.\n"
            "  - Do NOT invent headlines — only reference items by their input_index."
        ),
        user_content=_truncate_for_prompt(
            f"Account: {account_name}\nIndustry: {industry_label}\n"
            f"Today: {today.isoformat()}\n\n"
            f"Real headlines from GDELT:\n{raw_block}"
        ),
    )
    cleaned = _JSON_FENCE_RE.sub("", raw).strip()
    m = _JSON_OBJECT_RE.search(cleaned)
    candidate = m.group(0) if m else cleaned
    try:
        parsed = json.loads(candidate)
    except (json.JSONDecodeError, ValueError):
        logger.warning("GDELT classifier returned non-JSON; falling back")
        return []

    out: list[dict[str, Any]] = []
    for it in (parsed.get("items") or [])[:8]:
        if not isinstance(it, dict):
            continue
        idx = it.get("input_index")
        if not isinstance(idx, int) or idx < 1 or idx > len(articles):
            continue
        src_article = articles[idx - 1]
        cat = (it.get("category") or "").strip()
        if cat not in _CATEGORIES:
            continue
        rel = it.get("signal_relevance")
        if rel not in ("high", "medium", "low"):
            rel = _RELEVANCE_BY_CATEGORY.get(cat, "medium")
        out.append(
            {
                "category": cat,
                "headline": src_article["title"][:400],
                "summary": (it.get("summary") or "").strip()[:2000] or None,
                "source": src_article.get("domain") or None,
                "source_url": src_article.get("url"),
                "news_date": src_article.get("seendate") or today.isoformat(),
                "signal_relevance": rel,
                # IMPORTANT: headlines are real (from GDELT); only the
                # summary + classification are AI-generated. Keep
                # ai_generated=True so the UI badge stays accurate (the
                # CSM should treat the procurement spin as machine-written).
                "ai_generated": True,
            }
        )
    return out


def _real_generate_from_gdelt(
    *,
    account_name: str,
    industry: str | None,
    today: date,
) -> list[dict[str, Any]]:
    """Fetch GDELT → classify with Claude. Returns [] if either step yields nothing."""
    articles = _fetch_gdelt_articles(account_name=account_name)
    if not articles:
        logger.info("GDELT returned 0 articles for %s", account_name)
        return []
    enriched = _classify_gdelt_with_llm(
        account_name=account_name,
        industry=industry,
        articles=articles,
        today=today,
    )
    return enriched


def generate_intel_news(
    *,
    account_name: str,
    industry: str | None,
    today: date | None = None,
    force_refresh: bool = False,
) -> tuple[list[dict[str, Any]], bool]:
    """Public entry point. Returns (items, is_stub).

    Only real GDELT-sourced items are returned. If GDELT yields nothing or
    LLM classification fails, returns ([], False) — the UI shows an empty
    state instead of inventing news. is_stub is kept in the return for
    backwards compatibility and is always False (we no longer produce stubs).

    Cache hits use the same 24h TTL. force_refresh=True skips the cache so
    the Refresh button always re-pulls.
    """
    today = today or date.today()
    from app.services import llm

    if not llm.is_configured():
        # Without an LLM there's no way to classify GDELT articles into
        # categories + write procurement summaries. Empty state.
        return [], False

    digest = hashlib.sha256(
        f"intel|{llm.backend_label()}|{account_name}|{industry or ''}".encode()
    ).hexdigest()
    now = time.time()
    if not force_refresh:
        cached = _doc_cache.get(digest)
        if cached and (now - cached[0]) < _REAL_CACHE_TTL_SECONDS:
            return cached[1], False

    try:
        items = _real_generate_from_gdelt(
            account_name=account_name, industry=industry, today=today
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("GDELT path failed: %s", type(e).__name__)
        items = []

    if items:
        _doc_cache[digest] = (now, items)
    return items, False
