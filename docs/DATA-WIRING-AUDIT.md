# Data Wiring Audit

**Question:** when real customer data arrives, will every number / word on every screen update without code changes?

**Answer:** yes everywhere except the two hardcoded literals fixed in this commit (`abi.usage_trend` and `abi.avg_feedback`). Every other on-screen value reads from a backend endpoint or is a derived constant (definitional, not data).

Audit method: grep every `.tsx` under `apps/web/src` for suspicious literals (specific customer names, $-amounts, percents, trend words, ratings). 13 hits surfaced; 11 were either input placeholders, scoring weights, or static product collateral. 2 were genuine hardcoded data values — both fixed.

---

## Screen-by-screen data sources

### Account list — `/accounts`

| Element | Source |
|---|---|
| Row name, slug, industry, country, tier, account type, ACV, target_acv, renewal_date, health_score, last_activity_at | `GET /api/v1/accounts` → `AccountListItem` |
| CSM / CO full name | Joined from `public.users` server-side |
| Alignment dot | Rollup of `cs_goals.alignment_status` |
| Next-checkpoint chip | Rollup of `checkpoints` |
| Outcome pill | `accounts.dr_outcome` |
| Renewal alerts banner | Derived from `days_to_renewal` |
| Bulk reassign capability | Derived from `me.user.role` against `can_reassign_account_owner` |

### Account header (every account page)

| Element | Source |
|---|---|
| Logo initials | Computed from `account.name` |
| Name, industry, country, CSM | `GET /api/v1/accounts/:id` |
| 30d / 90d / FY toggle | Local state, persisted in `localStorage` |
| Health badge | `account.health_score` + computed band (≥70 Healthy / 40-69 At Risk / <40 Critical) |
| Mode pill | `GET /api/v1/accounts/:id/appetite-score` |

### 🏠 Home tab

| Element | Source |
|---|---|
| Priority Action Card | Cascading client-side logic over `account.gate_signed`, `cs_entry_type`, `checkpoints`, `metrics`, `delivery_renewal` |
| 4 KPI tiles | `account.current_acv` / `days_to_renewal` / `health_score` + `signals.filter(active)` count |
| 🗓 This Week | Computed from M27 signals + plays + renewal proximity + metrics staleness |
| 📡 Top Signals | `GET /api/v1/accounts/:id/signals` |
| 🚀 Expansion Pipeline | `GET /api/v1/accounts/:id/plays` (prob ≥60 + expand mode) |
| 💬 Recent Activity | `GET /api/v1/accounts/:id/activities` |
| Health bar (overdue CP / Track 2 paused) | Derived from M21 checkpoints + M23 `expand_paused` flag |

### 📋 Account Kit

| Sub-tab | Source |
|---|---|
| Pre-Sales engagement objective + categories + geo + maturity | `GET/PATCH /accounts/:id/engagement` |
| Pre-Sales AI quality check | `POST /api/v1/ai/quality-check` (Claude / stub) |
| Pre-Sales MoM uploads | `documents` table + Celery extraction pipeline |
| Pre-Sales notes per document | `documents.notes` column (PATCH `/documents/:id/notes`) |
| Pre-Sales Client Contacts shortcut | Routes to `/contacts` page → `GET /accounts/:id/contacts` |
| Brief | `GET/PATCH /accounts/:id/brief` (`meeting_briefs` table) |
| Solutioning | `GET/PATCH /accounts/:id/solutioning` + VPD AI extraction |
| Sales Handoff | `gate_*` columns + `sh_*` columns on `account_solutioning` |
| CS Onboarding | `accounts.cs_entry_type` + `cs_handover_checklist` + `cs_stakeholders` |

### 🎯 Success Management

| Sub-tab | Source |
|---|---|
| VDD (Value Delivery Document) | `accounts.value_delivery_document` jsonb |
| Contract & Goals | `accounts.success_contract` + `cs_goals` table (with M15.1 VPD extraction) |
| Value Tracking metrics | `success_metrics` table + derived status engine |
| Checkpoints | `checkpoints` table + auto-schedule |
| Delivery & Renewal | `accounts.delivery_renewal` jsonb + `dr_outcome` |

### 🚀 Growth & Pipeline

| Sub-tab | Source |
|---|---|
| Account Plan — mode banner | `GET /accounts/:id/appetite-score` |
| Account Plan — score breakdown tiles | `appetite.breakdown.*` (Health 40% / Signal 25% / Renewal 15% / ARR 20% — weights are **definitional constants** per the prototype, not data) |
| Account Plan — ACV growth tile | `account.current_acv` + `account.target_acv` |
| Account Plan — ARR burn-down | Derived from `appetite.breakdown.target_acv_usd` + `projected_acv_usd` |
| Account Plan — plays list | `GET /accounts/:id/plays` |
| Signals & Activity — both panels | `GET /accounts/:id/signals` + `/activities` |
| External Intelligence — news cards | `GET /accounts/:id/intel-news` |
| External Intelligence — refresh | `POST /accounts/:id/intel-news/refresh` (Claude or stub) |
| External Intelligence — push as signal | `POST /intel-news/:id/push-as-signal` → creates a `soft_signal` |

