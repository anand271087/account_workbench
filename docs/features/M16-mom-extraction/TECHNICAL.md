# M16 — MoM Field Extraction — Technical

> **Flow update (2026-05-12):** The "Extract fields" button is gone. The
> Celery worker auto-runs `extract_from_mom()` right after AI summarisation
> for `kind='mom'` and persists the result on `documents.mom_extracted_fields`.
> The frontend's existing 1.5s polling loop sees the column flip, one-shot
> applies the result as a dirty draft on Pre-Sales + Brief, and creates
> contacts immediately. A per-doc localStorage flag (`awb:extraction-applied:<doc_id>`)
> survives reloads so contacts never re-create. See "Auto-apply pipeline"
> below.

## Files touched

### New files

| File | Purpose |
|---|---|
| `apps/api/app/schemas/mom_extraction.py` | `ExtractedAccountFields` / `ExtractedEngagement` / `ExtractedContact` / `ExtractedBrief` / `MomExtractionResult`. Nested shapes reuse `Attendee`, `SnapshotStat`, `NewsItem`, `PublicSignal`, `ValueAnchor`, `EmailInsight` from `meeting_brief.py` so the payload maps 1:1 onto brief PATCH targets |
| `apps/api/app/services/extract_mom.py` | `extract_from_mom(document_id, text) -> MomExtractionResult`. Single public surface that picks real-Claude or stub based on `_key_looks_real`. 24h TTL cache + one retry + graceful stub fallback |
| `apps/web/src/types/mom_extraction.ts` | TS mirror of the Pydantic shapes |
| `apps/web/src/components/MomExtractionReview.tsx` | The review modal — extraction call, four section cards, per-section status pills, parallel-fan-out apply |
| `docs/features/M16-mom-extraction/FUNCTIONAL.md` + `TECHNICAL.md` | This doc set |

### Modified files

| File | What changed |
|---|---|
| `apps/api/app/services/extract.py` | New `_extract_eml()` (stdlib `email` parser; prefers `text/plain`, falls back to HTML strip; prepends From/To/Cc/Subject/Date header block). `.doc` raises a friendly "Save As .docx" `ExtractError` |
| `apps/api/app/core/config.py` | `allowed_doc_extensions` extended to `.docx,.doc,.pdf,.txt,.vtt,.eml` |
| `apps/api/app/routes/documents.py` | New `POST /api/v1/documents/:id/extract-fields` endpoint + updated 415 message |
| `apps/web/src/components/KindUploadCard.tsx` | `ALLOWED_EXT` extended; new `extractDoc` state + violet "Extract fields" button on `kind=mom` rows; renders `<MomExtractionReview>` when set |

## Endpoint

| Method | Path | Body | Returns | Permission |
|---|---|---|---|---|
| POST | `/api/v1/documents/:id/extract-fields` | — | `MomExtractionResult` | `can_view_account` (view-gated) |

Read-only — never writes. The fan-out apply happens through the existing PATCH `/engagement`, PATCH `/brief`, POST `/contacts` endpoints, each of which keeps its own RBAC.

Billed against the user's daily Claude quota (`ai_quota.consume(user.id, label="mom_extract")`) so the same daily-200 cap covers extraction along with quality-check and document-summarise.

## `MomExtractionResult` shape

```python
class MomExtractionResult(BaseModel):
    document_id: UUID
    is_stub: bool                      # true when Anthropic key isn't configured
    notes: str | None                  # AI's own "what was missing / low-confidence" remarks
    account_fields: ExtractedAccountFields
    engagement: ExtractedEngagement
    contacts: list[ExtractedContact]
    brief: ExtractedBrief
```

All four nested shapes use `model_config = ConfigDict(extra="allow")` so future prompt revisions can add fields without a schema bump. Nested `ExtractedBrief` reuses the existing `Attendee`, `SnapshotStat`, `NewsItem`, etc. from `meeting_brief.py` — that's deliberate: it means `MeetingBriefUpdate(**extracted_brief.model_dump())` Just Works.

## Claude prompt strategy

