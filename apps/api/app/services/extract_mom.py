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
    """Single public surface. Picks real LLM (gateway or Anthropic) or stub."""
    from app.services import llm

    if not llm.is_configured():
        result = _stub_extract(text)
    else:
        digest = hashlib.sha256(
            f"mom|{llm.backend_label()}|{text}".encode("utf-8")
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


_SYSTEM_PROMPT = """You extract structured fields from procurement Meeting-of-Minutes (MoM) documents.

MoMs arrive in ANY format. Two common shapes:
  (a) Beroe SDR 23-section template — explicit headings like "Account Name",
      "Meeting Type", "Trigger Intel", "Legacy Beroe LiVE Stats", "Top
      Procurement Contacts", etc.
  (b) Free-form discovery / discussion notes — narrative sections like
      "ATTENDEES", "AGENDA", "DISCUSSION SUMMARY", "CATEGORIES OF INTEREST",
      "DECISION MAKING STRUCTURE", "PAIN POINTS", "NEXT STEPS".

Read the document end-to-end and pull whatever signal is in there,
regardless of heading style. Don't require a specific section name — if
the meeting attendees are in a bulleted list under "ATTENDEES:", use that;
if the categories are referenced inside a narrative paragraph, lift them.
Never invent fields that aren't supported by the text.

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
    "engagement_objective": <string|null — bullet list, 4-8 short bullets each on its own line prefixed with '- ', explaining why this meeting matters; reference category, trigger, value angle. NEVER a paragraph; NEVER copy headings verbatim.>,
    "target_categories": [<≤4 strings from Intent Signals + Top categories>],
    "geographies": [<countries / regions, e.g. ["Netherlands", "APAC"]>],
    "spoc_text": <string|null — the named meeting attendee with title>,
    "sponsor_text": <string|null — most senior procurement contact named>,
    "procurement_maturity": <"low"|"medium"|"high"|null — infer from Legacy LiVE Stats: high if CEB+many users, medium if some registered, low if "Not a CEB" + nobody registered>,
    "pre_discovery_date": <"YYYY-MM-DD"|null — date of the discovery / kick-off meeting itself. Parse from "Date: October 15, 2024" / "Meeting Date: 01/05/2026" / "(15-Oct-2024)" headers. Must be today or earlier (a past event).>,
    "discovery_lead": <string|null — the Beroe teammate who RAN discovery. Usually labelled "SDR", "Discovery Lead", "Recorded by", or the Beroe attendee most senior on the call. Just the name verbatim ("Nivedha", "Aditya Pherwani"). Strip titles.>,
    "sales_lead": <string|null — the Beroe Sales owner. Usually labelled "Sales", "Account Executive", "AE", "Sales Lead". Just the name verbatim. Strip titles.>,
    "sdr_lead": <string|null — the SDR / lead source. Usually labelled "SDR", "BDR", "Lead Source", "Recorded by". When the SDR also ran the discovery, the same name lands in both discovery_lead and sdr_lead. Just the name verbatim.>
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
    "call_duration_minutes": <int|null — parsed from "(30 minutes)" / "(60 mins)" / "Duration: 45 minutes">,
    "call_time": <string|null — verbatim e.g. "10:00 AM IST" / "2pm UTC" / "14:30 CET". Parse from "Time:" lines or in-text time references. Omit if no time given.>,
    "call_platform": <string|null — meeting platform. Parse from "Location: Virtual (Microsoft Teams)" / "Zoom link" / "Teams meeting" / "Google Meet" / "Webex" / "On-site". Output the platform name only — e.g. "Microsoft Teams", "Zoom", "Google Meet", "On-site".>,
    "categories": [<list of category strings — same as engagement.target_categories. Pull from "Categories of interest", "Primary spend", "Direct Materials", "Indirect categories". Strip ($M) annotations.>],
    "win_condition": <string|null — 1-2 sentence "what does a successful meeting look like" inferred from Meeting Type + Trigger>,
    "cheat_sheet_win_condition_short": <string|null — terse 6-10 word version of win_condition for the cheat sheet, e.g. "Get demo approved within Q3 + executive sponsor introduced">,
    "company_snapshot": [{"num": <string>, "label": <string>, "sub": <string|null>}],
    "attendees": [{"initials": <up-to-4-char>, "name": <string>, "role": <string|null>, "company": <"client"|"beroe">, "is_self": false, "objectives": []}],
    "objectives": [
      {"rank": <int 1-9 — priority>, "name": <string ≤200 — meeting goal>, "confidence": <int 1-5 — how confident this is the right priority>, "bullets": [<≤3 strings>], "beroe": <string|null — "What Beroe will say / do" — what we should bring to land this>, "sources": []}
    ],
    "minefields": [
      {"severity": <"high"|"caution">, "type": <string|null — short category like "BUDGET" / "TIMING" / "STAKEHOLDER" / "COMPETE">, "text": <string ≤400 — the risk in plain English>, "why": <string|null ≤400 — why it matters>}
    ],
    "closing_scenarios": [
      {"type": <"good"|"neutral"|"poor">, "label": <string|null ≤80 — short summary>, "text": <string ≤1200 — the scenario>}
    ],
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
- Account name: pull from any heading or first-line account reference
  (e.g. "Account: Siemens Energy AG" or a "MoM — Siemens Energy" title).
- SPOC / Attendees: ANY list of meeting attendees works (under "Attendees:",
  "ATTENDEES:", "Contacts:", "Participants:", or bulleted at the top).
  The named client participant most frequently quoted in the discussion
  is the SPOC (is_spoc=true). If only one client attendee, that person.
- Sponsor: the most senior procurement contact named in the doc — CPO /
  SVP / VP / "Head of Procurement". May or may not have attended the
  meeting. is_sponsor=true on that contact.
- Beroe / internal MI Team attendees: is_internal_beroe=true so they're
  excluded from the client-contact create flow.
- engagement.target_categories: pull from any "Categories of interest",
  "Focus areas", "Primary spend", "Direct Materials", "Indirect categories"
  section. Bulleted or in-line. Pick the top 4 most material categories.
  Strip commodity-spend annotations (drop "(EUR 8M annual spend)" from
  "Copper").
- engagement.geographies: pull from explicit geography sections OR from
  the headquarters, nearshoring references ("Eastern Europe nearshoring"
  → ["Eastern Europe"]), or category-level country mentions.
- engagement.engagement_objective: BULLET FORMAT — 4-8 bullets, each
  on its own line prefixed with '- '. Synthesise from PAIN POINTS /
  discussion summary / trigger intel — what specifically would Beroe
  solve here. Account by name in at least one bullet. NEVER a paragraph
  (03-Jun bug spec).
- engagement.procurement_maturity: high if the doc mentions advanced
  practices (TPRM, supplier risk monitoring, category management
  function, P2P platforms); medium if some structured procurement
  function exists; low if procurement is ad-hoc or no internal team.
  When in doubt: high if the meeting included a CPO and a category
  manager, medium for one-or-the-other, low for neither.
- engagement.pre_discovery_date: parse from any meeting metadata line —
  "Date: October 15, 2024", "Meeting Date: 01/05/2026", "(15 Oct 2024)",
  "Date held: 2026-05-01". Output as YYYY-MM-DD. Date formats: DD/MM/YYYY
  is the default for European-style ("01/05/2026" → 2026-05-01), US-style
  ("May 1, 2026") parses directly. NEVER set a future date — if the doc
  somehow names a future date, leave null.
- engagement.discovery_lead / sales_lead / sdr_lead: scan the ATTENDEES /
  PARTICIPANTS / "Recorded by" / "MEETING NOTES BY" / Distribution lists
  for Beroe-side names. Role mapping (Beroe role on the doc → field):

    SDR / BDR / Lead-source / Lead-gen        → sdr_lead
    CSM / Customer Success / Discovery /
      Presales / Solutioning / Solutions      → discovery_lead
    Sales / Account Exec / AE /
      Commercial Owner / CO /
      Commercial Lead / Account Manager       → sales_lead

  Examples:
    "Nivedha, SDR, Beroe"                  → sdr_lead="Nivedha", discovery_lead="Nivedha"
    "Anurag Bhagat, CSM, Beroe"            → discovery_lead="Anurag Bhagat", sdr_lead="Anurag Bhagat"
    "Dinesh Gokhale, Commercial Owner, Beroe" → sales_lead="Dinesh Gokhale"
    "Alekh Chatterji, Sales, Beroe"        → sales_lead="Alekh Chatterji"
    "Aditya Pherwani — Sales Lead"         → sales_lead="Aditya Pherwani"
    "Recorded by: Nivedha, SDR"            → sdr_lead="Nivedha"
    "MEETING NOTES BY: Anurag Bhagat, CSM, Beroe" → discovery_lead + sdr_lead = "Anurag Bhagat"

  When the SDR isn't named but a CSM is, mirror the CSM into sdr_lead
  (and vice versa) — the discovery facilitator is the SDR-equivalent.
  When the same person filled multiple Beroe roles, set them in each
  field. Strip honorifics and trailing role markers — only the name
  ("Aditya Pherwani"), no titles, no commas, no parenthetical notes.
  NEVER guess Beroe-side names that aren't named in the doc — leave null.
- brief.call_type: first_discovery for any discovery / intro / initial
  meeting; qbr for "QBR" or "quarterly business review"; renewal for
  "renewal" discussions; expansion for "expand" / "add-on"; other for
  the rest.
- brief.call_date / call_duration_minutes: parse from any meeting metadata
  ("Date: October 15, 2024", "Duration: 45 minutes", "(60 mins)").
- brief.win_condition: synthesise from the agenda or "Next Steps" — what
  does a successful next step from this meeting look like.
- brief.attendees: ONE row per named human in the doc. company="beroe"
  for the Beroe team, "client" otherwise. initials from first letters.
- brief.call_time / call_platform: parse from any meeting metadata —
  "Time: 10am IST", "10:00 AM PT", "Location: Virtual (Microsoft Teams)",
  "Zoom" / "Teams" / "Google Meet" / "Webex" / "On-site at customer
  office". If only platform is given, set call_time=null.
- brief.categories: same as engagement.target_categories — pull from
  "Categories of interest", "Primary spend", etc. Free-form strings
  (e.g. "Copper", "Aluminium", "Rare Earth Elements").
- brief.cheat_sheet_win_condition_short: terse 6-10 word version of
  win_condition — what would a cheat-card on the laptop show. e.g.
  "Confirm 3-vendor consolidation + Eastern Europe coverage".
- brief.objectives: 3-6 objectives extracted from the AGENDA, "DISCUSSION
  SUMMARY", or "Goals" sections. rank=1 for the highest-priority goal
  the meeting was scheduled to land. confidence reflects how certain the
  doc makes the priority — high if the agenda explicitly leads with it,
  medium if it's surfaced once, low if implied. bullets are 1-3 lines of
  concrete sub-goals. `beroe` is what we'd bring to land it.
- brief.minefields: pull from "RISK FLAGS", "Watch-outs", "Concerns",
  "Risks", "Issues". severity="high" for explicit blockers / deadlines
  missed / lost-client scenarios. severity="caution" for items flagged
  as "to monitor" / "could become a risk". type is a 1-2 word category
  (BUDGET / TIMING / COMPETE / STAKEHOLDER / SCOPE / TECH / LEGAL).
  `why` is one sentence — why this matters for the next meeting.
- brief.closing_scenarios: derive 1-3 scenarios from "NEXT STEPS",
  "ACTION ITEMS", "Outcome", or "Decision". type="good" for the path
  forward the client clearly committed to; "neutral" for a follow-up
  meeting / continued evaluation; "poor" for stalls / objections raised.
  `label` is a 4-6 word summary. `text` is the scenario in 1-3
  sentences ("If we send the ROI deck by next Friday, Dr. Richter is
  willing to sign off on a 3-week trial across Copper + Aluminium").
- brief.news, public_signals, value_anchors, email_insights, cheat_sheet_*:
  fill ONLY when the doc surfaces signals worth carrying forward (trigger
  intel / market events / explicit asks). Empty `[]` is fine when nothing
  applies — don't fabricate.
- All extracted prose is plain text; no markdown.

OUTPUT RULES:
- Output ONLY the JSON object. No markdown fences. No preamble. No trailing prose.
- All string fields ≤600 chars unless schema allows more (engagement_objective ≤1200).
- Empty lists are `[]`, not omitted. Missing scalars are `null`.
"""


def _real_extract(text: str) -> MomExtractionResult:
    from app.services import llm

    raw = llm.chat_text(
        system=_SYSTEM_PROMPT,
        user_content=f"MOM TEXT:\n\n{_truncate_for_prompt(text)}",
        # 05-Jun — bumped from 4000 to 8000. The brief section grew (added
        # objectives / minefields / closing_scenarios + call_time / call_
        # platform / categories + cheat_sheet_win_condition_short on the
        # MoM prompt) and Claude was hitting the cap on rich SDR templates
        # → truncated JSON → parse fail → silent fallback to regex stub.
        max_tokens=8000,
    )
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
    leads = _extract_engagement_leads(text)
    engagement = ExtractedEngagement(
        meeting_type=_first_nonempty(s.get("meeting type")),
        engagement_objective=_compose_objective(s),
        target_categories=intent[:4],
        geographies=geos,
        spoc_text=spoc_text,
        sponsor_text=_strip_url_markup(sponsor_line) if sponsor_line else None,
        procurement_maturity=_infer_maturity(s.get("legacy beroe live stats")),
        pre_discovery_date=leads.get("pre_discovery_date"),
        discovery_lead=leads.get("discovery_lead"),
        sales_lead=leads.get("sales_lead"),
        sdr_lead=leads.get("sdr_lead"),
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
    # 05-Jun — also try the full doc for the date when the "Meeting Date:"
    # heading isn't present (SDR templates use it; freeform MoMs say "Date:").
    if not call_date:
        call_date = _parse_discovery_date(text)
    win = _compose_win_condition(s)
    brief = ExtractedBrief(
        call_date=call_date,
        call_type=_infer_call_type(s.get("meeting type")),
        call_duration_minutes=call_duration or _parse_duration(text),
        call_time=_parse_call_time(text),
        call_platform=_parse_call_platform(text),
        categories=intent[:6] if intent else _extract_categories_from_text(text),
        win_condition=win,
        cheat_sheet_win_condition_short=_short_win(win),
        company_snapshot=_build_snapshot(s),
        attendees=_build_attendees(s),
        objectives=_build_objectives(text),
        minefields=_build_minefields(text),
        closing_scenarios=_build_closing_scenarios(text),
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


_DATE_PATTERNS = (
    # ISO YYYY-MM-DD or YYYY/MM/DD
    re.compile(r"\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b"),
    # DD/MM/YYYY or DD-MM-YYYY (European default — what stakeholders are using)
    re.compile(r"\b(\d{1,2})[-/](\d{1,2})[-/](20\d{2})\b"),
    # "Date: October 15, 2024" / "15 Oct 2024" / "Oct 15 2024"
    re.compile(
        r"\b(\d{1,2})\s+"
        r"(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*"
        r"\s+(20\d{2})\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*"
        r"\s+(\d{1,2}),?\s+(20\d{2})\b",
        re.IGNORECASE,
    ),
)
_MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}


def _parse_discovery_date(text: str) -> "date | None":
    """Find the first parseable meeting date in the MoM. Skips future dates
    (discovery is always a past event) — same guard as the engagement schema."""
    from datetime import date as _date

    today = _date.today()
    # Hunt only the first ~3000 chars — meeting metadata is always at the top.
    head = text[:3000]
    for pat in _DATE_PATTERNS:
        for m in pat.finditer(head):
            try:
                groups = [g for g in m.groups()]
                if len(groups[0]) == 4:  # ISO
                    y, mo, d = int(groups[0]), int(groups[1]), int(groups[2])
                elif groups[0].isdigit() and groups[1].isdigit() and len(groups[2]) == 4:
                    # DD/MM/YYYY — default to European parse (stakeholders use this)
                    d, mo, y = int(groups[0]), int(groups[1]), int(groups[2])
                elif groups[0].isdigit():  # "15 Oct 2024"
                    d, mo, y = int(groups[0]), _MONTHS[groups[1].lower()[:3]], int(groups[2])
                else:  # "Oct 15, 2024"
                    mo, d, y = _MONTHS[groups[0].lower()[:3]], int(groups[1]), int(groups[2])
                parsed = _date(y, mo, d)
            except (ValueError, KeyError):
                continue
            if parsed > today:
                continue
            return parsed
    return None


_BEROE_ROLE_LINE_RE = re.compile(
    r"^\s*[-•*]?\s*"
    r"([A-Z][\w.''-]+(?:\s+[A-Z][\w.''-]+){0,3})"  # 1-4 capitalised words
    r"\s*[,:\-—–]\s*"
    r"(?P<role>[\w/ ]+?)"
    r"\s*[,:\-—–]\s*"
    r"(?:Beroe|@beroe|beroe\.com)",
    re.IGNORECASE | re.MULTILINE,
)
_RECORDED_BY_RE = re.compile(
    r"\b(?:Recorded\s+by|Meeting\s+notes\s+by|Notes\s+by|Minuted\s+by|"
    r"Author(?:ed)?\s+by|Compiled\s+by|Submitted\s+by)"
    r"\s*[:\-]\s*"
    r"([A-Z][\w.''-]+(?:\s+[A-Z][\w.''-]+){0,3})",
    re.IGNORECASE,
)


def _classify_beroe_role(role: str) -> str | None:
    """Map a role label found next to a Beroe attendee line to one of
    {sdr, discovery, sales} so it lands on the right engagement field.

    The role landscape at Beroe is broader than just SDR/Sales — CSMs run
    discovery, Commercial Owners run the deal, Solutioning leads scope it,
    etc. We collapse them into the three engagement slots the UI surfaces."""
    r = role.lower().strip()
    if not r:
        return None
    # SDR-ish — they sourced the lead.
    if any(t in r for t in ("sdr", "bdr", "lead gen", "lead source")):
        return "sdr"
    # CSMs and presales discovery leads — they typically also chair the
    # discovery call, so they map to BOTH discovery_lead and sdr_lead.
    if any(t in r for t in (
        "csm", "customer success", "discovery", "presales",
        "pre-sales", "solutioning", "solutions",
    )):
        return "discovery"
    # Sales-side — Commercial Owner / Account Exec / AE / CE / Sales.
    if any(t in r for t in (
        "sales", "account exec", "commercial owner",
        "commercial lead", "account manager",
    )) or r in {"ae", "ce", "co"}:
        return "sales"
    return None


def _extract_engagement_leads(text: str) -> dict:
    """Find Beroe-side leads + the discovery date from any MoM format.

    Matches every flavour of attendee/contributor line we've seen — both
    inline ("- Anurag Bhagat, CSM, Beroe") and recorded-by lines
    ("MEETING NOTES BY: Anurag Bhagat, CSM, Beroe"). Role classification
    is in _classify_beroe_role above so the keyword list is one place."""
    out: dict = {}
    out["pre_discovery_date"] = _parse_discovery_date(text)

    seen_by_role: dict[str, str] = {}
    for m in _BEROE_ROLE_LINE_RE.finditer(text):
        name = m.group(1).strip()
        slot = _classify_beroe_role(m.group("role"))
        if slot:
            seen_by_role.setdefault(slot, name)

    rec = _RECORDED_BY_RE.search(text)
    if rec:
        rec_name = rec.group(1).strip()
        # The "Recorded by:" line often carries a role suffix — pull that
        # too if present so "Recorded by: Anurag, CSM, Beroe" classifies
        # correctly instead of defaulting to SDR.
        tail = text[rec.end() : rec.end() + 80]
        tail_role_m = re.match(r"\s*,\s*([\w/ ]+?)\s*(?:,|\n|$)", tail)
        slot = (
            _classify_beroe_role(tail_role_m.group(1))
            if tail_role_m else None
        ) or "discovery"
        seen_by_role.setdefault(slot, rec_name)
        # The recorded-by person almost always also sourced the call.
        seen_by_role.setdefault("sdr", rec_name)

    # Mirror SDR ↔ discovery when only one is present (the SDR usually
    # runs discovery, and a CSM-led discovery doc usually has no SDR row).
    if "sdr" in seen_by_role and "discovery" not in seen_by_role:
        seen_by_role["discovery"] = seen_by_role["sdr"]
    if "discovery" in seen_by_role and "sdr" not in seen_by_role:
        seen_by_role["sdr"] = seen_by_role["discovery"]

    if "sdr" in seen_by_role:
        out["sdr_lead"] = seen_by_role["sdr"]
    if "discovery" in seen_by_role:
        out["discovery_lead"] = seen_by_role["discovery"]
    if "sales" in seen_by_role:
        out["sales_lead"] = seen_by_role["sales"]
    return out


def _compose_win_condition(s: dict[str, str]) -> str | None:
    mt = _first_nonempty(s.get("meeting type"))
    trigger = _first_nonempty(s.get("trigger intel"))
    if mt and trigger and trigger.upper() != "NA":
        return f"A successful {mt} call moves the {trigger.lower()} conversation forward to a follow-up commitment."
    if mt:
        return f"A successful {mt} call surfaces 2-3 concrete category priorities and a follow-up date."
    return None


# ---------- Brief field stub helpers (05-Jun) ----------


def _short_win(win: str | None) -> str | None:
    """Compress a 1-2 sentence win condition to a 6-10 word cheat-sheet line."""
    if not win:
        return None
    # Take the first clause + trim to ~80 chars; safe fallback when AI isn't on.
    first = re.split(r"[.!?]", win, maxsplit=1)[0].strip()
    if len(first) > 80:
        return first[:77].rstrip() + "…"
    return first


_TIME_RE = re.compile(
    r"\bTime\s*[:\-]\s*([^\n]{2,80})",
    re.IGNORECASE,
)
_TIME_INLINE_RE = re.compile(
    r"\b("
    r"(?:[01]?\d|2[0-3])[:.]\d{2}\s*(?:am|pm|AM|PM)?"
    r"\s*(?:[A-Z]{2,4})?"
    r"|"
    r"(?:[01]?\d|2[0-3])\s*(?:am|pm|AM|PM)\s*(?:[A-Z]{2,4})?"
    r")\b",
)


def _parse_call_time(text: str) -> str | None:
    head = text[:2000]
    m = _TIME_RE.search(head)
    if m:
        return m.group(1).strip()[:120]
    m = _TIME_INLINE_RE.search(head)
    if m:
        return m.group(1).strip()[:120]
    return None


_PLATFORM_RE = re.compile(
    r"\b(?:Location|Platform|Meeting)\s*[:\-]\s*([^\n]+)",
    re.IGNORECASE,
)
_PLATFORM_TOKENS = (
    ("microsoft teams", "Microsoft Teams"),
    ("ms teams", "Microsoft Teams"),
    (" teams", "Microsoft Teams"),
    ("google meet", "Google Meet"),
    ("gmeet", "Google Meet"),
    ("zoom", "Zoom"),
    ("webex", "Webex"),
    ("on-site", "On-site"),
    ("onsite", "On-site"),
    ("phone call", "Phone"),
)


def _parse_call_platform(text: str) -> str | None:
    head = text[:2000].lower()
    # Explicit Location:/Platform: header takes priority.
    m = _PLATFORM_RE.search(text[:2000])
    if m:
        line = m.group(1).strip()
        # Look for known tokens inside the value, else return verbatim.
        ll = line.lower()
        for token, canonical in _PLATFORM_TOKENS:
            if token in ll:
                return canonical
        return line[:120]
    for token, canonical in _PLATFORM_TOKENS:
        if token in head:
            return canonical
    return None


_DURATION_RE = re.compile(
    r"\bDuration\s*[:\-]\s*(\d{1,3})\s*(?:minutes?|mins?|m\b|hours?|hrs?|h\b)",
    re.IGNORECASE,
)
_DURATION_INLINE_RE = re.compile(
    r"\((\d{1,3})\s*(?:minutes?|mins?)\)",
    re.IGNORECASE,
)


def _parse_duration(text: str) -> int | None:
    head = text[:2000]
    for pat in (_DURATION_RE, _DURATION_INLINE_RE):
        m = pat.search(head)
        if m:
            try:
                n = int(m.group(1))
            except ValueError:
                continue
            if 5 <= n <= 480:
                return n
    return None


_CATEGORY_SECTION_RE = re.compile(
    r"(?:CATEGORIES\s+OF\s+INTEREST|Primary\s+Categories|Direct\s+Materials|"
    r"Focus\s+Categories|Top\s+Categories|Categories?\s*[:\-])\s*([^\n]+(?:\n[ \t]*[-•*][^\n]+)*)",
    re.IGNORECASE,
)


def _extract_categories_from_text(text: str) -> list[str]:
    m = _CATEGORY_SECTION_RE.search(text)
    if not m:
        return []
    body = m.group(1)
    out: list[str] = []
    for raw in body.splitlines():
        line = raw.strip(" \t-•*")
        if not line:
            continue
        # Drop currency / spend annotations like "(EUR 8M annual spend)".
        line = re.sub(r"\(.+?\)", "", line).strip()
        # Skip block headers like "Primary :" / "Secondary —" / "Direct
        # Materials — 72% of focus" that have no real category name.
        if line.endswith(":") or line.endswith("—"):
            continue
        if not re.search(r"[A-Za-z]{3,}", line):
            continue
        # Trim trailing punctuation / em-dashes.
        line = re.sub(r"[\s\-—:]+$", "", line)
        if line and len(out) < 8:
            out.append(line[:80])
    # Dedup, preserve order
    seen: set[str] = set()
    unique = []
    for c in out:
        k = c.lower()
        if k in seen:
            continue
        seen.add(k)
        unique.append(c)
    return unique


_AGENDA_RE = re.compile(
    r"^[ \t]*AGENDA\s*:?\s*$\n(?:[-=_]+\n)?((?:[ \t]*\d+\.[ \t]+[^\n]+\n?){1,8})",
    re.IGNORECASE | re.MULTILINE,
)


def _build_objectives(text: str) -> list[dict]:
    """Pull a 1-5 objective list from an AGENDA block. Falls back to empty."""
    m = _AGENDA_RE.search(text)
    if not m:
        return []
    out: list[dict] = []
    for line in m.group(1).splitlines():
        ln = line.strip()
        if not ln:
            continue
        # Strip the "1.", "2." prefix
        ln = re.sub(r"^\d+\.\s*", "", ln)
        if not ln or len(ln) < 4:
            continue
        out.append({
            "rank": len(out) + 1,
            "name": ln[:200],
            "confidence": 4 if len(out) == 0 else 3,
            "bullets": [],
            "beroe": None,
            "sources": [],
        })
        if len(out) >= 5:
            break
    return out


_RISK_SECTION_RE = re.compile(
    r"^[ \t]*(?:RISK\s+FLAGS?|Watch-?outs?|Risks?(?:\s+&\s+\w+)?)\s*:?\s*$\n"
    r"(?:[-=_]+\n)?((?:[ \t]*[-•*][^\n]+\n?){1,12})",
    re.IGNORECASE | re.MULTILINE,
)
_RISK_TYPE_KEYWORDS = [
    (re.compile(r"\b(budget|spend|cost|pricing|ROI)\b", re.I), "BUDGET"),
    (re.compile(r"\b(renewal|expire|deadline|window|timing|Q[1-4])\b", re.I), "TIMING"),
    (re.compile(r"\b(CPO|VP|exec|sponsor|stakeholder|engaged)\b", re.I), "STAKEHOLDER"),
    (re.compile(r"\b(competitor|displace|incumbent|vs\.?\s)\b", re.I), "COMPETE"),
    (re.compile(r"\b(SSO|IT|integration|InfoSec|security|sign-?off)\b", re.I), "TECH"),
    (re.compile(r"\b(legal|contract|terms|MSA|GDPR|compliance)\b", re.I), "LEGAL"),
]


def _classify_risk(line: str) -> str | None:
    for pat, label in _RISK_TYPE_KEYWORDS:
        if pat.search(line):
            return label
    return None


def _build_minefields(text: str) -> list[dict]:
    m = _RISK_SECTION_RE.search(text)
    if not m:
        return []
    out: list[dict] = []
    for raw in m.group(1).splitlines():
        line = raw.strip(" \t-•*")
        if not line or len(line) < 6:
            continue
        # Severity: "high" when the line carries blocker language; else "caution".
        is_high = bool(re.search(
            r"\b(critical|blocker|deal-?breaker|must|hard stop|lost|missed|"
            r"won't|cannot|denied)\b", line, re.I,
        ))
        out.append({
            "severity": "high" if is_high else "caution",
            "type": _classify_risk(line),
            "text": line[:400],
            "why": None,
        })
        if len(out) >= 8:
            break
    return out


_NEXT_STEPS_RE = re.compile(
    r"^[ \t]*(?:NEXT\s+STEPS?|ACTION\s+ITEMS?|Closing|Outcome)\s*:?\s*$\n"
    r"(?:[-=_]+\n)?((?:[ \t]*[-•*\[][^\n]+\n?){1,12})",
    re.IGNORECASE | re.MULTILINE,
)


def _build_closing_scenarios(text: str) -> list[dict]:
    m = _NEXT_STEPS_RE.search(text)
    if not m:
        return []
    bullets: list[str] = []
    for raw in m.group(1).splitlines():
        line = raw.strip(" \t-•*[]")
        if line and len(line) > 4:
            bullets.append(line)
    if not bullets:
        return []
    summary = " · ".join(bullets[:4])
    return [{
        "type": "good",
        "label": "Forward path",
        "text": summary[:1200],
    }]


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
