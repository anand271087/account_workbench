# M13 — Sales Hand-off & Signing

## What it does

Adds the **Sales Hand-off** tab — the explicit handshake between Solutioning and Sales, plus the **CLIENT SIGNED stage gate** that flips the account from "pre-sales" to "live." Once the gate fires, downstream tabs (CS Onboarding, Goals) unlock and renewal + VDD due dates are derived from the contract term.

Mirrors the prototype's Sales Handoff & Signing sub-tab inside the Account Kit. We ship it as a top-level tab in the AK02 nav instead of a sub-tab, per the additive strategy chosen for Phases 3–5.

## Five concrete deliverables

### 1. Sales Hand-off card (post-Solutioning, pre-signing)

- **Value definition snapshot** — when Solutioning locks the value definition, we copy it (plus the value themes) into `sh_value_from_solutioning` / `sh_value_themes_from_solutioning` with a timestamp. Read-only on the Hand-off card; Sales validates it rather than rewrites it.
- **Sales validation** — three-choice picker (Confirmed / Partially confirmed / Revised) plus a free-text `sh_validation_notes` field.
- **Engagement timeline** — `sh_go_live_date`, `sh_first_checkpoint` (dates).
- **Context fields** — `sh_stakeholder_signoff`, `sh_commercial_context`, `sales_watchouts`, `handoff_file_name`.
- **Sticky save bar** — same dirty-pulse + Cmd/Ctrl-S behaviour as Pre-Sales / Solutioning.

### 2. CLIENT SIGNED stage gate

Full-width visual that switches states cleanly:

- **Pending** — gate inactive. Sales sees the Confirm Signing form: date, ACV ($), term (1 year / 2 years / 3 years / Custom). Submit fires `POST /accounts/:id/sign`.
- **Signed (live)** — 6-cell metadata grid: signed date, contract ACV, term, **renewal date**, **VDD due date**, confirmed-at timestamp. Renewal + VDD derived in the API (`renewal = signed_date + term_years`; `VDD due = signed_date + 183 days`, pulled in to 30 days before renewal if it would overshoot). Module chips + tier / segment / subscribers shown if populated.
- **Unlocked** — admin-only "🔓 Unlock for correction" button on the signed state. Requires a reason (min 10 chars) captured to `gate_unlock_reason` / `gate_unlocked_by` / `gate_unlocked_at`. Card flips amber. Re-confirming via `/sign` clears the unlocked flag.

### 3. Contract document attachment

After signing, a slim filename input appears at the bottom of the signed card. Stores the filename only (`gate_contract_doc`) — actual file bytes go through the existing Documents pipeline. Filename displayed as a green pill with upload date once recorded.

### 4. Handover Quality Check (Sales side)

Four hard-gate items every Pre-Sales hand-off must include:
- Savings target captured
- Stakeholder roster (3 roles)
- Categories agreed in writing
- Success metric defined

Stored as `handover_quality_check` jsonb on the account. PATCH merges in partial updates so two users editing different items don't race. Items checked here represent the Sales-side acknowledgement; the matching CSM-side checklist lives in M14 (CS Onboarding).

### 5. Solutioning auto-snapshot on lock

The existing `POST /solutioning/lock` endpoint now writes `sh_value_from_solutioning`, `sh_value_themes_from_solutioning`, and `sh_value_received_at` on first lock. Re-locking after an unlock preserves the prior snapshot — Sales's edits to `sh_*` are never clobbered.

## Permission matrix

| Role | View | Edit `sh_*` | Sign | Unlock |
|---|---|---|---|---|
| Admin / CS Director / VP CSM | ✓ | ✓ | ✓ | ✓ |
| VP Sales / VP Inside Sales | ✓ | ✓ | ✓ | — |
| Commercial Owner (assigned) | ✓ | ✓ | ✓ | — |
| Inside Sales Manager (assigned) | ✓ | ✓ | ✓ | — |
| Solutioning Manager | ✓ | ✓ | — | — |
| CSM (assigned) | ✓ | ✓ | — | — |
| CSM (unassigned) | ✓ | — | — | — |

Two-tier write: anyone with engagement-write OR solutioning-write can fill in the `sh_*` context (it's collaborative). Only Sales / CO can capture the signing event. Only admins can unlock.

## What it doesn't do

- No PDF generation of the signed contract — we store the filename pointer, not the file.
- No e-signature workflow — signing is a manual milestone Sales records after the contract is signed elsewhere.
- No multi-currency — ACV is stored as decimal; UI assumes USD. Currency support is a separate concern.
- No renewal reminders / cron — the gate dates are passive metadata. Alerting is M16+.

## Open questions

- Should `vp_sales` be able to unlock without admin? Currently only `admin`/`cs_director`/`vp_csm`. Matches the matrix's audit-trail philosophy: every unlock should land under a Director-grade user. Revisit if Sales pushes back.
