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
