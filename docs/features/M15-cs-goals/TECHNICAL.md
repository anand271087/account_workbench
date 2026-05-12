# M15 — CS Goal Validation & Alignment — Technical

## Files touched

### New files

| File | Purpose |
|---|---|
| `supabase/migrations/0024_cs_goals.sql` | New `cs_goals` table (20 columns) + `cs_goal_category` enum + `cs_goal_alignment` enum + 3 CHECK constraints + partial + full indexes on `account_id` |
| `apps/api/app/models/cs_goal.py` | `CSGoal` ORM model + ENUM bindings |
| `apps/api/app/schemas/cs_goal.py` | `PhaseA`/`PhaseB`/`PhaseC` (open-extra), `Initiative`, `HistoryAction`, `CSGoalOut`/`Create`/`Update`/`Delete`/`ListOut` |
| `apps/api/app/routes/cs_goals.py` | Two routers (account-scoped + goal-scoped) — list / create / get / patch / soft-delete / restore. Includes `_derive_alignment` helper and `_push_history` event appender. |
| `apps/web/src/types/cs_goal.ts` | TS mirrors + `CATEGORY_LABELS`, `ALIGNMENT_LABELS`, `GROUNDWORK_LABELS`, `PHASE_A_GOAL_TYPE_OPTIONS` (per category), `VALUE_STAGES` (per category) |
| `apps/web/src/routes/accounts/tabs/GoalsTab.tsx` | The whole tab — list / `AddGoalModal` / `GoalCard` / `GoalEditor` / `PhaseAEditor` / `PhaseBEditor` / `PhaseCEditor` / `InitiativeList` / `HistoryFeed` |
| `apps/api/tests/test_cs_goals.py` | 10 smoke tests |
| `docs/features/M15-cs-goals/FUNCTIONAL.md` + `TECHNICAL.md` | This doc set |

### Modified files

| File | What changed |
|---|---|
| `apps/api/app/models/__init__.py` | Exports `CSGoal` |
| `apps/api/app/main.py` | Wires `cs_goals_routes.account_router` + `goal_router` |
| `apps/web/src/lib/api.ts` | `api.delete()` extended to accept an optional body — needed for `/cs-goals/:id` soft delete which carries a mandatory reason |
| `apps/web/src/App.tsx` | `<Route path="goals" element={<GoalsTab />} />` — replaces `GoalsInitiativesPlaceholder`; drops unused placeholder import |
| `apps/web/src/routes/accounts/tabs/CSOnboardingTab.tsx` | Phase 5b placeholder swapped for "Manage Goals →" shortcut card linking to `/accounts/:id/goals` |

## Schema

### `cs_goals`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid primary key default gen_random_uuid()` | |
| `account_id` | `uuid not null references accounts(id) on delete cascade` | |
| `title` | `text not null` | min 1, max 200 (Pydantic) |
| `category` | `cs_goal_category not null default 'other'` | enum |
| `target_value` | `text` | Free-form so categories can use different units |
| `target_date` | `date` | |
| `owner` | `text` | |
| `alignment_status` | `cs_goal_alignment not null default 'not_started'` | enum |
| `phase_a` / `phase_b` / `phase_c` | `jsonb not null default '{}'` | CHECK enforces `jsonb_typeof = 'object'` |
| `initiatives` | `jsonb not null default '[]'` | CHECK enforces array |
| `history` | `jsonb not null default '[]'` | CHECK enforces array; append-only via API |
| `deleted_at` / `_reason` / `_by` | timestamptz / text / uuid | CHECK: either all-null or `deleted_at` and `reason` both set |
| `created_at` / `created_by` / `updated_at` / `updated_by` | standard | |

### Enums

- `cs_goal_category` — `cost_savings / base_rationalization / risk_mitigation / adoption / other`
- `cs_goal_alignment` — `not_started / partial / aligned`

### Indexes

- `idx_cs_goals_account_active` — partial on `(account_id) WHERE deleted_at IS NULL` (hot path for the active goals list)
- `idx_cs_goals_account_all` — full on `(account_id)` for admin views with `include_deleted=true`

### Why jsonb for phases + initiatives + history?

The prototype evolves these field-by-field constantly. A normalized schema would force a migration sweep every time the spec tweaks a name (e.g. `goalType` → `target_origin`). JSONB lets Pydantic enforce the shape at the API boundary and iterate without DDL.

- **phases** — Pydantic uses `model_config = ConfigDict(extra="allow")` so category-specific fields flow through without schema churn.
- **initiatives** — same. `value_fields` is a typed open dict so per-category attributes (e.g. `identified_value`, `committed_value` for cost_savings) round-trip cleanly.
- **history** — append-only, written server-side only. Pydantic schema exists for serialization but clients never send these directly.

The tradeoff: harder to do queries like "all 'committed' initiatives across all accounts." When that comes up, we'll normalize then. For now the cost-benefit favors flexibility.

### Audit log vs `cs_goals.history`

Two distinct concepts:
- **`audit_log`** — field-level DB writes captured by the SQLAlchemy event listener. One row per column change. Generic, mechanical.
- **`cs_goals.history`** — business-level events (`phase_a_completed`, `soft_deleted`, `restored`). One row per meaningful state transition. Domain-specific, written intentionally by the route handler.

Both coexist. The Goals tab renders only `history`; account-level activity feeds elsewhere read `audit_log`.

## Endpoints

