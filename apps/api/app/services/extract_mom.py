"""MoM → structured fields extraction.

Takes raw text from an MoM document and returns a `MomExtractionResult` —
a normalised payload the review modal can fan out to engagement / contacts /
brief PATCH+POST calls.

Two modes:
  - Real: Anthropic key present → single Claude call with strict JSON schema
  - Stub: no real key → deterministic parser tuned to the SDR template we
    see in Ciena/Caldic/FTI (23-section heading layout). Lets the full flow
    be demoed without burning the AI budget.

The stub is more than a placeholder — for SDR-template MoMs it produces
genuinely useful output. Real Claude wins on freeform / variant-shape MoMs.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import time
from datetime import date, datetime
from typing import Any

from app.core.config import get_settings
from app.schemas.contact import ContactDecisionPower, ContactFunction, ContactSeniority
from app.schemas.mom_extraction import (
    ExtractedAccountFields,
    ExtractedBrief,
    ExtractedContact,
    ExtractedEngagement,
    MomExtractionResult,
)
from app.services.claude import (
    _is_transient_anthropic_error,
    _key_looks_real,
    _truncate_for_prompt,
)

logger = logging.getLogger(__name__)

# 24h TTL cache keyed by (model, sha256(text)) — repeated previews on the same
# doc don't bill twice.
_cache: dict[str, tuple[float, MomExtractionResult]] = {}
_CACHE_TTL_SECONDS = 24 * 3600

_JSON_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.MULTILINE)
_JSON_OBJECT_RE = re.compile(r"\{[\s\S]*\}")

# ============================================================
# Public entry point
# ============================================================


def extract_from_mom(document_id, text: str) -> MomExtractionResult:
    """Single public surface. Picks real-Claude or stub based on the API key."""
    settings = get_settings()
    key = settings.anthropic_api_key.get_secret_value()
    if not _key_looks_real(key):
        result = _stub_extract(text)
    else:
        digest = hashlib.sha256(
            f"mom|{settings.anthropic_model}|{text}".encode("utf-8")
        ).hexdigest()
        now = time.time()
        cached = _cache.get(digest)
        if cached and (now - cached[0]) < _CACHE_TTL_SECONDS:
            result = cached[1].model_copy(update={"document_id": document_id})
        else:
            try:
                result = _real_extract(text)
                _cache[digest] = (now, result)
            except Exception as e:  # noqa: BLE001
                if _is_transient_anthropic_error(e):
                    try:
                        result = _real_extract(text)
                        _cache[digest] = (now, result)
                    except Exception as e2:  # noqa: BLE001
                        logger.warning("MoM extraction failed, using stub: %s", e2)
                        result = _stub_extract(text)
                else:
                    logger.warning("MoM extraction failed, using stub: %s", e)
                    result = _stub_extract(text)

    # Set document_id on the result before returning.
    return result.model_copy(update={"document_id": document_id})


# ============================================================
# Real Claude call
# ============================================================


_SYSTEM_PROMPT = """You extract structured fields from procurement Meeting-of-Minutes (MoM) documents prepared by Beroe SDRs.

These MoMs follow a loose 23-section heading template (Account Name, Meeting Date, Contacts/Attendees, Meeting Type, Company Profile, Trigger Intel, Annual Revenue, GICS Industry, Headquarters, Focus Industry, Focus Region, SF Link, Total Procurement Contacts, Additional info, Top Procurement Contacts, Competitor Companies, Beroe Clients in Similar Industry, Clients in the same country, Presence of internal MI Team, Company Insights, Intent Signals, Legacy Beroe LiVE Stats). Use these headings as anchors when present; do not invent fields that aren't in the text.

