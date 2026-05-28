# M29–M31 — Intelligence & Reports — Technical

## Migrations

| File | What it adds |
|---|---|
| `0039_platform_intel.sql` | `accounts.platform_intel jsonb` + jsonb-object CHECK + seed for Mondelez + Siemens (6 sections: cat_intel · supplier_watch · abi · benchmark · engagement · nps) |
| `0040_platform_intel_analytics.sql` | Extends the seed with 3 more keys (usage · modules · super_users) |
| `0041_platform_intel_telemetry_fields.sql` | Backfills `abi.usage_trend` + `abi.avg_feedback` via `jsonb_set` |

Single jsonb column — same pattern as M19 / M22 / M23. Section-level updates via PATCH; the route does a shallow merge with `None` popping the key (mirrors success_contract pattern).

## Schemas — `app/schemas/platform_intel.py`

Nine top-level keys, each with its own Pydantic model:
- `CatIntel` (SectionAvg + CatHeat[] + CatInsight[])
- `SupplierWatch` (SupplierByRisk + TrackedSupplier[])
- `AbiIntel` (AbiComplexityMix + top_types[])
- `BenchmarkAvgs`
- `EngagementIntel` (+ UserSegmentation)
- `NpsIntel` (+ VocItem[])
- `UsageIntel` (12-month series + adoption breakdown)
- `ModulesIntel` (+ ModulesMonthly)
- `SuperUser[]`

`model_config = ConfigDict(extra="allow")` on every model so prototype evolution (new fields per category, additional supplier risk tiers, telemetry-side `abi.usage_trend`/`avg_feedback`) flows through without DDL.

The container `PlatformIntelOut` has a derived `has_data` flag — true when any sub-section is non-empty.

## Routes — `app/routes/platform_intel.py`

```
GET   /accounts/:id/platform-intel
PATCH /accounts/:id/platform-intel
```

PATCH applies section-level replace (sending `nps: {...}` overwrites the whole nps section, not deep-merge). Sending `null` pops the key entirely. Same idempotent-reset semantics as M19 / M22 / M23.

## Reports service — `app/services/reports.py`

Three pure functions, no DB writes:

```py
def generate_qbr_html(*, account, checkpoints, metrics, plays) -> str
def generate_mbr_html(*, account, checkpoints, metrics) -> str
def generate_utilization_html(*, account, super_users) -> str
```

Each returns a self-contained inline-styled HTML document. The frontend iframes the result + offers Blob-URL download. No template engine — small enough to keep as Python string concatenation; v1.1 PPT/PDF will need `python-pptx` and `reportlab`.

## Reports routes — `app/routes/reports.py`

```
GET /accounts/:id/reports/qbr           → { html, filename, type }
GET /accounts/:id/reports/mbr           → { html, filename, type }
GET /accounts/:id/reports/utilization   → { html, filename, type }
```

View-gated on `can_view_account`. Each route loads its dependencies in parallel then calls the generator.

## Frontend

```
apps/web/src/routes/accounts/
├── IntelReportsLayout.tsx                 # cyan sub-tab strip + outlet
└── tabs/ir/
    ├── _IRStub.tsx                        # stub renderer (was used pre-M30/M31)
    ├── IntelligenceTab.tsx                # M29 — ~500 lines, 6 sub-tabs
    ├── AnalyticsTab.tsx                   # M30 — 8 sub-tabs + Numbers/Charts + period scaling (~900 lines)
    └── DocumentsReportsTab.tsx            # M31 — report cards + materials library

apps/web/src/types/
├── platform_intel.ts                      # Full type mirror + HEAT_ICON/HEAT_COLOR/RISK_COLOR
└── doc_materials.ts                       # Static collateral catalog (6 groups × 3-5 items)
```

### Analytics inline-SVG renderers

Zero-dependency renderers:
- `LineChart` — single series, with area fill + dot markers + y-axis labels
- `MultiLineChart` — series array with inline legend
- `BarChart` — labelled horizontal bars
- `DonutChart` — slice angles + centre total + side-legend

### Period scaling

`AnalyticsTab` reads `useAccountPeriod()` from outlet context:

```ts
function periodScale(p: AccountPeriod): number {
  return p === "30d" ? 1 / 3 : p === "FY" ? 4 : 1;
}
const scaleInt = (v: number, s: number) => Math.round(v * s);
```

Applied per-section; rendering banner at top names the current window.

## Tests

### `test_platform_intel.py` (6 cases — all green)

| Test | Asserts |
|---|---|
| `test_get_returns_seeded_data_for_mondelez` | All 9 sections populated; M30 fields present (12-month series, super_users) |
| `test_get_returns_empty_state_for_unseeded_account` | Sanofi (no seed) returns `has_data: false` |
| `test_patch_replaces_single_section` | nps section round-trip; other sections untouched |
| `test_patch_then_clear_section_via_null` | `null` pops the key |
| `test_solutioning_manager_can_view_not_write` | sol_mgr GET 200 + is_editable false + PATCH 403 |
| `test_csm_on_own_account_can_patch` | CSM-on-own happy path |

### `test_reports.py` (4 cases — all green)

| Test | Asserts |
|---|---|
| `test_qbr_renders_for_seeded_account` | All 8 QBR sections in the HTML + Mondelez seed data present |
| `test_mbr_renders_with_metrics_and_checkpoints` | MBR section headers present |
| `test_utilization_renders_with_super_users` | "Jordan Mills" (super-user seed) renders in the table |
| `test_reports_403_for_unrelated_role` | sol_mgr view-only allowed (matrix Q3 — they can read any account) |

