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

`apps/api/app/services/appetite.py::compute_appetite` — **direct port of prototype `calcAppetiteScore`** at [`prototype/beroe_awb_v20.html:1566`](../../../prototype/beroe_awb_v20.html). Every weight, threshold, and matrix value listed below is verbatim from the prototype — none of it was invented for this codebase.

### Calculation Reference (single source of truth)

#### Score components — 0..100 total

| Component | Weight | Formula | Reads from |
|---|---|---|---|
| **Health Score** | 40% | `round(accounts.health_score × 0.40)` → 0..40 | `accounts.health_score` (stored 0..100; seeded per account, NOT live-derived in v1.0) |
| **Signal Mix** | 25% | Curve based on active signal-type shares (see table below) → 0..25 | `soft_signals` rows where `status='active' AND hidden=false` |
| **Renewal Proximity** | 15% | Days-to-renewal banding (see table below) → 0..15 | `accounts.gate_renewal_date` (M13) — falls back to `accounts.renewal_date` |
| **ARR Growth** | 20% | `round(pipeline_total / target_acv × 20)` clamped to 0..20 | `account_plays` rows: pipeline = `Σ(value_usd × prob/100)` over `hidden=false` |
| **Total** | 100% | `health_pts + sig_pts + renew_pts + arr_pts` | — |

#### Mode mapping (final step)

| Total score | Mode | Icon | Strategy |
|---|---|---|---|
| 0–39 | `rescue` | 🚨 | Stop churn, recover relationship, secure renewal |
| 40–69 | `retain` | 🛡️ | Protect current ACV, drive adoption, deepen relationship |
| 70–100 | `expand` | 🚀 | ACV growth through upsell + cross-sell |

#### Signal Mix curve (sig_pts 0..25)

Computes shares of active signals by type, then picks the dominant band:

| Condition | sig_pts |
|---|---|
| `(positive_share + expansion_share) > 50%` | 25 |
| `neutral_share > 50%` (or no signals at all) | 15 (default) |
| `risk_share > 50%` | 8 |
| `critical_share > 30%` | 0 |

Renewal-proximity branch (M27): if `days_to_renewal < 90` AND there are zero risk/critical signals, sig_pts is BUMPED to 6 (instead of 0) — a "calm before renewal" allowance.

#### Renewal Proximity curve (renew_pts 0..15)

| Days to renewal | renew_pts |
|---|---|
| `dtr > 180` (or no renewal date set) | 15 |
| `90 ≤ dtr ≤ 180` | 10 |
| `dtr < 90` AND **any** risk/critical signal | 0 |
| `dtr < 90` AND clean (no risk/critical) | 6 |

#### ARR Target matrix (`ARR_TARGETS`)

Verbatim from prototype [line 1559](../../../prototype/beroe_awb_v20.html). Keyed on prototype tier × account_type vocab; mapped from our enums via `_TIER_MAP` / `_TYPE_MAP` below.

Target ARR growth percentage applied as `target_acv = current_acv × (1 + ARR_TARGETS[tier][type])`:

| Tier ↓ / Type → | Hyper Growth | Standard Growth | Retention | New Account |
|---|---|---|---|---|
| **T1 Strategic** | 0.40 (40%) | 0.20 (20%) | 0.05 (5%) | — |
| **T2 Enterprise** | 0.50 (50%) | 0.25 (25%) | 0.05 (5%) | — |
| **T3 Growth** | 0.60 (60%) | 0.30 (30%) | 0.05 (5%) | — |
| **Pre-contract** | — | — | — | 0.30 (30%) |

Worked example for Mondelez (tier=Enterprise → T2, type=New Logo → Hyper Growth, current_acv=$310K):
- `ARR_TARGETS["T2"]["Hyper Growth"] = 0.50`
- `target_acv = 310,000 × 1.50 = $465,000`
- If `pipeline_total = $0` then `arr_pts = round(0 / 465000 × 20) = 0/20` (clamps to 0)
- If `pipeline_total = $232,500` then `arr_pts = round(0.5 × 20) = 10/20`

#### ARR status banding (drives the burn-down tile color)

After computing `projected_acv = current_acv + pipeline_total`:

