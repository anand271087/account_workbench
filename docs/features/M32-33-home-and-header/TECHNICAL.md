# M32 + M33 — Home Tab + Account-Header Trio — Technical

## Files changed

### M32
```
apps/web/src/routes/accounts/AccountProfileLayout.tsx   # SUB_NAV reduced 7→5
apps/web/src/routes/accounts/tabs/HomeTab.tsx           # NEW — ~600 lines
apps/web/src/routes/accounts/tabs/PreSalesTab.tsx       # +Client Contacts shortcut card
apps/web/src/App.tsx                                    # /value-def redirect, /home alias
```

### M33
```
apps/web/src/routes/accounts/AccountProfileLayout.tsx   # KPI strip → period+health+mode trio
apps/web/src/routes/accounts/tabs/ir/AnalyticsTab.tsx   # period scaling wired (Option A)
```

No backend changes for either milestone — HomeTab + trio read from existing M19–M28 endpoints.

---

## M32 — Home tab

### TanStack Query fan-out

HomeTab fetches 7 endpoints in parallel:

```ts
const apptQ    = useQuery({ queryKey: ["appetite",        aid] });    // M26
const signalsQ = useQuery({ queryKey: ["signals",         aid] });    // M27
const playsQ   = useQuery({ queryKey: ["plays",           aid] });    // M26
const cpsQ     = useQuery({ queryKey: ["checkpoints",     aid] });    // M21
const metsQ    = useQuery({ queryKey: ["metrics",         aid] });    // M20
const actsQ    = useQuery({ queryKey: ["activities",      aid] });    // M27
const drQ      = useQuery({ queryKey: ["delivery-renewal",aid] });    // M23
```

Each fetch degrades independently — a missing M27 signals payload doesn't break the Plays card.

Every output `useMemo`'d (`signals`, `plays`, `cps`, `mets`, `acts`) so downstream `useMemo` dependency arrays stay stable.

### Priority cascade

```ts
function computePriorities({ account, cps, mets, dr, dtr }): Priority[] {
  const out: Priority[] = [];
  const entryDone = account.gate_signed || account.cs_entry_type === "B";

  if (!entryDone)              out.push({ key: "entry",      ... });
  if (overdueCpExists)         out.push({ key: "cp_overdue", ... });
  if (heldNotSignedOff)        out.push({ key: "cp_signoff", ... });
  if (dr?.expand_paused)       out.push({ key: "redflag",    ... });
  if (metricsButNoValueLogged) out.push({ key: "no_value",   ... });
  if (cps.length === 0)        out.push({ key: "no_cps",     ... });

  return out;  // First one wins.
}
```

### `computeThisWeek`

Direct port of prototype `generateThisWeekActions`. Produces an ordered list (max 5):
- Up to 2 critical signals
- Renewal proximity ≤ 90d
- Up to 2 plays with prob ≥ 60
- Stale-metric calls (last update > 30d)
- Fallback "All on track"

### Routes

```tsx
// App.tsx (relevant excerpts)
<Route path="overview" element={<HomeTab />} />
<Route path="home" element={<Navigate to="../overview" replace />} />
<Route path="contacts" element={<ContactsTab />} />  {/* no nav entry */}
<Route path="value-def" element={<Navigate to="../account-kit/solutioning" replace />} />
```

`OverviewTab` is no longer imported (file kept for any back-compat callers; can be deleted in a follow-up).

---

## M33 — Account-header trio

### Period state

```ts
type AccountPeriod = "30d" | "90d" | "FY";
const PERIODS: AccountPeriod[] = ["30d", "90d", "FY"];
const PERIOD_KEY = "awb:account-period";

const [period, setPeriodState] = useState<AccountPeriod>(() => {
  if (typeof window === "undefined") return "90d";
  const v = window.localStorage.getItem(PERIOD_KEY);
  return v === "30d" || v === "90d" || v === "FY" ? v : "90d";
});

const setPeriod = (p: AccountPeriod) => {
  setPeriodState(p);
  try { window.localStorage.setItem(PERIOD_KEY, p); } catch {}
};

// Multi-tab sync via storage event
useEffect(() => {
  const onStorage = (e: StorageEvent) => {
    if (e.key === PERIOD_KEY && PERIODS.includes(e.newValue as AccountPeriod)) {
      setPeriodState(e.newValue as AccountPeriod);
    }
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}, []);
```

