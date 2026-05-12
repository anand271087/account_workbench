# M13 — Sales Hand-off & Signing — Technical

## Files touched

### New files

| File | Purpose |
|---|---|
| `supabase/migrations/0022_sales_handoff_signing.sql` | 18 `gate_*` columns + `handover_quality_check` jsonb on `accounts`; 11 `sh_*` columns + `sh_validation` enum on `account_solutioning`; 3 CHECK constraints |
| `apps/api/app/schemas/signing.py` | `SigningGateOut`, `SignAccountIn`, `UnlockSigningIn`, `HandoverChecklistUpdate`, `ContractDocUpdate` |
| `apps/api/app/routes/signing.py` | 5 endpoints — GET / sign / unlock / handover-checklist / contract-doc; renewal+VDD date derivation |
| `apps/web/src/types/signing.ts` | TS mirrors + `HANDOVER_QC_ITEMS`, `TERM_OPTIONS` constants |
| `apps/web/src/routes/accounts/tabs/SalesHandoffTab.tsx` | The whole tab — 3 cards + sticky save bar |
| `apps/api/tests/test_signing.py` | 10 smoke tests |
| `docs/features/M13-sales-handoff/FUNCTIONAL.md` + `TECHNICAL.md` | This doc set |

### Modified files

| File | What changed |
|---|---|
| `apps/api/app/models/account.py` | 19 new fields (18 gate_* + handover_quality_check jsonb) |
| `apps/api/app/models/solutioning.py` | 11 new `sh_*` fields + `ShValidation` ENUM binding |
| `apps/api/app/schemas/solutioning.py` | `SolutioningOut`/`SolutioningUpdate` extended; `sh_value_from_solutioning` deliberately not patchable (set by lock) |
| `apps/api/app/schemas/account_detail.py` | Exposes `gate_signed / gate_signed_date / gate_renewal_date / gate_bvd_due_date / can_view_sales_handoff` so the nav doesn't need a second call |
| `apps/api/app/routes/accounts.py` | `AccountDetail` builder populates the new fields |
| `apps/api/app/routes/solutioning.py` | PATCH split by field ownership — `sh_*` editable post-lock by `can_write_sales_handoff`; value-definition fields still gated by `can_write_solutioning + locked_at == null`. Lock endpoint auto-snapshots the value definition into `sh_value_from_solutioning` / `sh_value_themes_from_solutioning` / `sh_value_received_at` |
| `apps/api/app/core/rbac.py` | New predicates: `can_write_sales_handoff`, `can_sign_account`, `can_unlock_signing` |
| `apps/api/app/core/scope.py` | `_FIELDS` extended with the 19 gate_* columns so cached account rows surface them |
| `apps/api/app/main.py` | Wires `signing_routes.router` |
| `apps/web/src/App.tsx` | `/accounts/:id/sales-handoff` route |
| `apps/web/src/routes/accounts/AccountProfileLayout.tsx` | New "Sales Handoff" nav entry, gated by `can_view_sales_handoff` |
| `apps/web/src/types/solutioning.ts` | Adds `ShValidation` literal + 11 `sh_*` fields + `SH_VALIDATION_LABELS` |
| `apps/web/src/types/account.ts` | Adds the 4 `gate_*` snapshot fields + `can_view_sales_handoff` |

## Schema

### `accounts.gate_*` (signing gate)

| Column | Type | Notes |
|---|---|---|
| `gate_signed` | `boolean not null default false` | Master flag |
| `gate_signed_date` | `date` | CHECK ensures non-null when `gate_signed` is true |
| `gate_contract_acv` | `numeric(14, 2)` | CHECK ≥ 0 |
| `gate_contract_term` | `text` | Free-text: "1 year" / "2 years" / "3 years" / "Custom" |
| `gate_renewal_date` | `date` | Derived in API from signed_date + term_years; null if term unrecognised |
| `gate_bvd_due_date` | `date` | Derived; signed_date + 183 days, pulled to renewal − 30 days if it would overshoot |
| `gate_confirmed_by` / `_at` | `uuid` / `timestamptz` | Who confirmed signing and when |
| `gate_unlocked` | `boolean not null default false` | Flips true on `/sign/unlock`; cleared on next `/sign` |
| `gate_unlock_reason` / `_by` / `_at` | text / uuid / timestamptz | Captured on unlock |
| `gate_contract_doc` / `_at` | text / date | Filename + upload date — actual file via existing Documents pipeline |
| `gate_contract_modules` | `text[] not null default '{}'` | Module chips shown on the signed card |
| `gate_platform_tier` / `gate_account_segment` / `gate_subscribers` | text | Free-text metadata |
| `handover_quality_check` | `jsonb not null default '{}'` | `{"savings": true, "stakeholders": true, ...}` — Sales-side handshake |

### `account_solutioning.sh_*` (Sales Hand-off context)