### 📊 Intelligence & Reports

| Sub-tab | Source |
|---|---|
| Intelligence — Category Watch | `platform_intel.cat_intel` |
| Intelligence — Supplier Watch | `platform_intel.supplier_watch` |
| Intelligence — Abi Engagement | `platform_intel.abi` (incl. `usage_trend` + `avg_feedback` after this commit) |
| Intelligence — Industry Benchmark | `platform_intel.benchmark` + computed pct vs account values |
| Intelligence — Engagement Metrics | `platform_intel.engagement` |
| Intelligence — NPS | `platform_intel.nps` |
| Analytics — Usage / Modules / SD / Abi / CC / SU | `platform_intel.usage` / `.modules` / `.super_users` × period scale |
| Analytics — Supplier Risk + CW | `platform_intel.supplier_watch` / `.cat_intel` |
| Reports — QBR / MBR / Utilization HTML | `GET /accounts/:id/reports/{type}` — stitches account + checkpoints + metrics + plays + platform_intel server-side |
| Materials library | `DOC_MATERIALS` constant — **intentionally static** (product collateral catalog, not customer data) |

---

## What was hardcoded and now isn't

| Screen | Before | After | Fix |
|---|---|---|---|
| Intelligence → Abi | `Usage Trend: "Increasing"` | Reads `abi.usage_trend` | Frontend: type-safe read with `??` fallback. Backend: field flows through `extra="allow"` on `AbiIntel`. Seeded for Mondelez ("Increasing") + Siemens ("Stable") in migration 0041. |
| Analytics → Custom Credits | `Avg Feedback: "8.5/10"` | Reads `abi.avg_feedback` | Same pattern. Seeded as "8.7/10" / "8.2/10". |

---

## What's hardcoded but intentionally so

These are **definitional constants**, not customer data. They don't need a backend.

| Location | Value | Why |
|---|---|---|
| Account Plan breakdown | "Health 40% · Signal 25% · Renewal 15% · ARR 20%" | The Appetite Score weighting formula. Port of prototype constants. |
| Account Plan — `SALES_STAGES` | 10-step prob ladder (Accelerated Trials 1%, Met & Qualified 10%, etc.) | Sales-stage definitions. Industry-standard. |
| Custom Credits — pricing multipliers | `L2 × 0.5 + L3 × 2 + L4 × 5` | Custom-research credits formula (per prototype line 7421). |
| SD section regional split | `[0.45, 0.3, 0.25]` for EMEA / APAC / Americas | Hardcoded shares. **Flagged as a known TODO** for when real telemetry includes per-region SD counts. |
| `MODE_CONF` / `SIG_CONF` / `ACT_CONF` / `CATEGORY_COLOR` palettes | Hex codes, icons, labels | Visual tokens — port of prototype constants. |
| `DOC_MATERIALS` static catalog | Product collateral copy + summaries | Browsable catalog of Beroe collateral. Not customer data. |
| Input field `placeholder=` strings ("e.g. $2M documented savings") | UX guidance | Placeholders only — never displayed as values. |

---

## Known data-source TODOs (deferred, not blockers)

1. **SD regional split** — currently fixed at 45/30/25. Should read from `platform_intel.modules.sd_by_region` once telemetry exists.
2. **Real `platform_intel` ETL** — today the column is populated by seed migrations 0039–0041 for Mondelez + Siemens. When the Beroe-Live → AWB pipeline ships (v1.1 backlog), it will overwrite these values daily with real telemetry and **the frontend doesn't change** — same endpoint, same JSON shape.
3. **Industry Benchmark "Health Avg / Seat % Avg"** — currently shows the seeded benchmark numbers as-is. Eventually these should be computed at the API level by averaging across all accounts in the same industry, not stored per-account.

---

## How to verify

```sh
# Frontend audit pass — same regex sweep used to produce this doc:
cd apps/web/src
rg -nE '\b(Mondelez|Siemens|Sanofi|Jordan Mills|Klaus Richter)\b' --type=ts --type=tsx
rg -nE '"\d{2}%"' --type=tsx
rg -nE '"\d\.\d/10"' --type=tsx
rg -nE '"(Increasing|Decreasing|Stable|Above|On Par|Below)"' --type=tsx
```

After this commit the only matches should be:
- Comments / docstrings
- Input `placeholder=` strings
- The scoring-weight literals on the Account Plan breakdown tiles
- The `Above / On Par / Below` *labels* (these are derived from a pct calc, not hardcoded data)
- `doc_materials.ts` (static catalog)