### Outlet context

```ts
interface AccountOutletContext {
  account: AccountDetail;
  period: AccountPeriod;
  setPeriod: (p: AccountPeriod) => void;
}

export function useAccountFromLayout(): AccountDetail {
  return useOutletContext<AccountOutletContext>().account;
}

export function useAccountPeriod() {
  const ctx = useOutletContext<AccountOutletContext>();
  return { period: ctx.period, setPeriod: ctx.setPeriod };
}
```

### Appetite query

Fetched once at the layout so the mode pill is consistent across navigation:

```ts
const apptQ = useQuery<Appetite>({
  queryKey: ["appetite", accountId],
  queryFn: () => api.get<Appetite>(`/api/v1/accounts/${accountId}/appetite-score`),
});
```

Shared cache entry with `AccountPlanTab` (same queryKey). Invalidated by M27 push-as-signal mutations.

### Period scaling — Option A

`AnalyticsTab`:

```ts
function periodScale(p: AccountPeriod): number {
  return p === "30d" ? 1 / 3 : p === "FY" ? 4 : 1;
}
const scaleInt = (v: number, s: number) => Math.round(v * s);

// Each section multiplies its display numbers:
const totalQ = scaleInt(abi.total_queries, scale);
const sd = scaleInt(data.modules.sd, scale);
// etc.
```

The Usage section additionally slices the 12-month series:

```ts
const monthsToShow = period === "30d" ? 1 : period === "90d" ? 3 : 12;
const months = u.months.slice(Math.max(0, len - monthsToShow));
```

---

## Why no backend changes

- Home: every block is a derived view of M19–M28 data. Running 7 parallel queries via TanStack Query is faster on cold tab + degrades gracefully when any one fetch errors. A dedicated `/home-summary` endpoint would be a duplication.
- Trio: period selector is UI-only state; health is `account.health_score` (already on `AccountDetail`); mode is `GET /appetite-score` (M26 endpoint, already exists).

The architectural payoff: when the v1.1 ETL writes real `platform_intel` and the time-series telemetry pipeline lands, Option B (server-side period scaling) will be a backend change to `GET /platform-intel?period=30d` with the same JSON shape, and the only frontend update needed is to remove the client-side `scaleInt()` calls. The selector, the badge, the mode pill, and Home all stay identical.

---

## Tests

Both M32 and M33 are frontend-only and don't add new backend tests. The existing `test_platform_intel.py` (6 cases), `test_plays.py` (8 cases), `test_signals.py` (7 cases), `test_delivery_renewal.py` (6 cases) — all green — exercise the endpoints HomeTab consumes.

---

## Calculation Reference (single source of truth)

### Header trio (M33)

| Element | Formula | Source |
|---|---|---|
| **Period selector** | localStorage `awb:account-period` ∈ {30d, 90d, FY}; default 90d | `useAccountPeriod` hook syncs across tabs via `storage` event |
| **Health badge** | `accounts.health_score ?? 0` → band: `>=70 green Healthy`, `>=40 amber At Risk`, else `red Critical` | `accounts.health_score` (stored 0..100) |
| **Mode pill** | `appetite.current_mode` (override or recommended) | `GET /appetite-score` — see [M26 calc reference](../M26-27-growth-pipeline/TECHNICAL.md) |

### Header subtitle line (27-May Row 64 + 65)

```
{industry} · {country} · [CSM: <name> | Sales: <name> | Unassigned]
```

Fallback order:
- `account.csm_full_name` if set
- else `account.co_full_name` (Commercial Owner = sales lead)
- else italic `Unassigned`

Pills next to account name:
- Emerald: `account.account_type` (e.g. GROWTH)
- Violet: `Tier {account.tier}` (e.g. TIER T1)

### Priority cascade (M32)

`computePriorities(args)` runs **in order** — first match wins. Returns the highest-priority surface:

| Order | Condition | Surface |
|---|---|---|
| 1 | `cs_entry_type === null` | "Set CS entry type" |
| 2 | `overdueCp > 0` (M21 checkpoints) | "N overdue checkpoint(s)" |
| 3 | `cps.some(c => c.status === "held" && !c.signed_off_snapshot)` | "Sign off held checkpoints" |
| 4 | `red_flags.any(unresolved)` (M23) | "Resolve red flags" |
| 5 | `successMetrics.length === 0` | "Define success metrics" |
| 6 | `checkpoints.length === 0` | "Schedule checkpoints" |
| else | — | no priority card shown |