## Pydantic gotcha — `date` field name

`VocItem` (under NPS) had a `date: date | None` field which shadowed the imported `date` class at Pydantic build time. Fix: alias `from datetime import date as _date` so the type reference `_date | None` doesn't collide with the field name.

```py
from datetime import date as _date

class VocItem(BaseModel):
    quote: str
    ...
    date: _date | None = None
```

## Route `response_class=None` gotcha

Initial `@router.get("...", response_class=None)` raised `'NoneType' object is not callable` at route registration time. Drop the kwarg — FastAPI picks the default JSONResponse class.

---

## Calculation Reference (single source of truth)

### Reports — server-side HTML generators

All reports use plain Python string concatenation (no Jinja). Generated on-demand; no DB persistence. User saves as PDF via browser Print → Save.

| Report | Endpoint | Generator | Sections |
|---|---|---|---|
| **QBR** | `GET /accounts/:id/reports/qbr` | `services/reports.py::generate_qbr_html` | 8 sections: Engagement scope · Usage analysis · Category trends · Abi usage · Success metrics · Checkpoint cadence · Industry benchmark · Expansion pipeline |
| **MBR** | `GET /accounts/:id/reports/mbr` | `generate_mbr_html` | Monthly snapshot: usage highlights · open checkpoints · top metrics · action items |
| **Utilization** | `GET /accounts/:id/reports/utilization` | `generate_utilization_html` | Adoption tile + module-wise usage + super-users table |
| **VDD** | `GET /accounts/:id/reports/vdd` | `generate_vdd_html` (27-May Row 53) | Single-page locked-or-draft report: 3-bucket totals + 4 sections + executive summary |

All filename pattern: `${account.slug}-${type}-${date}.html`.

### Status banding in QBR/MBR HTML

QBR + MBR colour metric rows by `derive_status` output (same logic as M20). Adoption tile uses:
- `adoption >= 70%` → green
- `adoption >= 40%` → amber
- else → red

### Period scaling (Analytics — Option A)

`AnalyticsTab.tsx::periodScale(period)`:

```ts
function periodScale(period: Period): number {
  return period === "30d" ? 1/3
       : period === "90d" ? 1
       : 4;  // "FY"
}
```

Applied per-section:

| Section | Behaviour |
|---|---|
| Usage & Logins | Slices last 1/3/12 months from the 12-month series |
| Module Activity | Per-period totals × scale |
| Category Watch | Per-period totals × scale |
| Abi Intelligence | Per-period totals × scale |
| Supplier Discovery | Proportions unchanged (already share-of-X) |
| Supplier Risk | Proportions unchanged |
| Custom Credits | Per-period totals × scale |
| Super Users | Always-current (no scaling) |
| 12-month trend chart | Always full year — period only affects the totals tile |

**Why client-side?** Backend doesn't have time-series telemetry yet (`platform_intel` carries 90d-baseline + 12-month series as static JSON). Option B (server-side `?period=` filtering) lands when the ETL pipeline ships.

### Inline-SVG renderers (no Chart.js)

Zero external dependency. 4 chart kinds:

| Component | Use |
|---|---|
| `LineChart` | Single-series 12-month trends |
| `MultiLineChart` | Per-module monthly trends (Module Activity sub-tab) |
| `BarChart` | Per-period totals |
| `DonutChart` | Adoption %, supplier-risk mix; centre label shows total |

All SVGs rendered with hand-rolled `<polyline>` / `<path>` / `<circle>` — viewBox-based for responsive sizing.

### `platform_intel` jsonb structure (one column, 6 sections + 3 telemetry)

`accounts.platform_intel` carries the whole snapshot per account. Single-jsonb pattern (same as M19/M22/M23):

```jsonc
{
  "cat_intel":       { "top_cats": [...], "section_avg_times": {...}, "insights": [...] },
  "supplier_watch":  { "risk_tiers": {...}, "tracked_suppliers": [...] },
  "abi":             { "complexity_mix": {...}, "top_types": [...], "usage_trend": "...", "avg_feedback": "..." },
  "benchmark":       { "compared_against": [...] },
  "engagement":      { "channel_kpis": {...}, "user_breakdown": {...} },
  "nps":             { "score": 42, "voc_quotes": [...] },
  "usage":           { "12_month": [...], "active_users": ..., "adoption": ... },
  "modules":         { "period_totals": {...}, "12_month_per_module": {...} },
  "super_users":     [{ "name": ..., "role": ..., "logins_30d": ... }, ...]
}
```

Schema: [`apps/api/app/schemas/platform_intel.py`](../../../apps/api/app/schemas/platform_intel.py). `extra="allow"` everywhere so new telemetry fields land without DDL churn.

### Section-level update semantics

`PATCH /accounts/:id/platform-intel` accepts a partial payload:

| Payload | Effect |
|---|---|
| `{ "cat_intel": { ... } }` | Replaces `cat_intel` wholesale; other sections untouched |
| `{ "cat_intel": null }` | Pops the `cat_intel` key from the jsonb |
| `{}` | No-op |

### Where to change these values

| To change | Edit |
|---|---|
| Adoption tile bands (70/40) | `generate_utilization_html` in [`reports.py`](../../../apps/api/app/services/reports.py) |
| Period scale multipliers | `periodScale` in `AnalyticsTab.tsx` |
| QBR section list / order | `generate_qbr_html` template |
| VDD report layout | `generate_vdd_html` template |
| `platform_intel` schema | [`schemas/platform_intel.py`](../../../apps/api/app/schemas/platform_intel.py) — Pydantic with `extra="allow"` |