A single `system` prompt that:
- Tells the model the exact 23-section template SDRs use (Account Name / Meeting Date / Contacts / Meeting Type / Company Profile / Trigger Intel / etc.) so it knows where to anchor
- Specifies the JSON schema field-by-field with type literals (`<"low"|"medium"|"high"|null>`)
- Gives explicit derivation rules:
  - **SPOC** = the named meeting attendee (`is_spoc=true` ONLY for that one row)
  - **Sponsor** = most senior procurement contact (CPO/VP/SVP)
  - **MI Team entries** → `is_internal_beroe=true` (those are Beroe staff, NOT to be created as client contacts)
  - **Maturity** = high if CEB+many users, medium if some registered, low if "Not a CEB" + zero registrations
  - **`call_type`** = "first_discovery" for Regular/Trigger/Lost Client, "renewal" for Renewal, "qbr" for QBR
  - **`days_ago`** for news items = computed from today's date only if the date is explicit in text; otherwise null
- Caps string lengths inline (`engagement_objective ≤1200 chars`, etc.)
- "OUTPUT ONLY the JSON object. No markdown fences. No preamble."

Real Anthropic output on the Ciena/Caldic .eml samples produces well-formed JSON on first try; the JSON-coercer in `_coerce_to_result` is defensive (drops malformed rows rather than 500-ing) but rarely triggered.

`max_tokens = 4000` — enough headroom for the contacts array on a richer MoM without truncation.

## Stub extractor

`_stub_extract(text)` is more than a placeholder — for SDR-template MoMs it produces genuinely useful output. Strategy:

1. `_parse_sections(text)` — walks lines, treats any `<header>:` matching the known 23-header bag (case-insensitive) as a section anchor, collects body until next anchor
2. Per-section deterministic parsing:
   - **`_parse_contact_line`** — regex extracts `(name, title, linkedin_url)` from the `Name<https://linkedin.com/...> - Title` Outlook-markup pattern SDRs always use
   - **`_classify_seniority` / `_classify_function` / `_classify_decision_power`** — keyword heuristics (CPO/VP/Director/Manager regex bag)
   - **`_parse_meeting_date`** — regex against two patterns ("26th March, Thursday at 12:30 PM IST" and "Wednesday, 25th March at 8 PM IST"), defaults year to `utcnow().year` when omitted
   - **`_infer_maturity`** — string-match on the Legacy LiVE Stats block
   - **`_build_news`** — regex-extracts `(month, day, year, rest)` from Additional Info lines; computes `days_ago` from today
   - **`_build_value_anchors`** — splits "Beroe Clients in Similar Industry" + "Clients in the same country" into two anchor objects with point arrays
   - **`_find_most_senior`** — walks Top Procurement Contacts, picks the highest-seniority line as sponsor

Triggered for: no real Anthropic key configured OR real call failed twice. `is_stub=True` so the UI shows the **Stub AI** chip.

## Email (.eml) extraction

Uses Python stdlib `email.policy.default` parser:

```python
msg = message_from_bytes(data, policy=default_policy)
# Walk parts, prefer text/plain. Fall back to HTML strip if no plain part.
# Skip Content-Disposition: attachment.
# Prepend "=== HEADERS ===\nFrom/To/Cc/Subject/Date" block so AI sees participants.
```

HTML fallback drops `<style>` and `<script>` blocks, converts `<br>` and `</p>` to newlines, strips remaining tags, unescapes common entities. Naive but works on every Outlook-generated MoM tested (the prototype SDR template renders predictably).

Tested live against the three samples in `~/Downloads/Beroe/`:
- Ciena MOM .eml → 4066 chars (headers + body clean)
- Caldic MoM .eml → 3231 chars
- FTI Consulting MoM .eml → 3802 chars

## Fan-out apply (frontend)

```ts
// In MomExtractionReview.tsx
const tasks: Promise<unknown>[] = [];
if (applyEngagement) tasks.push(applyEngagementPatch(accountId, result.engagement)...)
if (applyBrief)      tasks.push(applyBriefPatch(accountId, result.brief)...)
if (selectedContactCount > 0) tasks.push(applyContactsCreate(accountId, contacts, selected)...)
await Promise.allSettled(tasks);
qc.invalidateQueries({ queryKey: ["engagement", accountId] });  // etc.
```

Each helper:
- Only includes payload keys whose values are present (no overwriting existing fields with nulls)
- Sets per-section `SectionResult` state with status + message; the UI surfaces these as inline pills as each finishes
- For contacts: per-contact 409 (unique-email collision) counted as **skipped**, not **failed**

`Promise.allSettled` (not `.all`) is deliberate — one section failing shouldn't roll back the others. Each section reports independently.

