# M18–M23 — Success Management — Technical Spec

**Shipped:** 2026-05-12 (commits `82e56e6` through `f7d90f3`)

## Migrations

| File | What it adds |
|------|--------------|
| `0029_success_contract.sql` | `accounts.success_contract jsonb` + `success_contract_locked_at/by` + lock-consistency CHECK + jsonb-is-object CHECK |
| `0030_success_metrics.sql` | `success_metrics` table + `metric_type`/`metric_status` enums via DO blocks |
| `0031_checkpoints.sql` | `checkpoints` table + `checkpoint_type` (Kickoff/MBR/QBR/Renewal) + `checkpoint_status` (not_held/held/signed_off) enums + sign-off-consistency CHECK + signed_off_snapshot-is-object CHECK |
| `0032_value_delivery_document.sql` | `accounts.value_delivery_document jsonb` + `vdd_locked_at/by` + lock-consistency + jsonb-is-object CHECKs |
| `0033_delivery_renewal.sql` | `accounts.delivery_renewal jsonb` + `dr_outcome` (text-with-CHECK) + `dr_outcome_set_at/by` + outcome-stamp-consistency CHECK |

All migrations are idempotent (`if not exists` / `drop constraint if exists` patterns). Enums use `do $$ ... exception when duplicate_object then null; end $$` because Postgres has no `CREATE TYPE IF NOT EXISTS`.

## ORM additions

- `Account` model gains 11 columns across these milestones (`success_contract*`, `value_delivery_document*`, `vdd_locked_*`, `delivery_renewal`, `dr_outcome*`).
- `core/scope.py::_FIELDS` whitelist extended on each migration so the cached account snapshot includes the new columns. Forgetting this surfaces as `Input should be a valid boolean [input_value=None]` on AccountDetail.
- New tables: `success_metrics`, `checkpoints`. Each soft-delete-capable; checkpoints lock via status, metrics via standard `deleted_at`.

## Routes

### M19 Success Contract — `/accounts/:id/success-contract`

```
GET    → auto-drafts on first read if empty (sources solutioning.value_definition,
         sh_value_from_solutioning, sh_stakeholder_signoff)
PATCH  → 409 if locked; None values pop keys so the auto-draft branch in GET
         remains reliable on full-reset
POST   /lock     → 422 if any of 3 locks unsatisfied
POST   /unlock   → admin-only
```

### M20 Value Tracking

```
GET    /accounts/:id/metrics
POST   /accounts/:id/metrics
PATCH  /metrics/:id
POST   /metrics/:id/log-value      → appends to history + recomputes status
DELETE /metrics/:id                 → soft, requires reason ≥5 chars
POST   /metrics/:id/restore         → admin-only
```

The status engine lives in `schemas/metric.py::derive_status` — pure function, no DB hit. Frontend uses the same logic via the `STATUS_LABELS` / `STATUS_COLORS` constants in `types/metric.ts`.

### M21 Checkpoints

```
GET    /accounts/:id/checkpoints
POST   /accounts/:id/checkpoints
POST   /accounts/:id/checkpoints/auto-schedule   → idempotent; requires gate_signed
PATCH  /checkpoints/:id                          → 409 if signed_off
POST   /checkpoints/:id/sign-off                 → writes immutable snapshot
DELETE /checkpoints/:id                          → 409 if signed_off
```

Auto-schedule cadence is hard-coded in the route handler:

```py
plan = {
  "Kickoff": signed,
  "MBR":     signed + timedelta(days=90),
  "QBR":     signed + timedelta(days=180),
  "Renewal": (renewal - timedelta(days=14)) if renewal else signed + timedelta(days=335),
}
```

### M22 VDD — `/accounts/:id/value-delivery-document`

```
GET    → auto-drafts from success_contract + success_metrics + cs_goals.initiatives
PATCH  → 409 if locked
POST   /lock     → 422 if any of 4 sections empty
POST   /unlock   → admin-only
```

### M23 Delivery & Renewal — `/accounts/:id/delivery-renewal`

