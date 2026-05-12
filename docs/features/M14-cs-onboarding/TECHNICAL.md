# M14 — CS Onboarding (Entry + Stakeholders) — Technical

## Files touched

### New files

| File | Purpose |
|---|---|
| `supabase/migrations/0023_cs_onboarding.sql` | 5 new columns on `accounts` + `cs_entry_type` enum + 2 CHECK constraints |
| `apps/api/app/schemas/cs_onboarding.py` | `Stakeholder` (3 optional fields), `CSOnboardingOut`, `CSOnboardingUpdate` + `STAKEHOLDER_ROLES` constant |
| `apps/api/app/routes/cs_onboarding.py` | GET + PATCH — both dict columns MERGE on partial update |
| `apps/web/src/types/cs_onboarding.ts` | TS mirrors + `STAKEHOLDER_ROLES`, `CS_HANDOVER_ITEMS` |
| `apps/web/src/routes/accounts/tabs/CSOnboardingTab.tsx` | 3 cards: entry picker (instant-save) / handover-or-baseline conditional middle card / stakeholder map (sticky save bar) |
| `apps/api/tests/test_cs_onboarding.py` | 9 smoke tests |
| `docs/features/M14-cs-onboarding/FUNCTIONAL.md` + `TECHNICAL.md` | This doc set |

### Modified files

| File | What changed |
|---|---|
| `apps/api/app/models/account.py` | 5 new fields: `cs_entry_type` (ENUM), `cs_entry_b_context` (text), `cs_entry_b_goals` (text), `cs_handover_checklist` (jsonb), `cs_stakeholders` (jsonb) |
| `apps/api/app/core/rbac.py` | New `can_write_cs_onboarding` predicate (same write set as engagement) |
| `apps/api/app/core/scope.py` | `_FIELDS` extended with the 5 new columns |
| `apps/api/app/schemas/account_detail.py` | Exposes `cs_entry_type` + `can_view_cs_onboarding` so the nav can read entry state without a second call |
| `apps/api/app/routes/accounts.py` | `AccountDetail` builder populates the new fields |
| `apps/api/app/main.py` | Wires `cs_onboarding_routes.router` |
| `apps/web/src/App.tsx` | `/accounts/:id/cs-onboarding` route |
| `apps/web/src/routes/accounts/AccountProfileLayout.tsx` | New "CS Onboarding" nav entry, gated by `can_view_cs_onboarding` |
| `apps/web/src/types/account.ts` | Adds `cs_entry_type`, `can_view_cs_onboarding` |

## Schema

### `accounts.cs_*` columns

| Column | Type | Notes |
|---|---|---|
| `cs_entry_type` | `cs_entry_type` ENUM (A/B) | Nullable until picked |
| `cs_entry_b_context` | `text` | Free-text baseline; only relevant if `cs_entry_type='B'` (not enforced — caller can populate either) |
| `cs_entry_b_goals` | `text` | Same |
| `cs_handover_checklist` | `jsonb not null default '{}'` | CSM-side acknowledgement. Distinct from `handover_quality_check` (Sales side from M13). |
| `cs_stakeholders` | `jsonb not null default '{}'` | `{commercial: {name, email, phone}, champion: {...}, category: {...}}` |

Both jsonb columns have CHECK constraints enforcing `jsonb_typeof = 'object'`.

### Why two checklists (CSM vs Sales)?

Both render the same four items. They're stored separately because they record **who confirmed receipt**, not whether the item exists. The Sales-side `handover_quality_check` says "we delivered this." The CSM-side `cs_handover_checklist` says "we received it." Two-sided handshake; "complete" means both columns tick the same item.

Combining them into one jsonb keyed by side (`{savings: {sales: true, cs: true}}`) was the alternative — rejected as over-engineering for four items.

## Endpoints

| Method | Path | Body | Returns | Permission |
|---|---|---|---|---|
| GET | `/api/v1/accounts/:id/cs-onboarding` | — | `CSOnboardingOut` | view |
| PATCH | `/api/v1/accounts/:id/cs-onboarding` | `CSOnboardingUpdate` | `CSOnboardingOut` | `can_write_cs_onboarding` |

## Merge semantics for jsonb columns

`cs_handover_checklist` and `cs_stakeholders` MERGE in the route handler:

```python
if "cs_handover_checklist" in payload:
    merged = dict(real.cs_handover_checklist or {})
    merged.update(payload["cs_handover_checklist"])
    real.cs_handover_checklist = merged

if "cs_stakeholders" in payload:
    merged = dict(real.cs_stakeholders or {})
    for role, value in payload["cs_stakeholders"].items():
        existing = dict(merged.get(role) or {})
        existing.update(value or {})  # partial role updates merge per-field
        merged[role] = existing
    real.cs_stakeholders = merged
```

This matters because the UI fires one PATCH per role per blur. Without merge, typing an email into the Budget Owner card would erase the existing name. Two-level merge (column → role → field) keeps concurrent edits across roles safe.

## `activated` computed flag

The route derives a frontend convenience flag:

```python
out.activated = bool(acc.gate_signed) or acc.cs_entry_type == 'B'
```

The UI hides the middle card and stakeholder map until `activated == true`. This avoids a half-rendered state for unsigned accounts that haven't yet declared an entry type.

## RLS

`accounts` RLS unchanged; FastAPI is the enforcement layer. CHECK constraints added in 0023:
- `chk_accounts_cs_handover_object` — `cs_handover_checklist` must be a JSON object
- `chk_accounts_cs_stakeholders_object` — same for `cs_stakeholders`

## Tests

`apps/api/tests/test_cs_onboarding.py` — 9 cases:
- Blank GET on a fresh account
- Set Entry B with context + goals → `activated=true`
- Invalid `cs_entry_type` ("C") → 422
- Handover checklist partial updates merge (two PATCHes preserve each other)
- Stakeholder partial role update merges: name → add email later → name preserved; champion update doesn't touch commercial
- Solutioning manager: view yes, edit 403
- CSM on own account: edit allowed
- CSM on other CSM's account: edit 403
- AccountDetail exposes `cs_entry_type` after PATCH

## Known gaps / follow-up

- No automatic link between the three CS stakeholders and the broader `client_contacts` list — they live in parallel.
- No "last edited by" surfaced on stakeholder cards (relying on `audit_log` for history).
- No reminders for empty roles. Coverage banner is passive feedback only.
- Validation: email field is plain string, not EmailStr — UI does basic validation; backend stays permissive so partial entry doesn't 422.