## Caching

Real-Claude calls cached in an in-memory dict keyed by `sha256(model + text)`, 24h TTL, miss-on-error (so a stub fallback doesn't pollute the cache). Single-process today; swap to Redis INCR if/when we horizontally scale extraction.

Note: cache key is the **document text**, not the document ID — re-uploading the same MoM under a different doc ID hits the cache. Saves an Anthropic call but always returns the freshly-stamped `document_id` (the result is `.model_copy(update={"document_id": ...})` before return).

## Tests

No new pytest cases — the public surface is one route that:
1. Calls a function that's safe-to-mock (`extract_from_mom`)
2. Is gated by an already-tested predicate (`can_view_account`)

Real-extraction validation done via the standalone script run against `~/Downloads/Beroe/*.eml` (results recorded in CLAUDE.md decisions log).

Affected test suites (17/17 documents, 70/70 contacts, brief, engagement — minus the 3 pre-existing engagement-Beroe-email-validation failures unrelated to this milestone) still green.

## Auto-apply pipeline (2026-05-12 refactor)

**Worker side** — `app/workers/tasks.py:process_document`:
1. After AI summarisation completes, check `doc.kind == "mom"`.
2. Call `extract_from_mom(doc.id, text)` (same service as before).
3. `doc.mom_extracted_fields = result.model_dump(mode="json")`, `doc.mom_extracted_at = now()`. Commit. Exception is logged and swallowed — extraction failure must not fail the parent summarisation job.

**Schema** — migration `0026_documents_mom_extracted.sql`:
- `documents.mom_extracted_fields jsonb` (object-typed via CHECK constraint)
- `documents.mom_extracted_at timestamptz`

Exposed via `DocumentOut` so the existing `GET /api/v1/accounts/:id/documents?kind=mom` returns them on every poll.

**Frontend side** — `KindUploadCard.tsx`:
- A new `useEffect` watches `data.items`. For any MOM doc with `mom_extracted_fields` set AND no `awb:extraction-applied:<doc_id>` flag in localStorage:
  1. Mark `sessionStorage` synchronously to prevent re-entry while the async work runs
  2. `saveExtractionDraft(accountId, {filename, engagement, brief})` — engagement + brief flow into the existing draft system from the prior phase
  3. `createExtractedContacts(accountId, contacts)` — POST each contact in parallel (409s = duplicate email skipped)
  4. Persist `localStorage.setItem(awb:extraction-applied:<doc_id>, now)` so reloads don't re-create contacts
  5. Surface a green toast under the upload card: `Populated engagement, brief, N contacts from "<file>". Review on Pre-Sales and Brief and click Save.`

The Pre-Sales engagement form + Brief editor consume the draft (existing `consumeEngagementSlice` / `consumeBriefSlice`) on mount and on the `awb:extraction-applied` event. Forms open dirty; sticky save bar pulses; existing unsaved-changes guard blocks navigation.

**Row-level UI cue**: each MOM row that has `mom_extracted_at` set shows a small violet `Fields populated` chip with a tooltip showing the timestamp.

## Manual extraction endpoint

`POST /api/v1/documents/:id/extract-fields` is **retained** but no longer wired to a button. Use cases:
- API consumers that want the structured payload without persisting it
- Future "preview extraction" UX
- 24h cache means a re-call after the worker already extracted is free

## Known gaps / follow-up

- **Account header PATCH endpoint** — currently the modal surfaces industry / country / revenue / tier but can't apply them. Lands as M16.1
- **Auto-run during Celery processing** — would save the 5-15s modal wait but doubles Anthropic spend; gated on actual usage data
- **Per-field inline edit in the modal** — today it's toggle-only (apply-as-AI-proposed or skip-and-edit-after); add textareas for the high-friction fields (engagement_objective, win_condition)
- **Bulk extract** — process all complete MoMs on an account in one shot
- **Better array merge** — replacing `target_categories` and `geographies` wholesale rather than merging is the simplest semantic but loses information when a CSM has hand-tuned them; add a "merge vs replace" toggle later

## Costs

Per extraction: one Claude Sonnet 4.5 call with `max_tokens=4000`. Roughly 3–4k input tokens (the MoM text capped at 24k chars) + ~2k output tokens. At Sonnet pricing that's pennies per extraction. The 24h cache makes accidental re-runs free.