| Column | Type | Notes |
|---|---|---|
| `sh_value_from_solutioning` | `text` | **Set by lock endpoint, not by PATCH.** Immutable snapshot. |
| `sh_value_themes_from_solutioning` | `text` | Comma-joined themes, also set on lock. |
| `sh_value_received_at` | `timestamptz` | Lock timestamp. |
| `sh_value_validation` | `sh_validation` ENUM | `confirmed` / `partially_confirmed` / `revised` |
| `sh_validation_notes` | `text` | |
| `sh_go_live_date` / `sh_first_checkpoint` | `date` | |
| `sh_stakeholder_signoff` | `text` | Free-text who-approved. |
| `sh_commercial_context` | `text` | |
| `sales_watchouts` | `text` | |
| `handoff_file_name` | `text` | Filename pointer. |

## Endpoints

| Method | Path | Body | Returns | Permission |
|---|---|---|---|---|
| GET | `/api/v1/accounts/:id/sign` | — | `SigningGateOut` | view |
| POST | `/api/v1/accounts/:id/sign` | `SignAccountIn` | `SigningGateOut` | `can_sign_account` |
| POST | `/api/v1/accounts/:id/sign/unlock` | `UnlockSigningIn` (reason ≥10 chars) | `SigningGateOut` | `can_unlock_signing` (admin only) |
| PATCH | `/api/v1/accounts/:id/handover-checklist` | `{items: {...}}` | `SigningGateOut` | `can_write_sales_handoff` |
| PATCH | `/api/v1/accounts/:id/contract-doc` | `{gate_contract_doc: str}` | `SigningGateOut` | `can_write_sales_handoff` + `gate_signed` |

**409 on double-sign:** `POST /sign` rejects if the gate is already signed and not unlocked. Re-signing requires `/sign/unlock` first — forces an audit trail for any contract metadata change.

**Idempotent unlock:** repeat unlocks don't reset metadata. Returns current state.

## Date derivation

```python
def _years_from_term(term: str) -> int | None:
    # "1 year" / "1y" / "12 months" → 1
    # "Custom" / anything else → None (renewal_date stays null)

def _derive_dates(signed_date, term):
    years = _years_from_term(term)
    if years is None: return (None, None)
    renewal = signed_date.replace(year=signed_date.year + years)  # Feb-29 falls back to Feb-28
    bvd = signed_date + timedelta(days=183)
    if bvd > renewal: bvd = renewal - timedelta(days=30)
    return renewal, bvd
```

The `Custom` term path leaves both dates null and the UI surfaces them as "—". A follow-up could let the user input renewal_date manually for Custom; not in scope here.

## Lock auto-snapshot edge cases

- **First lock** with empty `sh_value_from_solutioning` → copy `value_definition` + themes, set `sh_value_received_at`.
- **Re-lock after unlock** → leave existing `sh_*` snapshot intact. Sales's edits during the unlock window aren't wiped just because Solutioning re-passes.
- **Lock with empty `value_definition`** → 400. Same guard as before — we don't hand an empty contract to Sales.

## `is_editable` reconciliation

`SolutioningOut.is_editable` is now a coarse OR: `(can_write_solutioning AND locked_at IS NULL) OR can_write_sales_handoff`. The frontend uses this as a render hint; the PATCH handler does the per-field enforcement (split into `sol_fields` vs `sh_fields`, each with its own RBAC). Two-layer defense.

## RLS

`accounts` and `account_solutioning` RLS unchanged (FastAPI is the enforcement layer). The migration adds CHECK constraints as belt-and-braces against malformed direct DB writes:
- `chk_accounts_signed_has_date` — `gate_signed=true` requires a date
- `chk_accounts_gate_acv_nonneg`
- `chk_accounts_hqc_object` — `handover_quality_check` must be a JSON object, not array/scalar

## Tests

`apps/api/tests/test_signing.py` — 10 cases:
- GET visibility + capability flags (admin can_sign true, CSM can_sign false)
- POST /sign → 2-year contract → renewal date 2 years out, VDD 183 days
- 409 on double-sign without unlock
- 403 on CSM signing
- Unlock + re-sign clears unlocked flag
- Unlock reason length validation (422 on <10 chars)
- Unlock 403 for non-admin (solutioning_manager)
- Handover checklist merge (two partial PATCHes preserve each other)
- Solutioning lock snapshots `value_definition` into `sh_value_from_solutioning`
- PATCH solutioning while locked: `sh_*` fields allowed (200), value_definition blocked (409)

## Known gaps / follow-up

- No PDF generation of the signed contract.
- No e-sign integration — `/sign` is a manual milestone Sales fires after signing happens elsewhere.
- ACV is single-currency (USD assumed in UI).
- "Custom" term leaves renewal_date null — UI shows "—" but a follow-up could expose a manual renewal-date input.
- Renewal alerts / VDD reminders — not wired. The dates are passive metadata for now.