### Red Flag banner (27-May Row 66)

Renders ONLY when `dr.red_flags.filter(f => !f.resolved_at).length > 0`. Lists up to 3 flags with `type` + `note`; "+ N more" link when there are 4+. Deep-links to `/success-management/delivery-renewal`.

### Risk % tile (27-May Row 66 — conditional)

```js
const riskPct = active.length === 0
  ? 0
  : Math.round(riskCount / active.length * 100);

if (active.length > 0 && riskCount > 0) {
  // Render Risk % tile with colour:
  //   >=50 red, >=25 amber, else green
} else {
  // Render a neutral "Signals" tile in its slot
}
```

### `computeThisWeek` algorithm

Returns up to 8 items combined from 4 sources, deduped by stable key:

| Source | Key pattern | Condition | Priority |
|---|---|---|---|
| Critical signals | `sig:<id>` | `status === "active" AND impact === "critical"` | high |
| Renewal proximity | `renewal` | `days_to_renewal <= 90` | high if ≤30d, medium if ≤60d, low otherwise |
| High-prob plays | `play:<id>` | `!hidden AND prob >= 60` | high if ≥80, medium otherwise |
| Stale metrics | `metric:<id>` | `current_value` empty AND created `>= 14 days ago` | medium |

### This Week tick-off (27-May Row 70)

Per-account localStorage: `awb:home:this-week:<accountId>` → `JSON Set<string>` of completed item keys.

```ts
const toggle = (key: string) => {
  setDone((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    localStorage.setItem(storageKey, JSON.stringify(Array.from(next)));
    return next;
  });
};
```

Stable keys (`sig:<id>`, `renewal`, `play:<id>`, `metric:<id>`) survive reload + filter recompute until the item naturally falls off the computed list.

### ACV & Health combined tile (27-May Row 68)

Single blue tile (`bg-blue-50 border-2 border-blue-300`) with side-by-side numbers:

```
┌────────────────────────────────────────────┐
│ ACV & HEALTH                               │
│ ${currentACV}      {health/—}              │
│ Current ACV        Health (coloured)       │
│ ─────────────────────────────────────      │
│ Target ${target}   Gap ${gap}              │
│ Product ${productScore}%                   │
└────────────────────────────────────────────┘
```

Health colour: `>=70 emerald`, `>=40 amber`, else `red`.

### Account Pulse simplification (27-May Row 69)

After simplification:

| Tile | Formula |
|---|---|
| **Adoption** | `round(modules.length / TOTAL_BEROE_MODULES × 100)` (8 modules) |
| **Modules** | `${modules.length}/${TOTAL_BEROE_MODULES}` |
| **Depth / User** | `gate_subscribers` (raw string) |
| **Metrics on-track** | `${greenMetrics}/${totalMetrics} (${metricsHealth}%)` where `metricsHealth = round(green/total × 100)` |

Tier removed (now lives on the header — Row 65).

Below the 4 tiles: full list of metrics inline (cap 8, "+N more" link).

### Period scaling (M33, Option A)

Pure-frontend client-side multiplier:

| Period | Multiplier |
|---|---|
| 30d | 1/3 ≈ 0.333 |
| 90d | 1.0 (baseline) |
| FY | 4.0 |

Applied per-analytics-section in [M29-31](../M29-31-intelligence-reports/TECHNICAL.md). Option B (server-side period-scoped queries) lands when the ETL pipeline ships.

### Where to change these values

| To change | Edit |
|---|---|
| Health band cutoffs (70 / 40) | `HealthBadge` in [`AccountProfileLayout.tsx`](../../../apps/web/src/routes/accounts/AccountProfileLayout.tsx) |
| Priority cascade order | `computePriorities` in [`HomeTab.tsx`](../../../apps/web/src/routes/accounts/tabs/HomeTab.tsx) |
| This Week thresholds (60% prob, 14-day stale) | `computeThisWeek` in same file |
| Risk % bands (>=50, >=25) | inline in HomeTab KPI grid |
| Period scale multipliers (1/3, 1, 4) | `periodScale` helper in `AnalyticsTab.tsx` |
