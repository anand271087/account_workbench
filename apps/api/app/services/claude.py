"""Anthropic Claude wrapper.

Per the build plan + matrix Q5: cost-controlled. We:
- Lazy-import the Anthropic client (avoids startup cost when key isn't set).
- Detect a stub key (dev/demo) and fall back to a deterministic mock response
  so the UI flow is testable end-to-end without a real key.
- Cache successful responses by SHA256(prompt + input) — same input never bills
  twice. Cache TTL of 24h. (Redis backend lands in M7.)
- On transient Anthropic errors (overload / rate-limit / server error): retry
  once, then fall back to the stub heuristic with a clear comment so the UI
  never breaks. Errors are NOT cached.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import time

from app.core.config import get_settings
from app.schemas.engagement import QualityCheckResponse
from app.services import llm

logger = logging.getLogger(__name__)

# Manual TTL cache (lru_cache caches all results including stale; here we want TTL + miss-on-error).
_real_cache: dict[str, tuple[float, QualityCheckResponse]] = {}
_REAL_CACHE_TTL_SECONDS = 24 * 3600


def _key_looks_real(key: str) -> bool:
    """LEGACY — only used as a tiebreaker. Real gating is `llm.is_configured()`
    which also accepts the Bifrost gateway. Kept for the rare path where
    callers pass a raw key string."""
    return bool(key) and key.startswith("sk-ant-") and "stub" not in key and len(key) > 30


def _llm_ready() -> bool:
    """True when either the Bifrost gateway or Anthropic SDK can answer.
    All stub-or-real switches in this module route through here."""
    return llm.is_configured()


def _word_count(text: str) -> int:
    return len([w for w in re.split(r"\s+", text.strip()) if w])


def _stub_score(text: str) -> QualityCheckResponse:
    """Deterministic mock score so the UI is demo-able without a Claude key.

    Heuristic — proxy for Claude's evaluation on (specific, measurable, value-stated):
      - very short          → 1 (no context)
      - short, no signals   → 2 (generic)
      - moderate + signals  → 3-4 (acceptable; value or metric anchored)
      - long + both signals → 5 (strong)
    The thresholds align with the BRD "≥120 words" warning, but a shorter text
    that's clearly metric+value-anchored can still score 4.
    """
    wc = _word_count(text)
    has_metric = bool(
        re.search(r"\b(\d+\s*%|\$\d|€\d|\d+m|\d+k|increase|reduce|improve|by\s+\d+)\b", text, re.I)
    )
    has_value = bool(
        re.search(
            r"\b(value|outcome|saving|risk|growth|efficienc|customer|cost|measur|target|"
            r"deliver|impact|ROI|benchmark|negotiat|sourcing|adoption|renewal)\b",
            text, re.I,
        )
    )

    score: int
    comment: str
    if wc < 20:
        score, comment = 1, "Too short — add what success looks like and how it's measured."
    elif wc < 50 and not (has_metric and has_value):
        score, comment = 2, "Generic — name the specific business outcome and a metric."
    elif has_metric and has_value:
        if wc >= 100:
            score, comment = 5, "Specific, measurable, value-anchored — strong objective."
        else:
            score, comment = 4, "Strong shape — consider expanding to ≥120 words."
    elif has_metric or has_value:
        score, comment = 3, "Acceptable, but quantify the value (a metric or a target)."
    else:
        score, comment = 2, "Missing measurable outcomes."

    return QualityCheckResponse(score=score, comment=comment, word_count=wc, is_stub=True)


_JSON_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.MULTILINE)
_JSON_OBJECT_RE = re.compile(r"\{[\s\S]*\}")


def _extract_score_comment(raw: str) -> tuple[int, str]:
    """Pull `{score, comment}` out of Claude's reply.

    Claude often wraps JSON in markdown fences (```json ... ```) despite the
    instruction. Strip fences, then locate the first `{...}` block and parse.
    Falls back to a neutral 3 with a snippet of the raw text on parse failure.
    """
    text = _JSON_FENCE_RE.sub("", raw).strip()
    candidates: list[str] = [text]
    m = _JSON_OBJECT_RE.search(text)
    if m:
        candidates.insert(0, m.group(0))

    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
            score = int(parsed["score"])
            comment = str(parsed["comment"])
            return score, comment
        except (json.JSONDecodeError, KeyError, ValueError, TypeError):
            continue

    return 3, raw[:200] or "Could not parse model response."


def _real_anthropic_call(text: str) -> QualityCheckResponse:
    """One request to Claude. Raises anthropic exceptions on transient failure."""
    raw = llm.chat_text(
        system=(
            "You score procurement engagement objectives 1-5 on three dimensions:\n"
            "  - specificity (named outcome / category / target)\n"
            "  - measurability (concrete metric / number / timeframe)\n"
            "  - value statement (business impact, savings, risk, growth)\n\n"
            "Rules:\n"
            "  - ALWAYS score the text the user provides. Never ask for clarification.\n"
            "  - If the text is empty, placeholder-like, or fewer than ~20 words, score 1.\n"
            "  - If short and lacks any metric or value, score 1-2.\n"
            "  - Score 5 only if the text is specific, has at least one number/metric,\n"
            "    AND names a business value.\n"
            "  - Output ONLY JSON. No markdown, no fences, no preamble.\n"
            "  - Schema: {\"score\": <1|2|3|4|5>, \"comment\": \"<≤25 words actionable critique>\"}\n"
        ),
        user_content=(
            "Score this objective. Output only the JSON object. "
            "Do not ask for more context or paraphrase the input.\n\n"
            "OBJECTIVE TEXT:\n"
            f"{text}"
        ),
        max_tokens=300,
    )
    score, comment = _extract_score_comment(raw)
    score = max(1, min(5, score))
    return QualityCheckResponse(
        score=score, comment=comment, word_count=_word_count(text), is_stub=False
    )


def _is_transient_anthropic_error(e: BaseException) -> bool:
    """Return True for LLM errors worth retrying once.

    Covers both the Anthropic SDK exception classes and the httpx ones that
    surface when we hit the Bifrost gateway (timeouts, connection drops,
    5xx). Either family is retry-able once before falling back to stubs."""
    # Anthropic SDK family — only available when the package is installed.
    try:
        from anthropic import (
            APIConnectionError,
            APITimeoutError,
            InternalServerError,
            OverloadedError,
            RateLimitError,
        )  # type: ignore

        if isinstance(
            e,
            (
                APIConnectionError,
                APITimeoutError,
                InternalServerError,
                OverloadedError,
                RateLimitError,
            ),
        ):
            return True
    except ImportError:
        pass
    # httpx family — Bifrost gateway path.
    try:
        import httpx

        if isinstance(
            e,
            (
                httpx.ConnectError,
                httpx.ConnectTimeout,
                httpx.ReadTimeout,
                httpx.WriteTimeout,
                httpx.PoolTimeout,
                httpx.RemoteProtocolError,
            ),
        ):
            return True
        if isinstance(e, httpx.HTTPStatusError):
            return 500 <= e.response.status_code < 600 or e.response.status_code == 429
    except ImportError:
        pass
    return False


def _real_score_cached(prompt_hash: str, text: str) -> QualityCheckResponse:
    """Real Claude call with TTL cache + one retry + stub fallback on persistent error."""
    now = time.time()
    cached = _real_cache.get(prompt_hash)
    if cached and (now - cached[0]) < _REAL_CACHE_TTL_SECONDS:
        return cached[1]

    last_err: BaseException | None = None
    for attempt in (1, 2):
        try:
            result = _real_anthropic_call(text)
            _real_cache[prompt_hash] = (now, result)
            return result
        except Exception as e:  # noqa: BLE001 — defensive boundary
            last_err = e
            if attempt == 1 and _is_transient_anthropic_error(e):
                logger.warning("Claude transient error %s — retrying once", type(e).__name__)
                time.sleep(0.8)
                continue
            break

    # Fall back to the deterministic stub so the UI never breaks.
    err_name = type(last_err).__name__ if last_err else "unknown"
    logger.warning("Claude unavailable (%s); using heuristic stub", err_name)
    stub = _stub_score(text)
    return QualityCheckResponse(
        score=stub.score,
        comment=f"AI service unavailable ({err_name}) — used heuristic. {stub.comment}",
        word_count=stub.word_count,
        is_stub=True,
    )


def quality_check_engagement_objective(text: str) -> QualityCheckResponse:
    """Public entry point. Routes to LLM (gateway or Anthropic) or deterministic stub."""
    if not _llm_ready():
        return _stub_score(text)
    settings = get_settings()
    digest = hashlib.sha256(
        (llm.backend_label() + "|" + text).encode("utf-8")
    ).hexdigest()
    _ = settings  # kept for parity with siblings
    return _real_score_cached(digest, text)


# ============================================================
# M7 — Per-document summary + aggregate Sales Discovery summary
# ============================================================

# Cache keyed on SHA256(model + kind + text). Stores (timestamp, payload).
_doc_cache: dict[str, tuple[float, dict]] = {}
_aggr_cache: dict[str, tuple[float, str]] = {}


def _truncate_for_prompt(text: str, hard_limit: int = 24_000) -> str:
    if not text:
        return ""
    return text if len(text) <= hard_limit else (text[:hard_limit] + "\n\n…[truncated]")


def _stub_doc_summary(text: str, kind: str) -> dict:
    """Deterministic placeholder so the UI is demo-able without a real Claude key."""
    head = " ".join((text or "").split())[:300]
    summary = (
        f"[Stub summary — Anthropic key not configured.] "
        f"Document kind: {kind}. First ~300 chars: {head}…"
        if head
        else f"[Stub summary — empty document, kind={kind}.]"
    )
    # Cheap entity heuristic — pull capitalised tokens that look like names + dated lines.
    import re

    people = sorted({m.group(0) for m in re.finditer(r"\b([A-Z][a-z]+\s+[A-Z][a-z]+)\b", text)})[:5]
    dates = sorted({m.group(0) for m in re.finditer(r"\b\d{4}-\d{2}-\d{2}\b", text)})[:5]
    actions: list[str] = []
    for line in (text or "").splitlines():
        s = line.strip(" -•*")
        if s.lower().startswith(("action", "todo", "next step", "follow up")):
            actions.append(s[:160])
    return {
        "summary": summary,
        "people": people,
        "decisions": [],
        "action_items": actions[:5],
        "dates": dates,
        "is_stub": True,
    }


def _real_doc_summary(text: str, kind: str) -> dict:
    """One LLM call → 200-word summary + structured entities."""
    raw = llm.chat_text(
        system=(
            "You summarise procurement engagement documents — meeting minutes (MOM), "
            "value-proposition decks (VPD), transcripts, and emails — for a Beroe CSM "
            "or Solutioning Manager.\n\n"
            "Rules:\n"
            "  - Output ONLY a JSON object. No markdown, no fences.\n"
            "  - Schema: {"
            "\"summary\": <≤200 words, present tense, no fluff>, "
            "\"people\": [<full names mentioned>], "
            "\"decisions\": [<≤6 short bullets — what was agreed>], "
            "\"action_items\": [<≤6 short bullets — what someone will do>], "
            "\"dates\": [<ISO dates or natural dates referenced>]"
            "}\n"
            "  - Be concise. Skip pleasantries and filler.\n"
            "  - If a list has no items, return [] — not omitted.\n"
        ),
        user_content=(
            f"Document kind: {kind}\n\nDOCUMENT TEXT:\n{_truncate_for_prompt(text)}"
        ),
        max_tokens=900,
    )
    cleaned = _JSON_FENCE_RE.sub("", raw).strip()
    m = _JSON_OBJECT_RE.search(cleaned)
    candidate = m.group(0) if m else cleaned
    try:
        parsed = json.loads(candidate)
    except (json.JSONDecodeError, ValueError):
        # Couldn't parse — return a graceful placeholder rather than 500-ing.
        return {
            "summary": cleaned[:600] or "Could not parse model response.",
            "people": [],
            "decisions": [],
            "action_items": [],
            "dates": [],
            "is_stub": False,
        }
    return {
        "summary": str(parsed.get("summary", ""))[:1500],
        "people": [str(x)[:200] for x in (parsed.get("people") or [])][:10],
        "decisions": [str(x)[:200] for x in (parsed.get("decisions") or [])][:8],
        "action_items": [str(x)[:200] for x in (parsed.get("action_items") or [])][:8],
        "dates": [str(x)[:120] for x in (parsed.get("dates") or [])][:10],
        "is_stub": False,
    }


def summarise_document(text: str, kind: str) -> dict:
    """Public entry — stub-or-LLM based on availability, cached by content hash."""
    if not _llm_ready():
        return _stub_doc_summary(text, kind)

    digest = hashlib.sha256(
        f"doc|{llm.backend_label()}|{kind}|{text}".encode("utf-8")
    ).hexdigest()
    now = time.time()
    cached = _doc_cache.get(digest)
    if cached and (now - cached[0]) < _REAL_CACHE_TTL_SECONDS:
        return cached[1]

    last_err: BaseException | None = None
    for attempt in (1, 2):
        try:
            result = _real_doc_summary(text, kind)
            _doc_cache[digest] = (now, result)
            return result
        except Exception as e:  # noqa: BLE001 — defensive boundary
            last_err = e
            if attempt == 1 and _is_transient_anthropic_error(e):
                logger.warning("Claude doc-summary transient error %s — retrying", type(e).__name__)
                time.sleep(0.8)
                continue
            break

    err_name = type(last_err).__name__ if last_err else "unknown"
    logger.warning("Claude doc-summary unavailable (%s); using heuristic stub", err_name)
    stub = _stub_doc_summary(text, kind)
    stub["summary"] = f"AI service unavailable ({err_name}) — used heuristic. " + stub["summary"]
    return stub


# ---------- aggregate (account-level Sales Discovery summary) ----------


def _stub_aggregate_summary(per_doc_summaries: list[str]) -> str:
    if not per_doc_summaries:
        return (
            "Narrative:\n- No documents processed yet.\n"
            "Decisions:\n- None recorded.\n"
            "Action items:\n- Upload meeting minutes or a VPD to populate this summary.\n"
            "Risks & concerns:\n- None recorded.\n"
        )
    head = " ".join(s.strip() for s in per_doc_summaries[:5])[:900]
    return (
        f"Narrative:\n- [Stub aggregate — Anthropic key not configured.] {head}…\n"
        "Decisions:\n- (Connect a real Anthropic key to extract decisions.)\n"
        "Action items:\n- (Connect a real Anthropic key to extract actions.)\n"
        "Risks & concerns:\n- (Connect a real Anthropic key to surface risks.)\n"
    )


def _real_aggregate_summary(per_doc_summaries: list[str]) -> str:
    joined = "\n\n---\n\n".join(per_doc_summaries[:25])  # cap on inputs
    raw = llm.chat_text(
        system=(
            "You roll up several procurement-discovery document summaries into one "
            "Sales Discovery Summary for a CSM. Output PLAIN TEXT only (no markdown).\n\n"
            "Use these section headings exactly, in this order, each on its own line:\n"
            "  Narrative:\n"
            "  Decisions:\n"
            "  Action items:\n"
            "  Risks & concerns:\n\n"
            "Under each heading, write short bullets prefixed with '- ' (one per line).\n"
            "≤350 words total. Cover who the customer is, what they want to achieve, "
            "specific categories/initiatives, decisions taken, outstanding actions, "
            "and any risks, blockers, or open questions. Skip filler."
        ),
        user_content=f"PER-DOC SUMMARIES:\n\n{_truncate_for_prompt(joined)}",
        max_tokens=1100,
    )
    return raw.strip()


# ============================================================
# M7.5 — VPD structured-field extraction (AK03.d)
# ============================================================


def _stub_vpd_extract(text: str) -> dict:
    """Heuristic VPD extract for the no-key path."""
    head = " ".join((text or "").split())[:300]
    return {
        "proposed_solution": head[:600] or None,
        "engagement_type": "subscription" if "subscription" in (text or "").lower() else None,
        "engagement_duration_months": None,
        "value_themes": [],
        "value_definition": None,
        "estimated_value_musd": None,
        "is_stub": True,
    }


def _real_vpd_extract(text: str) -> dict:
    """One LLM call → structured Solutioning candidate values."""
    raw = llm.chat_text(
        system=(
            "You extract structured Solutioning fields from a Beroe Value-Proposition "
            "Deck (VPD).\n\n"
            "Output ONLY a JSON object — no markdown, no fences. Schema:\n"
            "{\n"
            "  \"proposed_solution\": <≤120 word plain text or null>,\n"
            "  \"engagement_type\": <one of one_time | retainer | subscription | pilot | other | null>,\n"
            "  \"engagement_duration_months\": <int or null>,\n"
            "  \"value_themes\": [<short tags like 'cost reduction', 'risk mitigation', 'category intel'>],\n"
            "  \"value_definition\": <≤80 word plain text on how value is measured / null>,\n"
            "  \"estimated_value_musd\": <number in millions USD or null>\n"
            "}\n"
            "Rules:\n"
            "  - If a field isn't in the deck, use null (or [] for value_themes).\n"
            "  - estimated_value_musd is a single number in millions of USD (e.g. 2.5).\n"
            "  - Skip filler. No prose outside the JSON."
        ),
        user_content=f"VPD TEXT:\n{_truncate_for_prompt(text)}",
        max_tokens=900,
    )
    cleaned = _JSON_FENCE_RE.sub("", raw).strip()
    m = _JSON_OBJECT_RE.search(cleaned)
    candidate = m.group(0) if m else cleaned
    try:
        parsed = json.loads(candidate)
    except (json.JSONDecodeError, ValueError):
        return _stub_vpd_extract(text) | {"is_stub": False}

    def _num(x):
        if x is None or x == "":
            return None
        try:
            return float(x)
        except (TypeError, ValueError):
            return None

    return {
        "proposed_solution": (str(parsed.get("proposed_solution"))[:2000]) if parsed.get("proposed_solution") else None,
        "engagement_type": parsed.get("engagement_type") or None,
        "engagement_duration_months": int(parsed["engagement_duration_months"])
            if isinstance(parsed.get("engagement_duration_months"), (int, float)) else None,
        "value_themes": [str(x)[:80] for x in (parsed.get("value_themes") or [])][:10],
        "value_definition": (str(parsed.get("value_definition"))[:1500]) if parsed.get("value_definition") else None,
        "estimated_value_musd": _num(parsed.get("estimated_value_musd")),
        "is_stub": False,
    }


def extract_vpd_fields(text: str) -> dict:
    """Public entry point. Stub-or-LLM, cached 24h."""
    if not _llm_ready():
        return _stub_vpd_extract(text)

    digest = hashlib.sha256(
        f"vpd|{llm.backend_label()}|{text}".encode("utf-8")
    ).hexdigest()
    now = time.time()
    cached = _doc_cache.get(digest)
    if cached and (now - cached[0]) < _REAL_CACHE_TTL_SECONDS:
        return cached[1]

    last_err: BaseException | None = None
    for attempt in (1, 2):
        try:
            r = _real_vpd_extract(text)
            _doc_cache[digest] = (now, r)
            return r
        except Exception as e:  # noqa: BLE001
            last_err = e
            if attempt == 1 and _is_transient_anthropic_error(e):
                logger.warning("Claude VPD extract transient error %s — retrying", type(e).__name__)
                time.sleep(0.8)
                continue
            break

    err_name = type(last_err).__name__ if last_err else "unknown"
    logger.warning("Claude VPD extract unavailable (%s); using stub", err_name)
    out = _stub_vpd_extract(text)
    out["proposed_solution"] = (
        f"AI service unavailable ({err_name}) — heuristic extraction. "
        + (out.get("proposed_solution") or "")
    )[:2000]
    return out


# ============================================================
# M15.1 — Candidate-goals extraction from VPD
# ============================================================


_GOAL_CATEGORIES = (
    "cost_savings",
    "base_rationalization",
    "risk_mitigation",
    "adoption",
    "other",
)


def _classify_goal_category(blob: str) -> str:
    """Best-effort category from free-text — used by stub + as a real-call
    fallback when Claude returns an unrecognised category."""
    s = (blob or "").lower()
    if any(k in s for k in ("cost", "savings", "save", "reduction")):
        return "cost_savings"
    if any(k in s for k in ("base", "rationalis", "rationaliz", "supplier consolidation", "sku reduction")):
        return "base_rationalization"
    if any(k in s for k in ("risk", "mitigation", "compliance", "single-source", "single source")):
        return "risk_mitigation"
    if any(k in s for k in ("adoption", "engagement", "usage", "training", "rollout")):
        return "adoption"
    return "other"


def _stub_cs_goals_extract(text: str) -> dict:
    """Heuristic candidate-goals extraction for the no-key path.

    Splits on bullets / line breaks, picks lines that look like outcomes,
    classifies each by keyword bag. Deterministic, ~70% as useful as real
    Claude on a well-structured VPD."""
    body = text or ""
    candidates: list[dict] = []
    seen: set[str] = set()
    for raw in body.splitlines():
        line = raw.strip().lstrip("-•·*").strip()
        if not line or len(line) < 12 or len(line) > 240:
            continue
        lower = line.lower()
        if not any(
            tok in lower
            for tok in (
                "save",
                "reduce",
                "improve",
                "increase",
                "adopt",
                "consolidat",
                "rationalis",
                "rationaliz",
                "mitigate",
                "deliver",
                "target",
            )
        ):
            continue
        key = lower[:80]
        if key in seen:
            continue
        seen.add(key)
        candidates.append(
            {
                "title": line[:200],
                "category": _classify_goal_category(line),
                "target_value": None,
                "target_date": None,
                "owner": None,
                "initiatives": [],
                "confidence": "low",
                "rationale": "Heuristic extract — line matched outcome verb.",
            }
        )
        if len(candidates) >= 6:
            break
    return {"goals": candidates, "is_stub": True}


def _real_cs_goals_extract(text: str) -> dict:
    """One LLM call → structured candidate goals."""
    raw = llm.chat_text(
        max_tokens=2000,
        system=(
            "You extract candidate customer-success Goals from a Beroe "
            "Value-Proposition Deck (VPD).\n\n"
            "Output ONLY a JSON object — no markdown, no fences. Schema:\n"
            "{\n"
            "  \"goals\": [\n"
            "    {\n"
            "      \"title\": <short outcome sentence, ≤180 chars>,\n"
            "      \"category\": <one of cost_savings | base_rationalization | risk_mitigation | adoption | other>,\n"
            "      \"target_value\": <e.g. '$2M' | '80%' | null>,\n"
            "      \"target_date\": <ISO date YYYY-MM-DD or null>,\n"
            "      \"owner\": <named person if explicitly assigned, else null>,\n"
            "      \"initiatives\": [\n"
            "         {\"name\": <short>, \"description\": <≤200 chars or null>,\n"
            "          \"stage\": <proposed|committed|in_flight|implemented|blocked|cancelled or null>,\n"
            "          \"levers\": [<strings: 'cost'|'risk'|'adoption'>] }\n"
            "      ],\n"
            "      \"confidence\": <high | medium | low>,\n"
            "      \"rationale\": <≤2 sentences explaining why this is a goal>\n"
            "    }\n"
            "  ]\n"
            "}\n"
            "Rules:\n"
            "  - Each goal must be a measurable outcome, not an activity.\n"
            "  - Category derivation: $-savings → cost_savings; supplier/SKU cuts → base_rationalization;\n"
            "    single-source / compliance → risk_mitigation; usage / rollout / training → adoption.\n"
            "  - Skip filler. Cap at 8 goals. Skip goals you can't tie to a sentence."
        ),
        user_content=f"VPD TEXT:\n{_truncate_for_prompt(text)}",
    )
    cleaned = _JSON_FENCE_RE.sub("", raw).strip()
    m = _JSON_OBJECT_RE.search(cleaned)
    candidate = m.group(0) if m else cleaned
    try:
        parsed = json.loads(candidate)
    except (json.JSONDecodeError, ValueError):
        return _stub_cs_goals_extract(text) | {"is_stub": False}

    out_goals: list[dict] = []
    for g in (parsed.get("goals") or [])[:8]:
        if not isinstance(g, dict):
            continue
        title = (g.get("title") or "").strip()[:200]
        if not title:
            continue
        cat = (g.get("category") or "").strip()
        if cat not in _GOAL_CATEGORIES:
            cat = _classify_goal_category(title)
        initiatives: list[dict] = []
        for it in (g.get("initiatives") or [])[:10]:
            if not isinstance(it, dict):
                continue
            nm = (it.get("name") or "").strip()[:200]
            if not nm:
                continue
            initiatives.append(
                {
                    "name": nm,
                    "description": (str(it.get("description"))[:2000]) if it.get("description") else None,
                    "stage": it.get("stage") or None,
                    "levers": [str(x)[:40] for x in (it.get("levers") or [])][:5],
                }
            )
        out_goals.append(
            {
                "title": title,
                "category": cat,
                "target_value": (str(g.get("target_value"))[:200]) if g.get("target_value") else None,
                "target_date": g.get("target_date") or None,
                "owner": (str(g.get("owner"))[:200]) if g.get("owner") else None,
                "initiatives": initiatives,
                "confidence": g.get("confidence") if g.get("confidence") in ("high", "medium", "low") else None,
                "rationale": (str(g.get("rationale"))[:600]) if g.get("rationale") else None,
            }
        )
    return {"goals": out_goals, "is_stub": False}


def extract_cs_goals_from_vpd(text: str) -> dict:
    """Public entry point. Stub-or-LLM, cached 24h."""
    if not _llm_ready():
        return _stub_cs_goals_extract(text)

    digest = hashlib.sha256(
        f"vpd-goals|{llm.backend_label()}|{text}".encode("utf-8")
    ).hexdigest()
    now = time.time()
    cached = _doc_cache.get(digest)
    if cached and (now - cached[0]) < _REAL_CACHE_TTL_SECONDS:
        return cached[1]

    last_err: BaseException | None = None
    for attempt in (1, 2):
        try:
            r = _real_cs_goals_extract(text)
            _doc_cache[digest] = (now, r)
            return r
        except Exception as e:  # noqa: BLE001
            last_err = e
            if attempt == 1 and _is_transient_anthropic_error(e):
                logger.warning("Claude goals extract transient error %s — retrying", type(e).__name__)
                time.sleep(0.8)
                continue
            break

    err_name = type(last_err).__name__ if last_err else "unknown"
    logger.warning("Claude goals extract unavailable (%s); using stub", err_name)
    return _stub_cs_goals_extract(text)


def aggregate_account_summary(per_doc_summaries: list[str]) -> str:
    if not _llm_ready():
        return _stub_aggregate_summary(per_doc_summaries)

    digest = hashlib.sha256(
        ("aggr|" + llm.backend_label() + "|" + "\n".join(per_doc_summaries)).encode("utf-8")
    ).hexdigest()
    now = time.time()
    cached = _aggr_cache.get(digest)
    if cached and (now - cached[0]) < _REAL_CACHE_TTL_SECONDS:
        return cached[1]

    last_err: BaseException | None = None
    for attempt in (1, 2):
        try:
            result = _real_aggregate_summary(per_doc_summaries)
            _aggr_cache[digest] = (now, result)
            return result
        except Exception as e:  # noqa: BLE001
            last_err = e
            if attempt == 1 and _is_transient_anthropic_error(e):
                logger.warning(
                    "Claude aggregate transient error %s — retrying", type(e).__name__
                )
                time.sleep(0.8)
                continue
            break

    err_name = type(last_err).__name__ if last_err else "unknown"
    logger.warning("Claude aggregate unavailable (%s); using stub", err_name)
    return f"AI service unavailable ({err_name}) — heuristic rollup. " + _stub_aggregate_summary(
        per_doc_summaries
    )
