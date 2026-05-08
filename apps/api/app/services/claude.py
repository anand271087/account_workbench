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

logger = logging.getLogger(__name__)

# Manual TTL cache (lru_cache caches all results including stale; here we want TTL + miss-on-error).
_real_cache: dict[str, tuple[float, QualityCheckResponse]] = {}
_REAL_CACHE_TTL_SECONDS = 24 * 3600


def _key_looks_real(key: str) -> bool:
    """Anthropic API keys start with `sk-ant-` and are ~95+ chars. Anything else is a stub."""
    return bool(key) and key.startswith("sk-ant-") and "stub" not in key and len(key) > 30


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
    settings = get_settings()
    # Anthropic SDK is heavy; import lazily so the rest of the API boots cleanly
    # even when the key is a stub or the package isn't installed in this venv.
    from anthropic import Anthropic  # type: ignore

    client = Anthropic(api_key=settings.anthropic_api_key.get_secret_value())
    msg = client.messages.create(
        model=settings.anthropic_model,
        max_tokens=300,
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
        messages=[
            {
                "role": "user",
                "content": (
                    "Score this objective. Output only the JSON object. "
                    "Do not ask for more context or paraphrase the input.\n\n"
                    "OBJECTIVE TEXT:\n"
                    f"{text}"
                ),
            }
        ],
    )
    raw = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")
    score, comment = _extract_score_comment(raw)
    score = max(1, min(5, score))
    return QualityCheckResponse(
        score=score, comment=comment, word_count=_word_count(text), is_stub=False
    )


def _is_transient_anthropic_error(e: BaseException) -> bool:
    """Return True for Anthropic errors worth retrying once."""
    try:
        from anthropic import (
            APIConnectionError,
            APITimeoutError,
            InternalServerError,
            OverloadedError,
            RateLimitError,
        )  # type: ignore
    except ImportError:
        return False
    return isinstance(e, (APIConnectionError, APITimeoutError, InternalServerError, OverloadedError, RateLimitError))


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
    """Public entry point. Routes to real Claude or to the deterministic stub."""
    settings = get_settings()
    key = settings.anthropic_api_key.get_secret_value()
    if not _key_looks_real(key):
        return _stub_score(text)
    digest = hashlib.sha256((settings.anthropic_model + "|" + text).encode("utf-8")).hexdigest()
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
    """One Claude call → 200-word summary + structured entities."""
    settings = get_settings()
    from anthropic import Anthropic  # type: ignore

    client = Anthropic(api_key=settings.anthropic_api_key.get_secret_value())
    msg = client.messages.create(
        model=settings.anthropic_model,
        max_tokens=900,
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
        messages=[
            {
                "role": "user",
                "content": (
                    f"Document kind: {kind}\n\nDOCUMENT TEXT:\n{_truncate_for_prompt(text)}"
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
    """Public entry — stub-or-real based on key, cached by content hash."""
    settings = get_settings()
    key = settings.anthropic_api_key.get_secret_value()
    if not _key_looks_real(key):
        return _stub_doc_summary(text, kind)

    digest = hashlib.sha256(
        f"doc|{settings.anthropic_model}|{kind}|{text}".encode("utf-8")
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
    settings = get_settings()
    from anthropic import Anthropic  # type: ignore

    client = Anthropic(api_key=settings.anthropic_api_key.get_secret_value())
    joined = "\n\n---\n\n".join(per_doc_summaries[:25])  # cap on inputs
    msg = client.messages.create(
        model=settings.anthropic_model,
        max_tokens=1100,
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
        messages=[{"role": "user", "content": f"PER-DOC SUMMARIES:\n\n{_truncate_for_prompt(joined)}"}],
    )
    return "".join(b.text for b in msg.content if getattr(b, "type", "") == "text").strip()


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
    """One Claude call → structured Solutioning candidate values."""
    settings = get_settings()
    from anthropic import Anthropic  # type: ignore

    client = Anthropic(api_key=settings.anthropic_api_key.get_secret_value())
    msg = client.messages.create(
        model=settings.anthropic_model,
        max_tokens=900,
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
        messages=[{"role": "user", "content": f"VPD TEXT:\n{_truncate_for_prompt(text)}"}],
    )
    raw = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")
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
    """Public entry point. Stub-or-real based on key, cached 24h."""
    settings = get_settings()
    key = settings.anthropic_api_key.get_secret_value()
    if not _key_looks_real(key):
        return _stub_vpd_extract(text)

    digest = hashlib.sha256(
        f"vpd|{settings.anthropic_model}|{text}".encode("utf-8")
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


def aggregate_account_summary(per_doc_summaries: list[str]) -> str:
    settings = get_settings()
    key = settings.anthropic_api_key.get_secret_value()
    if not _key_looks_real(key):
        return _stub_aggregate_summary(per_doc_summaries)

    digest = hashlib.sha256(
        ("aggr|" + settings.anthropic_model + "|" + "\n".join(per_doc_summaries)).encode("utf-8")
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
