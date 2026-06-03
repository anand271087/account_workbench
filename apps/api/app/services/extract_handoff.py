"""Handoff (Sales Hand-off contract) field extraction.

Mirrors apps/api/app/services/extract_mom.py:
  * Stub extractor that pattern-matches common contract phrasing
    (signed date, ACV in $, contract term, modules, platform tier,
    segment, subscribers). Deterministic — useful even with no
    Anthropic key configured.
  * Real Claude call gated behind config. Falls back to stub on any
    transient failure so the upload never breaks the worker pipeline.

Caller (apps/api/app/workers/tasks.py) invokes us after the AI summary
pass on a kind='contract' document.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

from app.core.config import get_settings
from app.schemas.handoff_extraction import HandoffExtractionResult

logger = logging.getLogger(__name__)


# ============================================================
# 24h TTL cache keyed by (model, sha256(text)) — re-running the same
# doc shouldn't bill Anthropic twice.
# ============================================================

_CACHE: dict[str, tuple[float, HandoffExtractionResult]] = {}
_CACHE_TTL_SECONDS = 86_400


def _cache_get(key: str) -> HandoffExtractionResult | None:
    entry = _CACHE.get(key)
    if not entry:
        return None
    when, result = entry
    if (datetime.utcnow().timestamp() - when) > _CACHE_TTL_SECONDS:
        _CACHE.pop(key, None)
        return None
    return result


def _cache_put(key: str, result: HandoffExtractionResult) -> None:
    _CACHE[key] = (datetime.utcnow().timestamp(), result)


# ============================================================
# Stub extractor — deterministic regex passes
# ============================================================

_DATE_PATTERNS = [
    # 1 Mar 2024 / 1st March 2024 / March 1, 2024 / 2024-03-01 / 01/03/2024
    r"(?P<d>\d{1,2})\s+(?P<m>Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(?P<y>\d{4})",
    r"(?P<m>Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(?P<d>\d{1,2}),?\s+(?P<y>\d{4})",
    r"(?P<y>\d{4})-(?P<mn>\d{2})-(?P<dn>\d{2})",
    r"(?P<dn>\d{2})[/-](?P<mn>\d{2})[/-](?P<y>\d{4})",
]

_MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}


def _parse_date_near(text: str, anchor_words: list[str]) -> date | None:
    """Find the first date that appears within ~200 chars of one of the
    anchor words. Returns None when no date is found near any anchor."""
    lower = text.lower()
    windows: list[tuple[int, int]] = []
    for w in anchor_words:
        i = 0
        while True:
            j = lower.find(w.lower(), i)
            if j < 0:
                break
            windows.append((max(0, j - 100), min(len(text), j + 200)))
            i = j + 1
    for start, end in windows:
        snippet = text[start:end]
        for pat in _DATE_PATTERNS:
            m = re.search(pat, snippet)
            if not m:
                continue
            try:
                if "mn" in m.groupdict() and m.group("mn"):
                    return date(int(m.group("y")), int(m.group("mn")), int(m.group("dn")))
                month_short = m.group("m").lower()[:3]
                mm = _MONTHS.get(month_short)
                if not mm:
                    continue
                return date(int(m.group("y")), mm, int(m.group("d")))
            except (ValueError, IndexError):
                continue
    return None


def _parse_acv(text: str) -> Decimal | None:
    """Find the largest USD figure near 'ACV' or 'contract value' or 'total'."""
    candidates: list[Decimal] = []
    # Look for $X (US format), $X.YM, $XK, etc.
    for m in re.finditer(
        r"(?:ACV|annual\s+contract\s+value|contract\s+value|total\s+contract|annual\s+fee|annual\s+subscription|annual\s+value)"
        r"[\s:$=]*"
        r"\$?\s*(?P<n>[\d,]+(?:\.\d+)?)\s*(?P<u>[KkMm])?",
        text,
        re.IGNORECASE,
    ):
        raw = m.group("n").replace(",", "")
        try:
            v = Decimal(raw)
        except InvalidOperation:
            continue
        unit = (m.group("u") or "").lower()
        if unit == "k":
            v = v * Decimal("1000")
        elif unit == "m":
            v = v * Decimal("1000000")
        if Decimal("100") <= v <= Decimal("100000000"):
            candidates.append(v)
    return max(candidates) if candidates else None


def _parse_term(text: str) -> str | None:
    """Map common term phrasings to the gate_contract_term picker values."""
    lower = text.lower()
    # Year-based
    m = re.search(r"(\d+)\s*[- ]\s*year", lower)
    if m:
        n = int(m.group(1))
        if n == 1:
            return "1 year"
        if 2 <= n <= 5:
            return f"{n} years"
    if "annual" in lower or "1-year" in lower:
        return "1 year"
    if "two-year" in lower or "2-year" in lower:
        return "2 years"
    if "three-year" in lower or "3-year" in lower:
        return "3 years"
    if "multi-year" in lower or "custom term" in lower or "bespoke term" in lower:
        return "Custom"
    return None


_MODULE_VOCAB = [
    "Category Watch", "Abi Intelligence", "Benchmarks", "Custom Credits",
    "Supplier Discovery", "Supplier Risk", "Live.ai", "MMD",
    "Sourcing Optimizer", "Copilot", "DataHub", "Diverse Supplier Directory",
    "Supply Chain Risk",
]


def _parse_modules(text: str) -> list[str]:
    """Return module names from the vocab that appear in the text."""
    found: list[str] = []
    lower = text.lower()
    for m in _MODULE_VOCAB:
        if m.lower() in lower:
            found.append(m)
    return found


_TIER_VOCAB = ["EL Base", "EL Plus", "EL Premium", "Enterprise", "Pro", "Custom"]
_SEGMENT_VOCAB = ["A", "B", "C"]


def _parse_platform_tier(text: str) -> str | None:
    """Find 'EL Base' / 'EL Plus' / 'Pro' / 'Enterprise' near the
    word 'tier' or 'platform'."""
    lower = text.lower()
    if "platform tier" in lower or "tier:" in lower or "platform:" in lower:
        for v in _TIER_VOCAB:
            if v.lower() in lower:
                return v
    # Fallback — any standalone hit on the vocab
    for v in _TIER_VOCAB:
        if v.lower() in lower:
            return v
    return None


def _parse_segment(text: str) -> str | None:
    m = re.search(r"segment\s*[:=]?\s*([ABC])\b", text, re.IGNORECASE)
    if m:
        return m.group(1).upper()
    return None


def _parse_subscribers(text: str) -> str | None:
    """Match strings like '25 users', 'Unlimited (Enterprise)', etc."""
    m = re.search(
        r"(unlimited(?:\s*\(.*?\))?|(?:\d+)\s*(?:users|seats|subscribers))",
        text,
        re.IGNORECASE,
    )
    return m.group(1).strip() if m else None


def _stub_extract(document_id: str, text: str) -> HandoffExtractionResult:
    """Deterministic regex-based extractor — runs when no Anthropic key
    is configured or when the real call fails."""
    return HandoffExtractionResult(
        document_id=document_id,
        is_stub=True,
        gate_signed_date=_parse_date_near(text, ["signed", "signing", "effective date", "execution date"]),
        gate_contract_acv_usd=_parse_acv(text),
        gate_contract_term=_parse_term(text),
        gate_contract_modules=_parse_modules(text),
        gate_platform_tier=_parse_platform_tier(text),
        gate_account_segment=_parse_segment(text),
        gate_subscribers=_parse_subscribers(text),
        confidence="low",
        notes="Stub extractor — best-effort regex match, please review every field.",
    )


# ============================================================
# Real Claude call
# ============================================================

_SYSTEM_PROMPT = """You extract structured Client Signed fields from a Beroe Sales Hand-off contract document.

