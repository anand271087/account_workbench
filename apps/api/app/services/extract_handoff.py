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


# ACV-specific anchors (annual). TCV / multi-year are covered by _parse_tcv.
_ACV_ANCHOR_RE = (
    r"(?:ACV|annual\s+contract\s+value|annual\s+fee|annual\s+subscription|"
    r"annual\s+value|annual\s+spend)"
)
# Looser anchors used only when the strict ones don't match.
_ACV_FALLBACK_ANCHOR_RE = r"(?:contract\s+value|subscription\s+fee)"


def _scan_acv(text: str, anchor_re: str) -> list[Decimal]:
    out: list[Decimal] = []
    for m in re.finditer(
        anchor_re + r"[^\d$\n]{0,24}\$?\s*(?P<n>[\d,]+(?:\.\d+)?)\s*(?P<u>[KkMm])?",
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
            out.append(v)
    return out


def _parse_acv(text: str) -> Decimal | None:
    """Find the ACV figure. Prefers ACV-specific anchors so a TCV figure
    next to "Total Contract Value" doesn't shadow the real ACV."""
    primary = _scan_acv(text, _ACV_ANCHOR_RE)
    if primary:
        # Multiple ACV mentions in one doc are rare; take the max but they're
        # usually identical.
        return max(primary)
    fallback = _scan_acv(text, _ACV_FALLBACK_ANCHOR_RE)
    if fallback:
        return max(fallback)
    return None


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
    """Match strings like '25 users', 'Unlimited (Enterprise)', or the
    inverse form 'subscribers is 25' / 'number of seats: 50'."""
    # 1. Unlimited / explicit noun-first form ("25 users")
    m = re.search(
        r"(unlimited(?:\s*\(.*?\))?|(?:\d+)\s*(?:users|seats|subscribers|licenses?))",
        text,
        re.IGNORECASE,
    )
    if m:
        return m.group(1).strip()
    # 2. Inverse form: "number of subscribers is 25" / "seats: 50"
    m = re.search(
        r"\b(?:users|seats|subscribers|licenses?)\b[^\d\n]{0,20}(\d+)",
        text,
        re.IGNORECASE,
    )
    if m:
        return f"{m.group(1)} users"
    return None


# ============================================================
# 05-Jun — Contract Audit "extras" stub helpers
# ============================================================


# Vocab aligned to the frontend options in apps/web/src/types/signing.ts —
# BILLING_FREQ_OPTIONS / PAYMENT_TERM_OPTIONS / GEO_OPTIONS — so the picker
# pre-fills with a recognised value instead of a free-text custom entry.
_BILLING_FREQ_VOCAB = {
    "annual": "Annual", "yearly": "Annual",
    "bi-annual": "Bi-annual", "semi-annual": "Bi-annual",
    "semiannual": "Bi-annual", "biannual": "Bi-annual", "twice a year": "Bi-annual",
    "quarterly": "Quarterly",
    "monthly": "Monthly",
}
# Regional tokens checked FIRST so a doc that mentions both "EMEA" and
# "global access on read-only modules" picks EMEA as the primary region.
# "primary" / "primary region" / "main region" near a regional token also
# upweights it.
_GEOGRAPHY_VOCAB = (
    ("emea", "EMEA"), ("europe", "EMEA"), (" eu ", "EMEA"), (" uk ", "EMEA"),
    ("north america", "North America"), ("us only", "North America"),
    ("north-america", "North America"),
    ("apac", "APAC"), ("asia pacific", "APAC"), ("asia-pacific", "APAC"),
    ("latam", "LATAM"), ("latin america", "LATAM"),
    ("multi-region", "Multi-region (custom)"),
    # Global is the catch-all — only wins if NO regional token landed.
    ("worldwide", "Global"), ("global", "Global"),
)


_RENEWAL_FORWARD_ANCHORS = (
    "renewal date", "renewal:", "expires on", "expires ",
    "term ends", "end date", "expiration date", "contract end",
)


def _parse_renewal_date(text: str) -> date | None:
    """Renewal date often appears as 'renewal date is 14 May 2028' /
    'expires on 31 Dec 2026'. The date almost always follows the
    anchor, not precedes it — so we search a forward-only window."""
    lower = text.lower()
    for anchor in _RENEWAL_FORWARD_ANCHORS:
        i = 0
        while True:
            j = lower.find(anchor, i)
            if j < 0:
                break
            snippet = text[j : min(len(text), j + 200)]
            for pat in _DATE_PATTERNS:
                m = re.search(pat, snippet)
                if not m:
                    continue
                try:
                    if "mn" in m.groupdict() and m.group("mn"):
                        return date(
                            int(m.group("y")),
                            int(m.group("mn")),
                            int(m.group("dn")),
                        )
                    month_short = m.group("m").lower()[:3]
                    mm = _MONTHS.get(month_short)
                    if not mm:
                        continue
                    return date(int(m.group("y")), mm, int(m.group("d")))
                except (ValueError, IndexError):
                    continue
            i = j + 1
    return None


def _parse_tcv(text: str) -> str | None:
    """TCV = total contract value, captured verbatim with the unit."""
    m = re.search(
        r"(?:TCV|total\s+contract\s+value|multi-?year\s+total|tot\.\s+contract)"
        r"[\s:$=]*\$?\s*([\d,]+(?:\.\d+)?\s*[KkMmBb]?)",
        text,
        re.IGNORECASE,
    )
    return m.group(1).strip() if m else None


def _parse_billing_freq(text: str) -> str | None:
    head = text[:8000].lower()
    if not any(w in head for w in ("billing", "invoice", "billed", "payment")):
        return None
    for token, canonical in _BILLING_FREQ_VOCAB.items():
        if token in head:
            return canonical
    return None


def _parse_payment_terms(text: str) -> str | None:
    # Frontend options: Net 15 / 30 / 45 / 60 / 90 / Upon receipt / Custom.
    head = text[:8000].lower()
    if "upon receipt" in head or "payable on receipt" in head:
        return "Upon receipt"
    m = re.search(r"\bNet[\s-]*(\d{2,3})\b", text, re.IGNORECASE)
    if m:
        n = int(m.group(1))
        if n in (15, 30, 45, 60, 90):
            return f"Net {n}"
        # Out-of-range (Net 120 / Net 7) — the frontend Select supports "Custom".
        return "Custom"
    return None


def _parse_discount(text: str) -> tuple[str | None, str | None]:
    """Returns (discount_percent_as_string, reason). Reason is bounded by
    sentence terminators OR a newline OR the next "Field:"-style header
    so multi-section docs don't bleed into the reason."""
    m = re.search(
        r"(?P<n>\d{1,2}(?:\.\d{1,2})?)\s*%\s*(?:discount|rebate|off)\b",
        text, re.IGNORECASE,
    )
    if not m:
        m = re.search(
            r"\b(?:discount|rebate)\s*(?:of|:|-)?\s*(?P<n>\d{1,2}(?:\.\d{1,2})?)\s*%",
            text, re.IGNORECASE,
        )
    if not m:
        return (None, None)
    pct = m.group("n")
    start = max(0, m.start() - 80)
    end = min(len(text), m.end() + 160)
    # Preserve newlines so the reason search stops at section boundaries.
    sentence = text[start:end]
    # Match "for X" / "reflecting X" / etc. up to a sentence terminator,
    # newline, or "Field:"-style header marker.
    reason_m = re.search(
        r"(?:for|due to|because of|reflecting|as a)\s+([^.;\n]{4,80})",
        sentence, re.IGNORECASE,
    )
    if not reason_m:
        return (pct, None)
    reason = reason_m.group(1).strip().rstrip(",.")
    # If a "<Word>:" header crept in, cut at it.
    reason = re.split(r"\s+[A-Z][A-Za-z]{2,}\s*:\s*", reason, maxsplit=1)[0].strip()
    return (pct, reason or None)


def _parse_geography(text: str) -> str | None:
    """Pick the most specific region that appears. Regional tokens
    iterate first; "Global" is only picked when no regional hit lands."""
    head = text[:8000].lower()
    # First pass: regional tokens (Global stripped).
    for token, canonical in _GEOGRAPHY_VOCAB:
        if canonical == "Global":
            continue
        if token in head:
            return canonical
    # No regional hit → fall back to Global / worldwide.
    if "worldwide" in head or "global" in head:
        return "Global"
    return None


_CLAUSE_HEADER_RE = re.compile(
    r"\b(Termination|Renewal\s+Option|Auto-?renewal|Audit\s+Rights?|"
    r"QBR(?:\s+cadence)?|Pricing\s+Protection|Exit\s+Clause|Side[- ]Letter|"
    r"Indemnification|Service\s+Levels?|SLA|Cap\s+on\s+Liability|"
    r"Confidentiality)\b",
    re.IGNORECASE,
)


def _parse_other_terms(text: str) -> str | None:
    matches = _CLAUSE_HEADER_RE.findall(text)
    if not matches:
        return None
    seen: set[str] = set()
    out: list[str] = []
    for raw in matches:
        key = raw.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(raw.strip())
        if len(out) >= 5:
            break
    return " · ".join(out)


def _stub_extract(document_id: str, text: str) -> HandoffExtractionResult:
    """Deterministic regex-based extractor — runs when no Anthropic key
    is configured or when the real call fails."""
    discount, discount_reason = _parse_discount(text)
    return HandoffExtractionResult(
        document_id=document_id,
        is_stub=True,
        gate_signed_date=_parse_date_near(
            text, ["signed", "signing", "effective date", "execution date"],
        ),
        gate_renewal_date=_parse_renewal_date(text),
        gate_contract_acv_usd=_parse_acv(text),
        gate_contract_term=_parse_term(text),
        gate_contract_modules=_parse_modules(text),
        gate_platform_tier=_parse_platform_tier(text),
        gate_account_segment=_parse_segment(text),
        gate_subscribers=_parse_subscribers(text),
        tcv=_parse_tcv(text),
        billing_freq=_parse_billing_freq(text),
        payment_terms=_parse_payment_terms(text),
        discount=discount,
        discount_reason=discount_reason,
        geography=_parse_geography(text),
        module_caveats=None,
        audit_notes=None,
        other_terms=_parse_other_terms(text),
        confidence="low",
        notes="Stub extractor — best-effort regex match, please review every field.",
    )


# ============================================================
# Real Claude call
# ============================================================

_SYSTEM_PROMPT = """You extract structured Client Signed + Contract Audit fields from a Beroe contract document.

Output a SINGLE JSON object with this exact shape — omit any field you cannot infer from the text (do not invent values):

{
  "gate_signed_date":      "YYYY-MM-DD" or null,
  "gate_renewal_date":     "YYYY-MM-DD" or null,
  "gate_contract_acv_usd": number (USD) or null,
  "gate_contract_term":    one of ["1 year","2 years","3 years","5 years","Custom"] or null,
  "gate_contract_modules": [ "Category Watch", "Abi Intelligence", "Benchmarks", "Custom Credits", "Supplier Discovery", "Supplier Risk", "Live.ai", "MMD", "Sourcing Optimizer", "Copilot", "DataHub", "Diverse Supplier Directory", "Supply Chain Risk" ]   (subset that actually appears),
  "gate_platform_tier":    one of ["EL Base","EL Plus","EL Premium","Enterprise","Pro","Custom"] or null,
  "gate_account_segment":  "A" or "B" or "C" or null,
  "gate_subscribers":      free text like "Unlimited (Enterprise)" or "25 users" or null,

  "tcv":                   string verbatim ("$930K" / "1,200,000") or null,
  "billing_freq":          one of ["Annual","Bi-annual","Quarterly","Monthly"] or null,
  "payment_terms":         one of ["Net 15","Net 30","Net 45","Net 60","Net 90","Upon receipt","Custom"] or null,
  "discount":              percent as a string ("12" / "12.5", no %) or null,
  "discount_reason":       short reason ("Multi-year prepay") or null,
  "geography":             one of ["Global","North America","EMEA","APAC","LATAM","Multi-region (custom)"] or null,
  "module_caveats":        free text — module-specific carve-outs / caps / side commitments, or null,
  "audit_notes":           free text — pricing protection, rate-card, MFN clauses, or null,
  "other_terms":           free text — termination, renewal option, audit rights, QBR cadence, indemnification, SLAs etc., or null,

  "confidence":            "high" | "medium" | "low",
  "notes":                 short one-line clarification or null
}

Rules:
- gate_contract_acv_usd is the ANNUAL contract value in USD as a plain number (no $ or commas). If the doc only states a multi-year total, divide by the year count.
- gate_contract_term must be one of the enumerated values; map "annual" → "1 year", "biennial" → "2 years", anything bespoke → "Custom".
- gate_contract_modules: include only modules whose names appear literally in the text.
- gate_renewal_date: parse from "expires on", "renewal date", "term ends", or compute from signed_date + term if the doc states the term unambiguously.
- tcv: keep the doc's verbatim formatting ("$2.4M" / "USD 930,000") — the UI displays it as-is.
- billing_freq / payment_terms / geography: pick the closest enumerated value; if the doc says "billed annually in arrears, Net 60", emit billing_freq="Annual" + payment_terms="Net 60".
- discount: numeric percent only. "12% multi-year prepay discount" → discount="12", discount_reason="Multi-year prepay".
- module_caveats: 1-3 short clauses about module-level caps / carve-outs ("Custom Credits capped at 400 hrs/year; PowerBI connector deferred to Q3").
- audit_notes: pricing protection, MFN, rate-card terms — anything financially material that isn't TCV/ACV/discount.
- other_terms: list the named non-commercial clauses present (Termination · Audit Rights · QBR cadence · Indemnification · SLA) as a short " · "-separated summary.
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
            gate_renewal_date=date.fromisoformat(data["gate_renewal_date"]) if data.get("gate_renewal_date") else None,
            gate_contract_acv_usd=Decimal(str(data["gate_contract_acv_usd"])) if data.get("gate_contract_acv_usd") is not None else None,
            gate_contract_term=data.get("gate_contract_term"),
            gate_contract_modules=data.get("gate_contract_modules") or [],
            gate_platform_tier=data.get("gate_platform_tier"),
            gate_account_segment=data.get("gate_account_segment"),
            gate_subscribers=data.get("gate_subscribers"),
            # 05-Jun — Contract Audit "extras" fields.
            tcv=data.get("tcv"),
            billing_freq=data.get("billing_freq"),
            payment_terms=data.get("payment_terms"),
            discount=str(data["discount"]) if data.get("discount") is not None else None,
            discount_reason=data.get("discount_reason"),
            geography=data.get("geography"),
            module_caveats=data.get("module_caveats"),
            audit_notes=data.get("audit_notes"),
            other_terms=data.get("other_terms"),
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
