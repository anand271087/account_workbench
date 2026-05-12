# M16 — MoM → Multi-screen Field Extraction

## What it does

Takes any uploaded Meeting-of-Minutes (MoM) document — `.eml` from Outlook, `.docx`, `.pdf`, `.txt`, or `.vtt` — and lets the CSM populate **four screens worth of data in one click**:

- **Engagement** (Pre-Sales tab) — objective, target categories, geographies, SPOC, sponsor, procurement maturity
- **Client Contacts** — one row per attendee + "Top Procurement Contacts" mentioned in the MoM, with function/seniority/decision-power pre-classified
- **Pre-Meeting Brief** — call date / call type / duration, win condition, company snapshot stats, attendees, news, value anchors, email-insights, cheat-sheet items
- **Account header** (informational only — no PATCH endpoint yet) — industry, country, annual revenue, tier band, SF link

The CSM never sees raw JSON. They open a **review modal**, see what Claude proposed grouped by destination screen, untick anything that's wrong, and hit **Apply selected**.

## Five concrete deliverables

### 1. Expanded upload formats

Document upload now accepts `.eml` (Outlook mail), `.docx`, `.pdf`, `.txt`, `.vtt`. `.doc` (legacy binary Word) is rejected with a clear "open in Word and Save As .docx" message — no reliable pure-Python `.doc` parser exists, and shelling out to antiword/LibreOffice on Render would balloon the image.

`.eml` extraction parses RFC-5322 headers (From/To/Cc/Subject/Date), walks MIME parts preferring `text/plain` and falling back to a naive HTML strip. Headers are prepended to the body so the AI sees meeting participants alongside the content.

### 2. "Extract fields" button on every MoM row

Once an upload's AI status is **complete**, the row gains a violet **Extract fields** button next to **Rerun**. Visible only for `kind=mom` documents; hidden on VPDs and contracts. Disabled while the document is still processing.

### 3. Review modal with per-section apply

Opens with a "Asking Claude to extract fields…" loader (typically 5–15s). Renders:

- **Account info** card — informational chips (no apply checkbox; CSM copies values into the header manually until an account PATCH endpoint lands)
- **Engagement** card — objective, meeting type, SPOC, sponsor, maturity + category/geo chips. One **Apply** toggle
- **Contacts** card — one row per detected contact with SPOC / Sponsor / Beroe-internal pills. Per-row checkboxes. Beroe-internal contacts (MI team) are auto-disabled and excluded from creation
- **Brief** card — scalar fields + count chips for each populated collection (snapshot stats, attendees, news, value anchors, never-say, opening asks). One **Apply** toggle

A **Stub AI** chip surfaces when the Anthropic key isn't configured — output then comes from a deterministic parser tuned to the SDR template (still useful, ~80% as good for standard MoMs).

### 4. Parallel fan-out apply

Hitting **Apply selected** fires the chosen mutations in parallel:

- `PATCH /accounts/:id/engagement` — only includes keys with values (won't overwrite existing fields with nulls)
- `PATCH /accounts/:id/brief` — same, partial-document semantics
- `POST /accounts/:id/contacts` × N for each ticked row

Per-section status pills (`Applying… / Done / N contacts created · M skipped · K failed`) appear inline as each finishes. Email-uniqueness collisions are counted as **skipped**, not failed.

### 5. Cost-controlled, cache-friendly, RBAC-aware

- Each extraction call is billed against `claude_user_daily_limit` (default 200/UTC day per user)
- Results cached 24h by SHA-256(model + text) — reopening the same MoM doesn't bill twice
- View permission gates extraction (`can_view_account`); the *apply* step uses the destination endpoint's own RBAC (e.g. solutioning_manager has view-only on engagement and would 403 if they ticked Engagement→Apply)
- One automatic retry on transient Anthropic errors, then graceful fallback to the deterministic stub — UI never breaks

## What gets extracted (real Ciena/Caldic samples)

| Field | Caldic (1-3B Regular) | Ciena (3-5B Trigger + Lost Client) |
|---|---|---|
| Industry | Chemicals | Information Technology (Software) |
| HQ | Rotterdam, Netherlands | Hanover, Maryland |
| Revenue | $2.5B | USD 4.77 Billion |
| Tier band | 1-3B | 3-5B |
| SPOC | Rene Dam Andersen (Head of Procurement APAC) | Fazal Choksi (Director of Indirect Procurement) |
| Sponsor | Srikanth Vaduvur (CPO) | Mark Hillesheim (VP, Global Procurement) |
| Maturity | low (Not a CEB, zero registered users) | high (CEB member, 14 logged users, 566 mins on platform) |
| Contacts created | 3 client + 2 Beroe-internal (excluded) | 6 client (Fazal, Mark, Ruben, Chuck, Brian, Aadya) |
| News items | 2 (23d, 35d ago) | 1 |
| Value anchors | Chemicals + Netherlands | IT + United States |

## What it doesn't do (deferred)

- **No account-level PATCH endpoint** — industry / country / revenue / tier shown but not applied. Landing later; for now CSM copies them manually
- **No diff-against-existing** — Apply replaces categories/geographies arrays wholesale rather than merging; partial-merge for arrays is a follow-up
- **No "preview-before-apply"** inline edit — review modal is toggle-only; CSM has to apply then fix in the destination screen if the AI got a field wrong
- **No bulk extraction across multiple MoMs** — one document at a time
- **Audio/video MoMs** — still v1.1 (the extract pipeline rejects them with the existing message)

## Permission matrix

| Role | View MoM | Click Extract | Apply Engagement | Apply Brief | Apply Contacts |
|---|---|---|---|---|---|
| Admin / CS Director / VP CSM | ✓ | ✓ | ✓ | ✓ | ✓ |
| CSM (assigned) | ✓ | ✓ | ✓ | ✓ | ✓ |
| CS Team Manager (team) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Solutioning Manager | ✓ | ✓ | — (403) | ✓ | ✓ |
| VPs / Other CSM | ✓ | ✓ | — | — | — |

The "Extract" gate is just `can_view_account` — anyone who can see the MoM can preview what's extractable. Apply enforcement happens at each destination endpoint.

## Open questions

- Should we **auto-run extraction during Celery doc processing** so the modal opens with results already cached? Saves the 5-15s wait but doubles Anthropic spend per upload. Holding off until usage data tells us extractions are common.
- Account-header PATCH endpoint scope — single field-by-field PATCH, or scoped to just the SDR-template fields the AI populates (industry / country / revenue / tier)?