You output a SINGLE JSON object with this exact shape (omit fields you can't infer — never make them up):

{
  "account_fields": {
    "industry": <string|null>,
    "country": <string|null>,
    "headquarters": <string|null — full address line>,
    "annual_revenue_text": <string|null — verbatim from the doc, e.g. "$2.5B" or "USD 4.77 Billion">,
    "tier_band": <string|null — like "1-3B" or "3-5B", inferred from Meeting Type>,
    "sf_link": <string|null — Salesforce URL>
  },
  "engagement": {
    "meeting_type": <string|null — verbatim, e.g. "1-3B Regular" or "3-5B Trigger + Lost Client">,
    "engagement_objective": <string|null — 80-150 words describing why this meeting matters; reference category, trigger, value angle. NEVER copy headings verbatim.>,
    "target_categories": [<≤4 strings from Intent Signals + Top categories>],
    "geographies": [<countries / regions, e.g. ["Netherlands", "APAC"]>],
    "spoc_text": <string|null — the named meeting attendee with title>,
    "sponsor_text": <string|null — most senior procurement contact named>,
    "procurement_maturity": <"low"|"medium"|"high"|null — infer from Legacy LiVE Stats: high if CEB+many users, medium if some registered, low if "Not a CEB" + nobody registered>
  },
  "contacts": [
    {
      "name": <string>,
      "title": <string|null>,
      "linkedin_url": <string|null>,
      "function": <"procurement"|"supply_chain"|"finance"|"operations"|"it"|"other"|null>,
      "seniority": <"cxo"|"vp"|"director"|"manager"|"other"|null — CPO=cxo, VP/SVP=vp, Head of/Director=director, Manager=manager>,
      "decision_power": <"executive_sponsor"|"influencer"|"champion"|"detractor"|"unknown"|null — CPO/SVP=executive_sponsor, Director=influencer, Manager/Specialist=champion>,
      "is_spoc": <bool — true ONLY for the named meeting attendee>,
      "is_sponsor": <bool — true for the most senior named procurement person>,
      "is_internal_beroe": <bool — true for "internal MI Team" people; they're Beroe staff, NOT to be created as client contacts>
    }
  ],
  "brief": {
    "call_date": <"YYYY-MM-DD"|null>,
    "call_type": <"first_discovery"|"qbr"|"renewal"|"expansion"|"other"|null — "Regular"+"Lost Client"=first_discovery, QBR=qbr, Renewal=renewal>,
    "call_duration_minutes": <int|null — parsed from "(30 minutes)" / "(60 mins)">,
    "win_condition": <string|null — 1-2 sentence "what does a successful meeting look like" inferred from Meeting Type + Trigger>,
    "company_snapshot": [{"num": <string>, "label": <string>, "sub": <string|null>}],
    "attendees": [{"initials": <up-to-4-char>, "name": <string>, "role": <string|null>, "company": <"client"|"beroe">, "is_self": false, "objectives": []}],
    "news": [{"days_ago": <int|null>, "headline": <string>, "url": <string|null>, "signal": <string|null — 1-line "so what">}],
    "public_signals": [{"person": <string|null>, "headline": <string>, "url": <string|null>, "tag": <string|null>}],
    "value_anchors": [{"objective": <string>, "points": [{"text": <string>, "note": <string|null>}]}],
    "email_insights": [{"meta": <string>, "bullets": [<string>]}],
    "cheat_sheet_never_say": [<string>],
    "cheat_sheet_opening_asks": [<string>]
  },
  "notes": <string|null — what was missing or low-confidence, ≤300 chars>
}

GUIDANCE:
- Treat the meeting attendee (under "Contacts:" or "Attendees:") as the SPOC (is_spoc=true).
- For each "Top Procurement Contact", create a contact row. The most senior (CPO/VP/SVP) is the sponsor (is_sponsor=true).
- "Presence of internal MI Team" rows → is_internal_beroe=true (Beroe staff, not client).
- company_snapshot: build 2-4 stat cards from Annual Revenue + Total Procurement Contacts + headcount facts in Company Insights. Format like {"num": "$2.5B", "label": "Revenue"}.
- news[].days_ago: compute from today's date vs the date in the entry ONLY if you're certain; otherwise leave null and include the date in the headline.
- value_anchors: ONE entry from "Beroe Clients in Similar Industry" (objective="Show Beroe traction in {industry}", points=[{text: company}, ...]) and ONE from "Clients in the same country".
- email_insights: ONE entry summarising "Legacy Beroe LiVE Stats" (meta="LiVE platform engagement", bullets=[CEB status, registered users, time on platform]).
- cheat_sheet_never_say: extract 1-3 from Trigger Intel / Lost Client context (e.g. "Don't bring up the 2021 lost opportunity unless they do").
- cheat_sheet_opening_asks: extract 1-3 questions you'd open with.
- engagement.engagement_objective: 80-150 words, third-person, refers to the account by name. Specific not generic.

OUTPUT RULES:
- Output ONLY the JSON object. No markdown fences. No preamble. No trailing prose.
- All string fields ≤600 chars unless schema allows more (engagement_objective ≤1200).
- Empty lists are `[]`, not omitted. Missing scalars are `null`.
"""


def _real_extract(text: str) -> MomExtractionResult:
    settings = get_settings()
    from anthropic import Anthropic  # type: ignore

    client = Anthropic(api_key=settings.anthropic_api_key.get_secret_value())
    msg = client.messages.create(
        model=settings.anthropic_model,
        max_tokens=4000,
        system=_SYSTEM_PROMPT,
        messages=[
            {
                "role": "user",
                "content": f"MOM TEXT:\n\n{_truncate_for_prompt(text)}",
            }
        ],
    )
    raw = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")
    cleaned = _JSON_FENCE_RE.sub("", raw).strip()
    m = _JSON_OBJECT_RE.search(cleaned)
    candidate = m.group(0) if m else cleaned
    parsed = json.loads(candidate)
    return _coerce_to_result(parsed, is_stub=False)


# ============================================================
# Deterministic stub (also used as fallback on real-Claude failure)
# ============================================================


_SECTION_HEADERS = (
    "account name",
    "meeting date",
    "contacts",
    "attendees",
    "meeting type",
    "company profile",
    "trigger intel",
    "annual revenue",
    "gics industry",
    "headquarters",
    "focus industry",
    "focus region",
    "sf link",
    "total procurement contacts",
    "additional info",
    "top procurement contacts",
    "competitor companies",
    "beroe clients in the similar industry",
    "beroe clients",
    "clients in the same country",
    "presence of internal mi team",
    "company insights",
    "intent signals",
    "legacy beroe live stats",
)


def _parse_sections(text: str) -> dict[str, str]:
    """Walk lines, treat any 'Heading:' line that matches a known header as a
    section anchor, then collect the body until the next anchor."""
    sections: dict[str, list[str]] = {}
    current: str | None = None
    body_lines: list[str] = []

    def flush() -> None:
        if current:
            sections.setdefault(current, []).extend(body_lines)

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            if current:
                body_lines.append("")
            continue
        # Header detection: "<label>:" — accept anywhere on the line, case-insensitive.
        # We split on the first colon.
        if ":" in line:
            label_part = line.split(":", 1)[0].strip().lower()
            rest = line.split(":", 1)[1].strip()
            if label_part in _SECTION_HEADERS:
                flush()
                current = label_part
                body_lines = [rest] if rest else []
                continue
        body_lines.append(line)

    flush()
    return {k: "\n".join(v).strip() for k, v in sections.items()}


def _stub_extract(text: str) -> MomExtractionResult:
    s = _parse_sections(text)

    # --- account fields ---
    account = ExtractedAccountFields(
        industry=_first_nonempty(s.get("gics industry")),
        country=_first_nonempty(s.get("headquarters")),
        headquarters=_first_nonempty(s.get("headquarters")),
        annual_revenue_text=_strip_url_markup(_first_nonempty(s.get("annual revenue"))),
        tier_band=_parse_tier_band(s.get("meeting type")),
        sf_link=_first_url(s.get("sf link")),
    )

    # --- engagement ---
    intent = _split_csv_or_lines(s.get("intent signals"))
    geos = _infer_geographies(s.get("headquarters"), s.get("total procurement contacts"))
    contact_attendee_line = s.get("contacts") or s.get("attendees") or ""
    spoc_text = _strip_url_markup(_first_line(contact_attendee_line)) or None
    top_contacts_text = s.get("top procurement contacts") or ""
    sponsor_line = _find_most_senior(top_contacts_text)
    engagement = ExtractedEngagement(
        meeting_type=_first_nonempty(s.get("meeting type")),
        engagement_objective=_compose_objective(s),
        target_categories=intent[:4],
        geographies=geos,
        spoc_text=spoc_text,
        sponsor_text=_strip_url_markup(sponsor_line) if sponsor_line else None,
        procurement_maturity=_infer_maturity(s.get("legacy beroe live stats")),
    )

    # --- contacts ---
    contacts: list[ExtractedContact] = []
    seen_names: set[str] = set()

    spoc_name, spoc_title, spoc_link = _parse_contact_line(_first_line(contact_attendee_line))
    if spoc_name:
        contacts.append(_build_contact(
            spoc_name, spoc_title, spoc_link, is_spoc=True, is_sponsor=False,
        ))
        seen_names.add(spoc_name.lower())

    sponsor_name_lc: str | None = None
    if sponsor_line:
        sname, stitle, slink = _parse_contact_line(sponsor_line)
        if sname:
            sponsor_name_lc = sname.lower()

    for line in (top_contacts_text or "").splitlines():
        ln = line.strip(" •-*\t")
        if not ln:
            continue
        n, t, lk = _parse_contact_line(ln)
        if not n or n.lower() in seen_names:
            # If it's the SPOC, still mark sponsor flag if applicable.
            if n and sponsor_name_lc and n.lower() == sponsor_name_lc:
                for c in contacts:
                    if c.name.lower() == n.lower():
                        c.is_sponsor = True
            continue
        contacts.append(_build_contact(
            n, t, lk, is_spoc=False,
            is_sponsor=(sponsor_name_lc is not None and n.lower() == sponsor_name_lc),
        ))
        seen_names.add(n.lower())

    for line in (s.get("presence of internal mi team") or "").splitlines():
        ln = line.strip(" •-*\t")
        if not ln:
            continue
        n, t, lk = _parse_contact_line(ln)
        if not n or n.lower() in seen_names:
            continue
        c = _build_contact(n, t, lk, is_spoc=False, is_sponsor=False)
        c.is_internal_beroe = True
        contacts.append(c)
        seen_names.add(n.lower())

    # --- brief ---
    call_date, call_duration = _parse_meeting_date(s.get("meeting date"))
    brief = ExtractedBrief(
        call_date=call_date,
        call_type=_infer_call_type(s.get("meeting type")),
        call_duration_minutes=call_duration,
        win_condition=_compose_win_condition(s),
        company_snapshot=_build_snapshot(s),
        attendees=_build_attendees(s),
        news=_build_news(s.get("additional info")),
        public_signals=[],
        value_anchors=_build_value_anchors(s),
        email_insights=_build_email_insights(s.get("legacy beroe live stats")),
        cheat_sheet_never_say=_build_never_say(s),
        cheat_sheet_opening_asks=_build_opening_asks(s),
    )

    return MomExtractionResult(
        document_id="00000000-0000-0000-0000-000000000000",  # caller overrides
        is_stub=True,
        notes=(
            "Stub extraction (no Anthropic key configured). Most fields parsed deterministically "
            "from the SDR template; review before applying."
        ),
        account_fields=account,
        engagement=engagement,
        contacts=contacts,
        brief=brief,
    )


# ============================================================
# Parsing helpers (used by stub; safe + lenient)
# ============================================================


def _first_nonempty(value: str | None) -> str | None:
    if not value:
        return None
    for line in value.splitlines():
        s = line.strip()
        if s:
            return s
    return None


def _first_line(value: str) -> str:
    for line in (value or "").splitlines():
        s = line.strip()
        if s:
            return s
    return ""


def _strip_url_markup(value: str | None) -> str | None:
    """`Name<https://linkedin.com/...>` → `Name`. Outlook-style inline URL markup."""
    if not value:
        return None
    s = re.sub(r"<https?://[^>]+>", "", value).strip()
    return s or None


def _first_url(value: str | None) -> str | None:
    if not value:
        return None
    m = re.search(r"https?://[^\s>)]+", value)
    return m.group(0) if m else None


def _parse_tier_band(meeting_type: str | None) -> str | None:
    if not meeting_type:
        return None
    m = re.search(r"(\d+\s*-\s*\d+\s*B)", meeting_type, re.I)
    return m.group(1).replace(" ", "").upper() if m else None


def _split_csv_or_lines(value: str | None) -> list[str]:
    if not value:
        return []
    if "," in value:
        return [x.strip(" •-*") for x in value.split(",") if x.strip(" •-*")]
    return [x.strip(" •-*") for x in value.splitlines() if x.strip(" •-*")]


def _infer_geographies(headquarters: str | None, contacts_breakdown: str | None) -> list[str]:
    out: list[str] = []
    hq = _first_nonempty(headquarters)
    if hq:
        # Last segment after comma is usually country/region.
        seg = hq.split(",")[-1].strip()
        if seg and len(seg) <= 60:
            out.append(seg)
    if contacts_breakdown:
        for region in ("APAC", "EMEA", "Europe", "USA", "North America", "LATAM"):
            if re.search(rf"\b{region}\b", contacts_breakdown, re.I) and region not in out:
                out.append(region)
    # Cap + dedupe preserving order.
    seen: set[str] = set()
    result: list[str] = []
    for g in out:
        if g.lower() not in seen:
            seen.add(g.lower())
            result.append(g)
    return result[:4]


_SENIORITY_PATTERNS: list[tuple[str, ContactSeniority]] = [
    (r"\b(CPO|Chief\s+Procurement\s+Officer|CXO|Chief\s+\w+\s+Officer)\b", "cxo"),
    (r"\b(SVP|VP|Vice\s+President)\b", "vp"),
    (r"\b(Director|Head\s+of)\b", "director"),
    (r"\b(Manager|Lead|Specialist)\b", "manager"),
]


def _classify_seniority(title: str | None) -> ContactSeniority | None:
    if not title:
        return None
    for pat, lvl in _SENIORITY_PATTERNS:
        if re.search(pat, title, re.I):
            return lvl
    return "other"


def _classify_function(title: str | None) -> ContactFunction | None:
    if not title:
        return None
    t = title.lower()
    if "procure" in t or "sourcing" in t or "category" in t:
        return "procurement"
    if "supply" in t or "logistic" in t:
        return "supply_chain"
    if "finance" in t or "treasury" in t:
        return "finance"
    if "operations" in t:
        return "operations"
    if " it " in f" {t} " or t.startswith("it ") or "information technology" in t:
        return "it"
    return "other"


def _classify_decision_power(seniority: ContactSeniority | None) -> ContactDecisionPower:
    if seniority in ("cxo", "vp"):
        return "executive_sponsor"
    if seniority == "director":
        return "influencer"
    if seniority == "manager":
        return "champion"
    return "unknown"


_CONTACT_LINE_RE = re.compile(
    r"^\s*(?P<name>[A-Z][a-zA-Z'.\-]+(?:\s+[A-Z][a-zA-Z'.\-]+)+)\s*"
    r"(?:<(?P<link>https?://[^>]+)>)?\s*"
    r"(?:[-–—:]\s*(?P<title>.+?))?\s*$"
)


def _parse_contact_line(line: str) -> tuple[str | None, str | None, str | None]:
    """`Rene Dam Andersen<https://linkedin.../> - Head of Procurement APAC` →
    (name, title, linkedin_url)."""
    if not line:
        return None, None, None
    # Strip leading bullet glyphs.
    cleaned = re.sub(r"^[\s•\-*\t]+", "", line).rstrip(".")
    m = _CONTACT_LINE_RE.match(cleaned)
    if not m:
        return None, None, None
    name = (m.group("name") or "").strip()
    title = (m.group("title") or "").strip() or None
    link = (m.group("link") or "").strip() or None
    return name, title, link


def _build_contact(
    name: str, title: str | None, linkedin: str | None,
    *, is_spoc: bool, is_sponsor: bool,
) -> ExtractedContact:
    seniority = _classify_seniority(title)
    return ExtractedContact(
        name=name[:200],
        title=title[:200] if title else None,
        linkedin_url=linkedin[:600] if linkedin else None,
        function=_classify_function(title),
        seniority=seniority,
        decision_power=_classify_decision_power(seniority),
        is_spoc=is_spoc,
        is_sponsor=is_sponsor,
        is_internal_beroe=False,
    )


def _find_most_senior(top_contacts_text: str | None) -> str | None:
    """Pick the line with the highest seniority. CPO/VP > Director > Manager."""
    if not top_contacts_text:
        return None
    rank = {"cxo": 0, "vp": 1, "director": 2, "manager": 3, "other": 4, None: 5}
    best: tuple[int, str] | None = None
    for line in top_contacts_text.splitlines():
        ln = line.strip(" •-*\t")
        if not ln:
            continue
        _, title, _ = _parse_contact_line(ln)
        sen = _classify_seniority(title)
        r = rank.get(sen, 5)
        if best is None or r < best[0]:
            best = (r, ln)
    return best[1] if best else None


def _infer_maturity(legacy_stats: str | None) -> str | None:
    if not legacy_stats:
        return None
    s = legacy_stats.lower()
    if "not a ceb" in s and ("no one has registered" in s or "not a registered user" in s):
        return "low"
    if "ceb member" in s and ("registered user" in s or "logged user" in s):
        return "high"
    if "registered user" in s:
        return "medium"
    return None


_DATE_PATTERNS = [
    # 26th March, Thursday at 12:30 PM IST
    re.compile(
        r"(?P<day>\d{1,2})(?:st|nd|rd|th)?\s+"
        r"(?P<month>Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*"
        r"(?:[,]?\s*(?P<year>\d{4}))?",
        re.I,
    ),
    # Wednesday, 25th March at 8 PM IST
    re.compile(
        r"(?P<wday>Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+"
        r"(?P<day>\d{1,2})(?:st|nd|rd|th)?\s+"
        r"(?P<month>Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*"
        r"(?:[,]?\s*(?P<year>\d{4}))?",
        re.I,
    ),
]

_MONTH_MAP = {m.lower(): i for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], start=1)
}


def _parse_meeting_date(meeting_date_text: str | None) -> tuple[date | None, int | None]:
    if not meeting_date_text:
        return None, None
    duration_match = re.search(r"\((\d+)\s*(?:min|mins|minute)", meeting_date_text, re.I)
    duration = int(duration_match.group(1)) if duration_match else None

    for pat in _DATE_PATTERNS:
        m = pat.search(meeting_date_text)
        if not m:
            continue
        day = int(m.group("day"))
        month_token = m.group("month")[:3].lower()
        month = _MONTH_MAP.get(month_token)
        year_tok = m.groupdict().get("year")
        year = int(year_tok) if year_tok else datetime.utcnow().year
        if month is None:
            continue
        try:
            return date(year, month, day), duration
        except ValueError:
            continue
    return None, duration


def _infer_call_type(meeting_type: str | None) -> str | None:
    if not meeting_type:
        return None
    t = meeting_type.lower()
    if "renewal" in t:
        return "renewal"
    if "qbr" in t:
        return "qbr"
    if "expansion" in t or "upsell" in t:
        return "expansion"
    if "regular" in t or "trigger" in t or "lost client" in t or "discovery" in t:
        return "first_discovery"
    return "other"


def _compose_objective(s: dict[str, str]) -> str | None:
    """Build an 80-150 word engagement objective from the section bag."""
    profile = _first_nonempty(s.get("company profile"))
    mt = _first_nonempty(s.get("meeting type")) or "discovery call"
    trigger = _first_nonempty(s.get("trigger intel"))
    intent = _first_nonempty(s.get("intent signals"))
    industry = _first_nonempty(s.get("gics industry"))
    if not profile:
        return None
    parts: list[str] = []
    parts.append(f"Engagement context — {mt}.")
    parts.append(profile)
    if industry:
        parts.append(f"Industry: {industry}.")
    if trigger and trigger.upper() != "NA":
        parts.append(f"Trigger: {trigger}.")
    if intent:
        parts.append(f"Identified intent signals: {intent}.")
    objective = " ".join(parts)
    return objective[:1200]


def _compose_win_condition(s: dict[str, str]) -> str | None:
    mt = _first_nonempty(s.get("meeting type"))
    trigger = _first_nonempty(s.get("trigger intel"))
    if mt and trigger and trigger.upper() != "NA":
        return f"A successful {mt} call moves the {trigger.lower()} conversation forward to a follow-up commitment."
    if mt:
        return f"A successful {mt} call surfaces 2-3 concrete category priorities and a follow-up date."
    return None


def _build_snapshot(s: dict[str, str]) -> list[dict[str, Any]]:
    stats: list[dict[str, Any]] = []
    rev = _strip_url_markup(_first_nonempty(s.get("annual revenue")))
    if rev:
        stats.append({"num": rev[:40], "label": "Annual Revenue", "sub": None})
    contacts_total = _first_nonempty(s.get("total procurement contacts"))
    if contacts_total:
        m = re.search(r"\b(\d+)\b", contacts_total)
        if m:
            stats.append({
                "num": m.group(1)[:40],
                "label": "Procurement Contacts",
                "sub": _strip_url_markup(contacts_total[:120]),
            })
    insights = _first_nonempty(s.get("company insights"))
    if insights:
        for line in (s.get("company insights") or "").splitlines():
            ln = line.strip(" •-*\t")
            mm = re.search(r"(\+?\d+%)", ln)
            if mm and "headcount" in ln.lower():
                stats.append({
                    "num": mm.group(1)[:40], "label": "Headcount 2Y",
                    "sub": ln[:120],
                })
                break
    return stats[:4]


def _build_attendees(s: dict[str, str]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    raw_attendee = _first_nonempty(s.get("contacts") or s.get("attendees"))
    if not raw_attendee:
        return out
    name, title, _ = _parse_contact_line(raw_attendee)
    if name:
        out.append({
            "initials": _initials(name),
            "name": name[:120],
            "role": title[:160] if title else None,
            "company": "client",
            "is_self": False,
            "objectives": [],
        })
    return out


def _initials(name: str) -> str:
    parts = [p for p in name.split() if p]
    if not parts:
        return "??"
    if len(parts) == 1:
        return parts[0][:2].upper()
    return (parts[0][0] + parts[-1][0]).upper()[:4]


def _build_news(additional_info: str | None) -> list[dict[str, Any]]:
    if not additional_info:
        return []
    items: list[dict[str, Any]] = []
    today = date.today()
    # Lines look like: "Mar 3, 2026: Caldic Partners..."
    line_re = re.compile(
        r"(?P<m>Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+"
        r"(?P<d>\d{1,2}),?\s+(?P<y>\d{4})\s*:?[\s—-]*(?P<rest>.+?)(?:\.|$)",
        re.I,
    )
    for raw in additional_info.splitlines():
        ln = _strip_url_markup(raw.strip(" •-*\t"))
        if not ln:
            continue
        m = line_re.search(ln)
        if not m:
            continue
        try:
            d = date(int(m.group("y")), _MONTH_MAP[m.group("m")[:3].lower()], int(m.group("d")))
            delta = (today - d).days
            days_ago = max(0, delta) if delta is not None else None
        except (KeyError, ValueError):
            days_ago = None
        rest = m.group("rest").strip()
        url = _first_url(raw)
        items.append({
            "days_ago": days_ago,
            "headline": rest[:240],
            "source": None,
            "signal": None,
            "url": url[:600] if url else None,
            "tag": "news",
        })
    return items[:5]


def _build_value_anchors(s: dict[str, str]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    similar = _first_nonempty(s.get("beroe clients in the similar industry") or s.get("beroe clients"))
    if similar:
        companies = [c.strip() for c in similar.split(",") if c.strip()]
        if companies:
            industry = _first_nonempty(s.get("gics industry")) or "this industry"
            out.append({
                "objective": f"Beroe traction in {industry}",
                "points": [{"text": c[:240], "note": None} for c in companies[:6]],
            })
    same_country = _first_nonempty(s.get("clients in the same country"))
    if same_country:
        companies = [c.strip() for c in same_country.split(",") if c.strip()]
        if companies:
            country = _first_nonempty(s.get("headquarters")) or "this country"
            country_short = country.split(",")[-1].strip()
            out.append({
                "objective": f"Beroe clients in {country_short}",
                "points": [{"text": c[:240], "note": None} for c in companies[:6]],
            })
    return out


def _build_email_insights(legacy_stats: str | None) -> list[dict[str, Any]]:
    if not legacy_stats:
        return []
    bullets: list[str] = []
    for raw in legacy_stats.splitlines():
        ln = raw.strip(" •-*\t")
        if ln:
            bullets.append(ln[:200])
    if not bullets:
        return []
    return [{"meta": "Legacy Beroe LiVE Stats", "bullets": bullets[:8]}]


def _build_never_say(s: dict[str, str]) -> list[str]:
    out: list[str] = []
    trigger = (s.get("trigger intel") or "").lower()
    mt = (s.get("meeting type") or "").lower()
    if "lost client" in mt:
        out.append("Don't reopen the prior lost-opportunity unless they bring it up first.")
    if "coe" in trigger:
        out.append("Don't position Beroe as replacement for their CoE — frame as augmentation.")
    return out[:3]


def _build_opening_asks(s: dict[str, str]) -> list[str]:
    out: list[str] = []
    intent = _first_nonempty(s.get("intent signals"))
    if intent:
        out.append(f"Where are you in your {intent.lower()} journey today?")
    profile = _first_nonempty(s.get("company profile"))
    if profile:
        out.append("What's the #1 procurement priority your CPO is asking about this quarter?")
    return out[:3]


# ============================================================
# JSON -> Pydantic coercion (used by real-Claude path)
# ============================================================


def _coerce_to_result(data: dict[str, Any], *, is_stub: bool) -> MomExtractionResult:
    """Be lenient with the model's output — drop fields we can't validate
    rather than 500-ing. document_id is a placeholder; caller overrides."""
    raw_contacts = data.get("contacts") or []
    contacts: list[ExtractedContact] = []
    for c in raw_contacts:
        if not isinstance(c, dict) or not c.get("name"):
            continue
        try:
            contacts.append(ExtractedContact.model_validate(c))
        except Exception:  # noqa: BLE001
            continue

    try:
        account = ExtractedAccountFields.model_validate(data.get("account_fields") or {})
    except Exception:  # noqa: BLE001
        account = ExtractedAccountFields()

    try:
        engagement = ExtractedEngagement.model_validate(data.get("engagement") or {})
    except Exception:  # noqa: BLE001
        engagement = ExtractedEngagement()

    try:
        brief = ExtractedBrief.model_validate(data.get("brief") or {})
    except Exception:  # noqa: BLE001
        brief = ExtractedBrief()

    notes_value = data.get("notes")
    notes = str(notes_value)[:2000] if notes_value else None

    return MomExtractionResult(
        document_id="00000000-0000-0000-0000-000000000000",  # caller overrides
        is_stub=is_stub,
        notes=notes,
        account_fields=account,
        engagement=engagement,
        contacts=contacts,
        brief=brief,
    )
