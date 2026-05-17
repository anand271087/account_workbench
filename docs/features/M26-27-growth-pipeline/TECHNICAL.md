# M26 + M27 — Growth & Pipeline — Technical Spec

## Migrations

`0035_account_plays.sql` (M26):
- `account_plays` table — id, account_id, title, value_usd (numeric), prob (int 0..100), when_text, trigger_text, modes (text[]), role, added_by, hidden, audit
- CHECK: `prob between 0 and 100`
- CHECK: `modes <@ array['rescue', 'retain', 'expand']::text[]`
- `accounts.plan_current_mode` text + CHECK in `('rescue','retain','expand')` or null

`0036_signals_activities.sql` (M27):
- 4 enums via DO blocks: `signal_type`, `signal_impact`, `signal_status`, `activity_type`
- `soft_signals` table with resolution-atomicity CHECK:
```sql
chk_soft_signals_resolution_consistent check (
  (status='active' and resolved_at is null and resolved_by is null and resolved_note is null)
  or
  (status='resolved' and resolved_at is not null and resolved_by is not null
                     and resolved_note is not null and length(trim(resolved_note)) >= 5)
)
```
- `account_activities` table with `linked_metrics uuid[]`

## Appetite Service

`apps/api/app/services/appetite.py::compute_appetite` — port of prototype `calcAppetiteScore`.

**Vocab mapping table** because our tier/account_type enums differ from the prototype's:

```py
_TIER_MAP = {
  "Strategic":  "T1",
  "Enterprise": "T2",
  "Growth":     "T3",
  "Emerging":   "Pre-contract",
}
_TYPE_MAP = {
  "New Logo":  "Hyper Growth",
  "Existing":  "Standard Growth",
  "Renewal":   "Retention",
  "Pilot":     "New Account",
}
```

This lets the prototype's `ARR_TARGETS` table keep working without rewrite.

**Signature:**
```py
def compute_appetite(
    *,
    acc: Account,
    plays: list[AccountPlay],
    signals: list[SoftSignal] | None = None,
    today: date | None = None,
) -> AppetiteOut
```

When `signals=None` the function defaults to `sig_pts=15` (neutral) — used during M26 before M27 shipped.

## Routes

### M26

```
GET    /accounts/:id/plays
POST   /accounts/:id/plays
PATCH  /plays/:id
DELETE /plays/:id                  → soft via hidden=true
GET    /accounts/:id/appetite-score
POST   /accounts/:id/plan-mode     → null clears override → auto
```

`appetite-score` fetches plays + signals + computes:

```py
return compute_appetite(acc=acc, plays=list(plays), signals=list(signals))
```

### M27

```
GET    /accounts/:id/signals
POST   /accounts/:id/signals
PATCH  /signals/:id
POST   /signals/:id/resolve        → ≥5 char note required
POST   /signals/:id/reopen         → admin-only
DELETE /signals/:id                → admin-only hard delete

GET    /accounts/:id/activities
POST   /accounts/:id/activities
PATCH  /activities/:id
DELETE /activities/:id             → soft via hidden=true
```

## RBAC

- `can_write_cs_onboarding(role, *, is_assigned, is_team)` — gates writes on plays, signals, activities, plan-mode override
- `is_global_admin(role)` — gates `/reopen` and `/signals/:id` hard delete

## Frontend

```
apps/web/src/routes/accounts/
├── GrowthPipelineLayout.tsx              # emerald sub-tab strip + outlet
└── tabs/gp/
    ├── _GPStub.tsx                       # shared stub for remaining sub-tabs
    ├── AccountPlanTab.tsx                # M26 — bPlan port
    ├── SignalsActivityTab.tsx            # M27 — bStrategyEngage port
    └── ExternalIntelTab.tsx              # M28 stub

apps/web/src/types/
├── play.ts                               # M26: Play, Appetite, MODE_CONF, SALES_STAGES, stageColor/Name, fmtK
└── signal.ts                             # M27: SoftSignal, Activity, SIG_CONF, ACT_CONF, IMPACT_LABELS
```

The signals/appetite loop is implemented via TanStack Query: every mutation inside `SignalsActivityTab` calls `qc.invalidateQueries({ queryKey: ["appetite", accountId] })` so the M26 banner picks up the score shift.

## Tests

| File | Cases | Coverage |
|------|-------|----------|
| `test_plays.py` | 8 | CRUD, soft-delete-hides, appetite breakdown sums to score, override + clear, pipeline lifts projected ACV, sol_mgr forbidden, CSM-own allowed |
| `test_signals.py` | 7 | Signal CRUD, resolve requires note (Pydantic ≥5 chars), 409 on second resolve, admin-only reopen, **sig_pts response curve** (baseline→25→0 as signal mix shifts), activity soft-delete, RBAC |

**15 cases total. All green.**
