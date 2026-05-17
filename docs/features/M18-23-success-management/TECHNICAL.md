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