| Condition | status | colour |
|---|---|---|
| `target_acv == 0` (no target) | `n/a` | slate (empty state) |
| `projected ≥ target` | `on_track` | green |
| `projected ≥ current × 0.95` (within 5% of current) | `behind` | amber |
| else | `declining` | red |

#### Mode override / hard cap

- `accounts.plan_current_mode` (text, nullable) — when set, used as the **active** mode for display, but the **recommended** mode (raw computation) is preserved on `appetite.recommended_mode` so the UI can show "(override)" vs "(recommended)".
- Hard cap: `account_type == "Renewal"` is capped at `retain` — never `expand`. Forced down even if total score >= 70.
- Tier=Strategic + utilization < 50% gating exists in the prototype (line 1602-ish) but is currently a no-op here because we don't track seat utilization yet.

### Vocab mapping (our enums ↔ prototype's)

The prototype was authored against an older tier/type vocabulary. To keep the prototype's `ARR_TARGETS` matrix unchanged, we map at the boundary:

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

Unmapped values fall back to `"Pre-contract"` / `"Standard Growth"` respectively.

### Plan Inputs sidebar (`PlanInputs` component)

Lives in [`apps/web/src/routes/accounts/tabs/gp/AccountPlanTab.tsx`](../../../apps/web/src/routes/accounts/tabs/gp/AccountPlanTab.tsx) as the `PlanInputs` component. Shows the 6 raw inputs that feed the appetite score, all normalised to a /100 scale so they read consistently:

| Row | Formula | Source |
|---|---|---|
| **Health X/100** | `account.health_score ?? 0` | `accounts.health_score` (raw, NOT weighted) |
| **Product X/100** | `round(modules_owned / 8 × 100)` — 8 is `BEROE_MODULES.length` (= prototype's `BEROE_PRODUCTS.length`) | `signing-gate.gate_contract_modules.length` |
| **Signals X/100** | `round(appetite.breakdown.sig_pts / 25 × 100)` — same sig_pts as the weighted tile, just rescaled to 100 | derived from `soft_signals` |
| **Active Signals N logged** | `signals.filter(s => s.status !== 'resolved').length` | `soft_signals` table |
| **Activity N entries** | `activities.filter(a => !a.hidden).length` | `account_activities` table |
| **Hot Cats N** | `cat_intel.top_cats.filter(c => c.heat === 'hot').length` | `accounts.platform_intel.cat_intel` jsonb |

### ACV Growth Path tile

| Number | Formula |
|---|---|
| **Current** | `accounts.current_acv` (Decimal, stored) |
| **Target** | `current_acv × (1 + ARR_TARGETS[tier][type])` — same as the appetite ARR-target |
| **Gap** | `max(0, target − current)` |
| **Pipeline** | `Σ(play.value_usd × play.prob/100)` over un-hidden plays |
| Progress bar % | `round(projected / target × 100)` clamped to 0..100, where `projected = current + pipeline` |

### Function signature

```py
def compute_appetite(
    *,
    acc: Account,
    plays: list[AccountPlay],
    signals: list[SoftSignal] | None = None,
    today: date | None = None,
) -> AppetiteOut
```

When `signals=None` the function defaults to `sig_pts=15` (neutral baseline) — used during M26 before M27 shipped soft_signals.

### Where to change these values

| To change | Edit | Re-deploy needed |
|---|---|---|
| Component weights (40/25/15/20) | [`apps/api/app/services/appetite.py`](../../../apps/api/app/services/appetite.py) | API only |
| Mode bands (0-39 / 40-69 / 70-100) | same file | API only |
| Signal Mix curve thresholds (>50%, >30%) | same file | API only |
| Renewal Proximity banding (180, 90 days) | same file | API only |
| ARR_TARGETS matrix values | `_PROTO_ARR_TARGETS` in same file | API only |
| Tier / Type vocab mapping | `_TIER_MAP` / `_TYPE_MAP` in same file | API only |
| BEROE_MODULES count (8) | `TOTAL_BEROE_MODULES` in [`apps/web/src/types/play.ts`](../../../apps/web/src/types/play.ts) | Frontend only |
| Plan Inputs rendering / order | `PlanInputs` in `AccountPlanTab.tsx` | Frontend only |

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