Output a SINGLE JSON object with this exact shape — omit any field you cannot infer from the text (do not invent values):

{
  "gate_signed_date":      "YYYY-MM-DD" or null,
  "gate_contract_acv_usd": number (USD) or null,
  "gate_contract_term":    one of ["1 year","2 years","3 years","5 years","Custom"] or null,
  "gate_contract_modules": [ "Category Watch", "Abi Intelligence", "Benchmarks", "Custom Credits", "Supplier Discovery", "Supplier Risk", "Live.ai", "MMD", "Sourcing Optimizer", "Copilot", "DataHub", "Diverse Supplier Directory", "Supply Chain Risk" ]   (subset that actually appears),
  "gate_platform_tier":    one of ["EL Base","EL Plus","EL Premium","Enterprise","Pro","Custom"] or null,
  "gate_account_segment":  "A" or "B" or "C" or null,
  "gate_subscribers":      free text like "Unlimited (Enterprise)" or "25 users" or null,
  "confidence":            "high" | "medium" | "low",
  "notes":                 short one-line clarification or null
}

Rules:
- gate_contract_acv_usd is the ANNUAL contract value in USD as a plain number (no $ or commas). If the doc only states a multi-year total, divide by the year count.
- gate_contract_term must be one of the enumerated values; map "annual" → "1 year", "biennial" → "2 years", anything bespoke → "Custom".
- gate_contract_modules: include only modules whose names appear literally in the text.
- Output JSON only. No prose."""


async def _real_extract(document_id: str, text: str) -> HandoffExtractionResult | None:
    """One Claude call, JSON-only response. Returns None on any failure
    so the caller falls back to the stub."""
    settings = get_settings()
    raw_key = settings.anthropic_api_key
    # raw_key can be a Pydantic SecretStr — unwrap defensively.
    key = raw_key.get_secret_value() if hasattr(raw_key, "get_secret_value") else raw_key
    if not key or not isinstance(key, str) or not key.startswith("sk-"):
        return None
    try:
        from anthropic import AsyncAnthropic

        client = AsyncAnthropic(api_key=key)
        msg = await client.messages.create(
            model=settings.anthropic_model,
            max_tokens=1500,
            system=_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": text[:60_000]}],
        )
        body = "".join(
            b.text for b in msg.content if getattr(b, "type", None) == "text"
        ).strip()
        # Strip code fences if present.
        if body.startswith("```"):
            body = re.sub(r"^```(?:json)?\s*", "", body)
            body = re.sub(r"\s*```$", "", body)
        data: dict[str, Any] = json.loads(body)
        return HandoffExtractionResult(
            document_id=document_id,
            is_stub=False,
            confidence=data.get("confidence", "medium"),
            notes=data.get("notes"),
            gate_signed_date=date.fromisoformat(data["gate_signed_date"]) if data.get("gate_signed_date") else None,
            gate_contract_acv_usd=Decimal(str(data["gate_contract_acv_usd"])) if data.get("gate_contract_acv_usd") is not None else None,
            gate_contract_term=data.get("gate_contract_term"),
            gate_contract_modules=data.get("gate_contract_modules") or [],
            gate_platform_tier=data.get("gate_platform_tier"),
            gate_account_segment=data.get("gate_account_segment"),
            gate_subscribers=data.get("gate_subscribers"),
        )
    except Exception as exc:
        logger.warning("Handoff Claude extract failed (falling back to stub): %s", exc)
        return None


# ============================================================
# Public entry point
# ============================================================


async def extract_handoff(document_id: str, text: str) -> HandoffExtractionResult:
    """Best-effort structured extraction from a contract document.

    Steps:
      1. 24h cache hit on sha256(text) — bail.
      2. Try real Claude call. On success, cache + return.
      3. Fall back to deterministic stub.
    """
    settings = get_settings()
    cache_key = "handoff|" + settings.anthropic_model + "|" + hashlib.sha256(text.encode("utf-8", errors="ignore")).hexdigest()
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached.model_copy(update={"document_id": document_id})

    real = await _real_extract(document_id, text)
    if real is not None:
        _cache_put(cache_key, real)
        return real

    stub = _stub_extract(document_id, text)
    _cache_put(cache_key, stub)
    return stub