```
GET    → hydrates track1 from M21 checkpoints; computes expand_paused + readiness_score
PATCH  → 409 when outcome is set
POST   /red-flags                          → 201; server-generates id + raised_at + raised_by
POST   /red-flags/:id/resolve              → idempotent
POST   /outcome                            → one-shot; 409 on re-set
POST   /reopen                             → admin-only
```

**Critical bug found + fixed during dev:** shallow `dict(real.delivery_renewal or {})` + in-place inner-dict mutation left old/new graphs value-equal so SQLA skipped the UPDATE. Caught by the red-flag resolve test (flag stayed "open" after a successful resolve POST). Fix:

```py
merged = copy.deepcopy(real.delivery_renewal or {})
```

Applied across `add_red_flag`, `patch_dr`, and `resolve_red_flag`.

## RBAC

- `can_write_cs_onboarding(role, *, is_assigned, is_team)` gates writes on all five sub-tabs (admin + cs_director + vp_csm + CSM-on-own + cs_team_manager-on-team + ISM-on-own).
- `is_global_admin(role)` gates every unlock / re-open / restore — the consistent M13 / M19 / M22 / M23 asymmetry.

## Schemas

All Pydantic shapes use `model_config = ConfigDict(extra="allow")` so future prompt evolutions don't require schema bumps. Critical for the auto-draft sources where the source documents (solutioning, success_metrics, cs_goals) keep gaining fields.

## Frontend layout pattern

`SuccessManagementLayout.tsx`:

```tsx
<NavLink ... className={isActive ? "border-pink-500/40 bg-pink-500/5 text-pink-700 font-bold" : ...}>
  {label}
</NavLink>
...
<Outlet context={{ account }} />
```

Pink theme (`#FD576B` family) per prototype. Leaf tabs consume `account` via `useAccountFromLayout()` — zero per-tab fetching for header data.

## Calculation Reference (single source of truth)

### M19 — Success Contract: 3-lock validation

Auto-drafted on first GET if `accounts.success_contract` is empty. Source mapping:

| Lock field | Default value source | Marked auto-drafted |
|---|---|---|
| `primary_metric` | (left null — user fills) | — |
| `measurement_method` | `account_solutioning.sh_value_validation` | yes |
| `value_narrative` | `account_solutioning.value_definition` (or `sh_value_from_solutioning` if locked) | yes |
| `measure_owner` | `sh_stakeholder_signoff` ?? CSM full_name | yes |
| `measure_freq` | "Quarterly" | yes (default) |

**Lock requires all 3 to satisfy:**
- `primary_metric` — non-blank
- `measurement_method` — non-blank
- `value_narrative` — `len(trim) >= 10` chars

Unlock = admin / cs_director / vp_csm only — sets `success_contract_locked_at/by` back to null.

PATCH with `null` value → pops the key from the jsonb (lets fully-reset contracts hit the auto-draft branch again on next GET).

### M20 — Value Tracking: status derivation engine

`apps/api/app/schemas/metric.py::derive_status` runs server-side on every metric on every read. Pure function (no DB / no side-effects).

| Metric type | Input | Output |
|---|---|---|
| `status_override` set | (anything) | the override value (green/amber/red/grey) |
| Quantitative — `current_value` blank | — | `grey` |
| Quantitative — both values parseable | `pct = parse_num(current) / parse_num(target)` | `pct ≥ 0.80 → green` · `pct ≥ 0.50 → amber` · else `red` |
| Quantitative — parse fails | — | `grey` |
| Qualitative — `current_value.lower()` matches `high` | — | `green` |
| Qualitative — matches `medium` or `med` | — | `amber` |
| Qualitative — matches `low` | — | `red` |
| Qualitative — anything else | — | `grey` |

**parse_num** strips `$`, `%`, `,`, `K`, `M`, `B` suffixes and converts (e.g. `"$2M"` → 2_000_000, `"80%"` → 0.80).

**Status summary tile** (top of Value Tracking) counts `green / amber / red / grey` across all non-deleted metrics — drives the per-metric coloured progress bar.

### M21 — Checkpoints: auto-schedule cadence

`POST /accounts/:id/checkpoints/auto-schedule` is **idempotent** — only inserts checkpoints for `type` values not already present on the account.

**Day 0 = `accounts.gate_signed_date`** (account must be signed; route returns 422 if not).