### Account-scoped

| Method | Path | Body | Returns | Permission |
|---|---|---|---|---|
| GET | `/api/v1/accounts/:id/cs-goals?include_deleted=false` | — | `CSGoalListOut` | view |
| POST | `/api/v1/accounts/:id/cs-goals` | `CSGoalCreate` | `CSGoalOut` (201) | `can_write_cs_onboarding` |

### Goal-scoped

| Method | Path | Body | Returns | Permission |
|---|---|---|---|---|
| GET | `/api/v1/cs-goals/:goal_id` | — | `CSGoalOut` | view |
| PATCH | `/api/v1/cs-goals/:goal_id` | `CSGoalUpdate` | `CSGoalOut` | `can_write_cs_onboarding`; **409 if deleted** |
| DELETE | `/api/v1/cs-goals/:goal_id` | `{reason: str (5-600 chars)}` | `CSGoalOut` | `can_write_cs_onboarding` |
| POST | `/api/v1/cs-goals/:goal_id/restore` | — | `CSGoalOut` | `is_global_admin` |

Two prefixes (`/accounts/:id/cs-goals` and `/cs-goals/:goal_id`) so the URL space is explicit about scope. Single-router with conflicting paths gets messy.

## Alignment derivation

```python
def _derive_alignment(phase_a, phase_b, phase_c) -> str:
    flags = [
        bool((phase_a or {}).get("phase_a_complete")),
        bool((phase_b or {}).get("phase_b_complete")),
        bool((phase_c or {}).get("phase_c_complete")),
    ]
    if all(flags): return "aligned"
    if any(flags): return "partial"
    return "not_started"
```

Applied during PATCH when one of `phase_a` / `phase_b` / `phase_c` is in the payload AND the caller didn't send an explicit `alignment_status`. Explicit override always wins.

## History append

`_push_history(goal, by, action, **kwargs)` always sets `at = utcnow()` and rebinds `goal.history = old_list + [new_entry]` (SQLAlchemy doesn't auto-detect mutations on JSONB lists — rebind required).

Triggered actions:
- POST → `created`
- PATCH with phase completion flip (incomplete → complete) → `phase_a_completed` / `phase_b_completed` / `phase_c_completed`
- PATCH with any non-phase changes → `updated` (with the changed payload in `new_value`)
- DELETE → `soft_deleted` (with `reason`)
- POST /restore → `restored`

## Soft delete semantics

- Reason required, min 5 chars, max 600 (Pydantic-enforced via `CSGoalDelete`).
- Row stays in the table — `deleted_at` / `deleted_reason` / `deleted_by` populated.
- CHECK constraint `chk_cs_goals_delete_has_reason` enforces "if `deleted_at` is set, `deleted_reason` must also be set" — belt-and-braces against direct DB writes that skip the API.
- PATCH on a soft-deleted goal returns **409 Conflict**. Restore first.
- Restore is admin-only. Clears the three delete fields and writes a `restored` history entry. Idempotent on already-active goals.

## Frontend component split

`GoalsTab.tsx` is ~750 lines but cleanly decomposed:

- `GoalsTab` (top-level) — list query, add modal, show-deleted toggle
- `GoalCard` — collapsed row with `AlignmentDot` + expand-on-click
- `GoalEditor` — expanded body: header / 3 × `PhaseEditor` / `InitiativeList` / `HistoryFeed` / sticky save bar
- `PhaseEditor` — collapsible wrapper with the "mark complete" checkbox in the summary header
- `PhaseAEditor` / `PhaseBEditor` / `PhaseCEditor` — phase-specific field forms
- `InitiativeList` — repeating row editor with category-aware stage dropdown
- `HistoryFeed` — reverse-chronological list of business events
- `AddGoalModal` — minimal create dialog

The dirty-check `serialise()` strips server-owned fields (`created_at`, `is_editable`, `history`, soft-delete fields) so saving the editor doesn't trip on metadata that the server controls. `diff()` produces a PATCH payload with only changed keys.

## RLS

`cs_goals` RLS enabled with the standard view-all-with-auth + write-all-with-auth policies. FastAPI is the enforcement layer (matches the rest of the project). CHECK constraints in the migration provide a second wall against malformed direct writes.

## Tests

`apps/api/tests/test_cs_goals.py` — 10 cases:
- Create → list (id-based assertions, not count-dependent — survives accumulated test-DB state) → soft-delete → include_deleted toggle
- Phase auto-derive: none → not_started → one → partial → all → aligned (with history entries appended)
- Explicit `alignment_status` overrides phase-based derivation
- Initiative roundtrip — full nested shape (`value_fields`, `client_data`, `value_history`)
- Soft delete requires reason: too-short (422), missing entirely (422)
- Restore admin-only: CSM 403, admin 200 with `restored` history entry
- PATCH on soft-deleted goal returns 409
- CSM on own account: create allowed
- CSM on another CSM's account: create 403
- Solutioning manager: view allowed, create 403

## Known gaps / follow-up

- **AI VDD extraction (deferred)** — requires Claude wiring + extraction prompt + review modal. Tracked as M15.1 in CLAUDE.md ⏳ Up next.
- Per-initiative `value_history` is stored as an open array; the UI doesn't yet render a per-initiative timeline.
- No bulk-import / CSV upload — one-at-a-time creation only.
- No goal templates per category — every goal starts blank.
- No cross-account goal queries / portfolio rollups.
