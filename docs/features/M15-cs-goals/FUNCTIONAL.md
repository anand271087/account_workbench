# M15 — CS Goal Validation & Alignment

## What it does

Promotes the existing `/goals` placeholder tab to a real **Goals** tab — the CS team's structured workspace for turning a high-level outcome ("Cut copper spend by 8%") into a validated, measurable, initiative-backed commitment. Implements the prototype's three-phase alignment wizard verbatim: **Phase A — What does this goal actually mean?**, **Phase B — What groundwork exists?**, **Phase C — Agree the target.**

Each goal carries category-aware fields, a list of initiatives with category-specific stage progressions, and a business-level history feed independent of the row-level `audit_log`.

## Five concrete deliverables

### 1. Goal list view

- One row per goal — alignment-status dot (grey / amber / green for not_started / partial / aligned), title, category badge, target value, target date, owner.
- "+ Add goal" opens a small modal (title + category required; everything else fills in via PATCH).
- Show-deleted toggle reveals soft-deleted goals dimmed; admins get a one-click "Restore."
- Empty-state copy nudges the CSM to "Click 'Add goal' to start."

### 2. Per-goal expand — header + 3-phase wizard

Click a row to expand inline:

- **Header card** — title / category / target_value / target_date / owner. Alignment status field is read-only (derived).
- **Phase A — discovery** (collapsible card, default open):
  - `goal_type` — category-aware dropdown (cost_savings → cost_savings / cost_avoidance / spend_reduction / cost_efficiency; base_rationalization → confirmed / partial / no; etc.)
  - `category_clarity` (confirmed / partial / not_discussed)
  - `target_origin` (analysis_backed / finance_set / joint_estimate / unknown)
  - `validation_note` (free-text — what success looks like in client's words)
  - "mark complete" checkbox in the summary header
- **Phase B — groundwork** (same shape):
  - Three identical dropdowns (Spend Analytics / Opportunity Assessment / Benchmarking) with status options (done_current / done_outdated / not_done / unknown)
  - `research_requested` checkbox; when ticked, exposes `research_request_date`
- **Phase C — agreed target**:
  - `category_focus` / `baseline` / `agreed_target` / `measure_method` (all textareas)
  - `timeline` (date)

### 3. Auto-derived alignment

When PATCH includes phase changes, alignment status re-derives from the three `*_complete` flags:
- none → `not_started`
- one or two → `partial`
- all three → `aligned`

Caller can override by sending `alignment_status` explicitly in the same PATCH (escape hatch for cases like "client signed off out-of-order").

### 4. Initiatives with category-aware stages

Each goal carries a list of initiatives. Per initiative:
- `name`, `sub_initiatives`, `status` (not_started / in_progress / delivered)
- `value_stage` — dropdown values vary by goal category:
  - cost_savings: identified / committed / implemented / deferred / not_pursued
  - base_rationalization: baselined / in_progress / achieved
  - risk_mitigation: risk_baseline / alert_generated / disruption_avoided
  - adoption: pilot / active / embedded
- `value_target` / `value_delivered` (free-text — currency-agnostic)
- `client_acknowledged` (pending / yes / not_yet)
- `evidence` (textarea — link / quote / supporting doc reference)
- `value_fields` / `client_data` / `value_history` — open shapes for category-specific extras (e.g. `identified_value`, `committed_value` for cost_savings)

### 5. History feed + soft delete with reason

- Every PATCH appends a business-level entry to `history` jsonb: `created`, `updated`, `phase_a_completed`, `phase_b_completed`, `phase_c_completed`, `soft_deleted`, `restored`. Each entry: `{at, by, action, new_value?, reason?}`.
- Soft delete prompts the CSM for a reason (min 5 chars). Row stays in the table with `deleted_at`, `deleted_reason`, `deleted_by` populated. CHECK constraint enforces "if deleted, then reason set."
- **Restore is admin-only** (`is_global_admin`) so reversing a deletion lands under a director-grade user in the audit trail.
- PATCH on a soft-deleted goal returns **409** (defense in depth — UI hides the controls but a stale tab mustn't slip through).

## Permission matrix

| Role | List | Create | Update | Soft delete | Restore |
|---|---|---|---|---|---|
| Admin / CS Director / VP CSM | ✓ | ✓ | ✓ | ✓ | ✓ |
| CSM (assigned) | ✓ | ✓ | ✓ | ✓ | — |
| CS Team Manager (team) | ✓ | ✓ | ✓ | ✓ | — |
| Inside Sales Manager (assigned) | ✓ | ✓ | ✓ | ✓ | — |
| Solutioning Manager | ✓ | — | — | — | — |
| VPs | ✓ | — | — | — | — |
| CSM (unassigned) | ✓ | — | — | — | — |

Same write set as CS Onboarding (`can_write_cs_onboarding`); only `is_global_admin` can restore.

## What it doesn't do (deferred)

- **No AI VDD extraction.** The prototype lets a CSM upload a VDD doc and have Claude propose draft goals. Requires Claude wiring + an extraction prompt + a confirmation modal; lands in a follow-up so this phase ships clean.
- **No initiative-level history surfacing.** `value_history` is stored as an open array; the UI doesn't currently render a per-initiative timeline.
- **No bulk import / CSV.** One-at-a-time goal creation through the modal.
- **No goal templates per category.** Every new goal starts blank; the discovery wizard fills in.
- **No cross-account goal queries** — list is scoped to one account at a time. Reporting across portfolios is M16+.

## Open questions

- Should the alignment-dot indicator show on the AK01 account list? Currently goal status only surfaces within the Goals tab. Roll-up to the account-list view is useful for CSM portfolio at-a-glance but lands later.
- Restore admin-only — but in a small org, a CS Director might want to give CS Team Managers the ability too. Easy expansion if asked; kept tight for now.