| Type | Scheduled date |
|---|---|
| **Kickoff** | `gate_signed_date` |
| **MBR** | `gate_signed_date + 90 days` |
| **QBR** | `gate_signed_date + 180 days` |
| **Renewal** | `gate_renewal_date − 14 days` (preferred) · falls back to `gate_signed_date + 335 days` |

Sort order: Kickoff → MBR → QBR → Renewal.

**Status transitions:**
- `not_held` → `held`: PATCH with `held_date` set
- `held` → `signed_off`: POST `/sign-off` writes an immutable `signed_off_snapshot` (jsonb) containing reviewed initiatives + metrics + client_acknowledgement + next_actions

**Sign-off is permanent evidence:**
- PATCH on a signed-off row → 409
- DELETE on a signed-off row → 409
- Second sign-off → 409
- Admin re-open is the only escape hatch

### M22 — VDD: 4-section lock validation + CSM-attributed totals

Auto-draft on first GET pulls from upstream:
- `client_strategic_priorities` ← `success_contract.value_narrative` split on newlines
- `agreed_success_metrics` ← snapshot of `success_metrics` rows
- `beroes_approach` ← `cs_goals.initiatives` (mapped to ApproachItem shape)
- `value_delivered` ← same source, with CSM-attributed dollar columns

**Lock requires ALL 4 sections to have ≥1 item** ([routes/vdd.py:280-300](../../../apps/api/app/routes/vdd.py#L280-L300)):

| Section | Lock check |
|---|---|
| `client_strategic_priorities` | `len(list) >= 1` |
| `agreed_success_metrics` | `len(list) >= 1` |
| `beroes_approach` | `len(list) >= 1` |
| `value_delivered` | `len(list) >= 1` |

Missing any → 422 with `"Cannot lock — missing: <list>"`.

**CSM-attributed rollup totals** (rendered as 3 tiles in the UI):

```
$identified  = Σ value_delivered[i].identified_usd_m   (Decimal millions)
$committed   = Σ value_delivered[i].committed_usd_m
$implemented = Σ value_delivered[i].implemented_usd_m
```

Each `ValueDeliveredItem` carries 3 nullable Decimal fields; nulls treated as 0.

**Lock state:**
- `vdd_locked_at` + `vdd_locked_by` paired (DB CHECK)
- PATCH on locked → 409
- Unlock = admin only, clears both fields

**Mutation safety:** all VDD mutations use `copy.deepcopy(real.value_delivery_document or {})` so SQLAlchemy detects the change (shallow copy + in-place mutation produces value-equal graphs and SQLA skips the UPDATE).

### M23 — Delivery & Renewal: dual-track + readiness + outcome

**Track 1 (delivery hygiene)** — derived live every read from M21 Checkpoints:

```python
async def _derive_track1(db, account_id):
    cps = checkpoints(account_id) where not deleted
    return Track1Derived(
        next_type           = earliest upcoming non-signed type or None,
        next_days_until     = (scheduled - today).days for that row,
        overdue_count       = count(scheduled < today AND status != "signed_off"),
        signed_off_count    = count(status == "signed_off"),
    )
```

**Track 2 (expand)** — Kanban with 4 columns: `value_proof / expand_ask / new_scope / close`. Each item has `{id, title, owner, due_date, notes, archived}`.

**Red flags** — `red_flags` jsonb array. Each `{id, type, raised_at, raised_by, note, resolved_at, resolved_by, resolved_note}`.
- Flag types: `usage_drop / value_dispute / champion_loss / executive_turnover / integration_block / pricing_pushback / scope_creep / contract_dispute / other`
- Resolved when all 3 of `resolved_at / resolved_by / resolved_note (≥5 chars)` are set.

**expand_paused** (derived live):

```python
expand_paused = any(f.resolved_at is None for f in red_flags)
```

When true the M26 appetite banner shows a "Track 2 paused" hint (UI only — doesn't change scoring math).

**Renewal Readiness 3-question grid** — `readiness` jsonb with 3 `ReadinessAnswer` rows: `delivered_metric / proof_data / client_acknowledged` each with `answer ∈ {yes, no, partial}` + `proof_notes`.

**readiness_score** (0..3, derived live):

```python
def _readiness_score(r):
    return sum(1 for a in (r.delivered_metric, r.proof_data, r.client_acknowledged)
               if a.answer == "yes")
```

UI shows `<score>/3 yes` badge.

**Outcome** (one-shot decision):

| Value | Effect |
|---|---|
| `renewed` | Locks the D&R document — PATCH returns 409 until admin re-opens |
| `at_risk` | Same lock — re-open required to change |
| `not_renewed` | Same lock |
| `undecided` | (clear case — `dr_outcome` is null) |

Stamped on `accounts.dr_outcome / dr_outcome_set_at / dr_outcome_set_by` (DB CHECK enforces the trio).

Re-open = admin-only (`is_global_admin`). Clears all 3 stamp fields.

### Frontend rendering rules

| Surface | Threshold |
|---|---|
| M20 status pill colour | `derive_status` output → tone classes (emerald / amber / red / slate) |
| M21 overdue badge | scheduled < today AND status != "signed_off" → red `⚠` |
| M21 days-until pill | `>7d → slate`, `≤7d → amber`, `<0 → red` (chip below renewal cell on AccountListPage) |
| M22 CSM totals | render `null` as `—` (avoid `$0` confusion with truly-zero values) |
| M23 red-flag count | shown as red pill when > 0 on Home (Row 66) |

### Where to change these values

| To change | Edit | Re-deploy needed |
|---|---|---|
| M20 quantitative thresholds (0.80 / 0.50) | [`apps/api/app/schemas/metric.py::derive_status`](../../../apps/api/app/schemas/metric.py) | API only |
| M21 cadence days (90 / 180 / 14) | [`apps/api/app/routes/checkpoints.py::auto_schedule_checkpoints`](../../../apps/api/app/routes/checkpoints.py) | API only |
| M22 lock-validation min counts (currently ≥1 each) | [`apps/api/app/routes/vdd.py::lock_vdd`](../../../apps/api/app/routes/vdd.py) | API only |
| M23 readiness scoring formula | `_readiness_score` in [`apps/api/app/routes/delivery_renewal.py`](../../../apps/api/app/routes/delivery_renewal.py) | API only |
| Red-flag resolution note ≥5 chars | Pydantic `Field(min_length=5)` on `RedFlag` schema | API only |

## Tests

| File | Cases | Coverage |
|------|-------|----------|
| `test_success_contract.py` | 9 | CRUD, auto-draft fires only on empty, lock validation, 409-on-patch-when-locked, admin-only unlock, CSM-on-own works |
| `test_metrics.py` | 9 | Status engine (quant/qual/override/grey), CRUD, log-value-with-history, soft-delete-with-reason, admin-only restore |
| `test_checkpoints.py` | 7 | CRUD, sign-off persistence, immutability after sign-off, auto-schedule gate, RBAC matrix |
| `test_vdd.py` | 7 | Auto-draft, full roundtrip, lock 4-section validation, 409-on-patch-when-locked, admin-only unlock |
| `test_delivery_renewal.py` | 6 | GET empty, PATCH + readiness score derives, red flag pauses expand + resolve, outcome immutability + admin reopen, sol_mgr forbidden, reopen admin-only |

**38 cases in total. All green.**

## Frontend file map

```
apps/web/src/routes/accounts/
├── SuccessManagementLayout.tsx          # M18 — pink sub-tab strip + outlet
└── tabs/sm/
    ├── _StubTab.tsx                     # M18 — shared SMStub component
    ├── VDDTab.tsx                       # M22
    ├── ContractGoalsTab.tsx             # M19 (composes M15 GoalsTab)
    ├── ValueTrackingTab.tsx             # M20
    ├── CheckpointsTab.tsx               # M21
    └── DeliveryRenewalTab.tsx           # M23

apps/web/src/components/
└── SuccessContractCard.tsx              # M19 — 3-lock card used inside ContractGoalsTab

apps/web/src/types/
├── success_contract.ts                  # M19
├── metric.ts                            # M20
├── checkpoint.ts                        # M21
├── vdd.ts                               # M22
└── delivery_renewal.ts                  # M23
```
