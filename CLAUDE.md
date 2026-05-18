# Beroe AWB — Build Log

> Living context for any Claude Code session. Updated at the end of every milestone. Source of truth for "what's built, what's next, what we decided."

---

## Project at a glance

- **Repo:** beroe-awb (monorepo)
- **Hosts:** Frontend → Vercel · Backend → Render · DB/Auth/Storage → Supabase
- **Tech:** React + Vite + TS + Tailwind + shadcn/ui (web) · FastAPI + Python 3.11 + SQLAlchemy + Pydantic v2 (api) · Supabase Postgres + RLS · Anthropic Claude · Celery + Redis
- **Sprint scope (frozen):** F01 (Auth), F02 (RBAC), AK01 (Account List), AK02 (Account Profile shell), AK03 (Pre-Sales & Solutioning: Engagement Info + Client Contacts + Documents)
- **Build plan:** `~/.claude/plans/i-want-to-build-memoized-pie.md`
- **Source of truth — BRD:** `/Users/anandkaliappan/Desktop/Beroe/BRD/Account_Kit_Requirements_Reviewed_05072026.docx`
- **Source of truth — Roles & Access:** `/Users/anandkaliappan/Desktop/Beroe/BRD/Roles_Access_Matrix_Reviewed_05072026.xlsx` (overrides BRD §3.2 narrative when they conflict)
- **Source of truth — Tech stack:** `/Users/anandkaliappan/Desktop/Beroe/BRD/Tech_Stack_and_Environment__Reviewed_05072026.docx`
- **Visual reference:** `prototype/beroe_awb_v20.html` (read-only — DO NOT modify)

---

## Conventions

### Code style
- **Python:** ruff (formatter + linter). Line length 100. Type hints required.
- **TypeScript:** prettier + eslint with `@typescript-eslint`. Strict mode on. No `any` without comment justification.
- **Imports:** absolute paths via `@/` alias (web) and full module paths (api).
- **No comments** unless explaining a non-obvious WHY (constraint, invariant, workaround).

### Branch & commit
- Branches: `feat/M<n>-<short>`, `fix/<short>`, `docs/<short>`, `chore/<short>`.
- Commits: Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`). One logical change per commit.
- PRs require: ✅ CI green, ✅ FUNCTIONAL.md + TECHNICAL.md updated, ✅ OWASP checklist signed off.

### Local dev
```bash
pnpm install
pnpm docker:up    # Postgres + Redis (local)
pnpm dev          # web + api + worker
```

### Adding a feature
1. Create branch `feat/<id>-<short>`.
2. Create folder `docs/features/<id>/` with empty `FUNCTIONAL.md` + `TECHNICAL.md`.
3. Build feature.
4. Fill both docs.
5. Tick OWASP checklist.
6. Open PR; reference BRD section number in description.
7. Update CLAUDE.md (move from 🚧 to ✅, log decisions).

---

## Architecture summary

Two-app monorepo with a shared types package. Frontend uses Supabase JS client only for auth (obtaining JWT) and direct Storage URLs; all business logic goes through FastAPI. FastAPI verifies JWT (HS256, no DB hop), enforces RBAC via decorator + RLS at DB level (defense-in-depth). Long-running AI tasks dispatched to Celery workers (Redis-backed). Audit log written automatically by SQLAlchemy event listeners on every UPDATE/DELETE.

See [`docs/architecture/overview.md`](./docs/architecture/overview.md) for the diagram + data flow.

---

## Current state

### ✅ Built
- **Data-wiring audit + 2 hardcode fixes (2026-05-18)** ([DOC](./docs/DATA-WIRING-AUDIT.md))
  - Audit pass over every `.tsx` under `apps/web/src` to verify every displayed number/word is backend-driven.
  - 13 grep hits surfaced; 11 turned out to be input placeholders / scoring-weight constants / static product collateral. 2 were genuine hardcoded data values — both fixed.
  - **Fix 1** — IntelligenceTab Abi sub-tab `"Usage Trend": "Increasing"` literal → now reads `abi.usage_trend` (carried via `extra="allow"` on `AbiIntel`).
  - **Fix 2** — AnalyticsTab Custom Credits `"Avg Feedback": "8.5/10"` literal → now reads `abi.avg_feedback`.
  - Migration `0041_platform_intel_telemetry_fields.sql` backfills both fields via `jsonb_set` on the existing Mondelez + Siemens seeds so the demo accounts still show non-empty values.
  - Doc lays out per-screen data sources (account list, header trio, Home, Account Kit, Success Mgmt, Growth & Pipeline, Intelligence & Reports) + distinguishes hardcoded-data (now zero) from definitional constants (Appetite weights, SALES_STAGES ladder, MODE_CONF palette, DOC_MATERIALS catalog) + tracks deferred ETL TODOs.

- **M33 — Account-header trio matches prototype (2026-05-18)** ([FUNC](./docs/features/M32-33-home-and-header/FUNCTIONAL.md) · [TECH](./docs/features/M32-33-home-and-header/TECHNICAL.md))
  - Verified at `prototype/beroe_awb_v20.html` line 2807-2812: every account header carries a 3-piece trio in the top-right — period selector + health badge + mode pill.
  - Replaced our old 5-card KPI strip (ACV / Renewal / Health / Tier / Category) with the prototype trio: `PeriodBar` (30d / 90d / FY pill group) + `HealthBadge` (score + Healthy / At Risk / Critical band) + `ModePill` (M26 Appetite mode with icon + colour). The displaced ACV/Renewal KPIs now live on the Home tab as the 4 KPI tiles.
  - Period state defaults to 90d, persists in `localStorage` under `awb:account-period`, syncs across tabs via the `storage` event.
  - New `useAccountPeriod()` hook on the outlet context so leaf tabs can read the selector.
  - Mode pill fed by `GET /api/v1/accounts/:id/appetite-score` at layout level — render stays consistent across every sub-tab.
  - **Period scaling wired into Analytics (Option A)** — `periodScale(period)` matches prototype `periodScale()` exactly: 30d → 1/3 · 90d → 1 · FY → 4. Per-section behaviour: Usage slices last 1/3/12 months · Modules/Abi/SD/CC/SuperUsers totals × scale · Supplier Risk + complexity-mix proportions unchanged · 12-month trend chart still shows the full year. Backend untouched; Option B (server-side period-scoped queries) deferred to v1.1 when the platform_intel ETL ships.

- **M32 — Home tab (replaces Overview) + nav consolidation (2026-05-18)** ([FUNC](./docs/features/M32-33-home-and-header/FUNCTIONAL.md) · [TECH](./docs/features/M32-33-home-and-header/TECHNICAL.md))
  - Prototype line 2784 confirms exactly 5 top-level account tabs: 🏠 Home · 📋 Account Kit · 🎯 Success Management · 🚀 Growth & Pipeline · 📊 Intelligence & Reports. Contacts and Value Def are NOT top-level (Contacts is a "Client Contacts" group inside Pre-Sales at line 5874; Value Definition is inside Solutioning at line 5956).
  - `AccountProfileLayout` SUB_NAV now matches the prototype's 5 tabs. Old `/contacts` route still works (no nav entry); reachable from a new "Client Contacts → Manage Contacts" shortcut card on Pre-Sales. Old `/value-def` route redirects to `/account-kit/solutioning`.
  - New `HomeTab.tsx` (~600 lines) replaces OverviewTab at the `/overview` URL (URL preserved for back-compat). Faithful port of prototype `bHome`:
    * Header strip with mode/appetite chip
    * Priority Action Card — cascading priority: entry → overdue CP → held-no-signoff → red flag → no value → no checkpoints; CTA deep-links to the right sub-tab
    * 4 KPI tiles (ACV · Renewal · Health · Open signals)
    * 🗓 This Week — computed client-side from critical signals + ≤90d renewal + high-prob plays + stale metrics (port of prototype `generateThisWeekActions`)
    * 📡 Top Signals (M27, 3 highest-impact)
    * 🚀 Expansion Pipeline preview (M26, prob ≥60 + weighted pipeline total)
    * 💬 Recent Activity (M27 activities, latest 4)
    * Health bar — only renders when overdue CPs > 0 OR Track 2 paused
  - No backend changes — HomeTab reads from existing M19–M28 endpoints in parallel via TanStack Query.

- **M31 — Intelligence & Reports · Documents & Reports (2026-05-18)** ([FUNC](./docs/features/M29-31-intelligence-reports/FUNCTIONAL.md) · [TECH](./docs/features/M29-31-intelligence-reports/TECHNICAL.md))
  - **Backend** — `services/reports.py` with three HTML generators:
    * `generate_qbr_html` — 8 sections (engagement scope · usage analysis · category trends · Abi usage · success metrics · checkpoint cadence · industry benchmark · expansion pipeline). Reads from account + Checkpoints (M21) + SuccessMetrics (M20) + AccountPlays (M26) + platform_intel (M29/M30).
    * `generate_mbr_html` — monthly snapshot (usage highlights, open checkpoints, top metrics, action items).
    * `generate_utilization_html` — adoption tile + module-wise usage + super-users table.
  - Routes: `GET /accounts/:id/reports/{qbr|mbr|utilization}` view-gated, returns `{html, filename, type}`.
  - **Frontend** — `DocumentsReportsTab.tsx` replaces M29 stub:
    * 3 report-type cards with HTML / PPT / PDF buttons. HTML works → iframe preview + Download HTML button (Blob URL). PPT / PDF disabled with v1.1 tooltips (need python-pptx + reportlab templates).
    * Solutioning Proposals — shortcut link to Account Kit → Solutioning rather than duplicating the upload UI.
    * Available Materials library — 6 groups × 3-5 items ported verbatim from prototype `DOC_MATERIALS` into `types/doc_materials.ts`. View button → modal with summary.
  - Tests: 4 in `test_reports.py` (QBR renders 8 sections + Mondelez seed data appears, MBR sections, utilization super-users rendered, sol_mgr view-only). All green.

- **M30 — Intelligence & Reports · Analytics section (2026-05-18)** ([FUNC](./docs/features/M29-31-intelligence-reports/FUNCTIONAL.md) · [TECH](./docs/features/M29-31-intelligence-reports/TECHNICAL.md))
  - Replaces M29 stub. 8 sub-tabs faithful to prototype `bAnalytics`: Usage & Logins · Module Activity · Category Watch · Abi Intelligence · Supplier Discovery · Supplier Risk · Custom Credits · Super Users.
  - **Backend** — migration `0040_platform_intel_analytics.sql` extends `accounts.platform_intel` jsonb on Mondelez + Siemens with three new top-level keys: `usage` (12-month logins + active users + adoption), `modules` (per-period totals + 12-month monthly trend per module), `super_users` (top 5 power-user roster).
  - `schemas/platform_intel.py` gains `UsageIntel` + `ModulesIntel` + `ModulesMonthly` + `SuperUser` models; PlatformIntelOut/Update extended.
  - **Frontend** — `AnalyticsTab.tsx` with Numbers / Charts mode toggle per-section. Zero-dependency inline SVG renderers: `LineChart`, `MultiLineChart`, `BarChart`, `DonutChart` (centre-label shows total). Empty-state when `has_data: false`.
  - Numbers mode renders faithful tables; Charts mode renders the SVGs. Super Users sub-tab is table-only.
  - Tests: existing platform_intel suite extended with M30 assertions (12-month series length, module trend length, super_users count). 6/6 green.

- **M29 — Intelligence & Reports scaffold + Intelligence section (2026-05-17)** ([FUNC](./docs/features/M29-31-intelligence-reports/FUNCTIONAL.md) · [TECH](./docs/features/M29-31-intelligence-reports/TECHNICAL.md))
  - New top-level **📊 Intelligence & Reports** tab (cyan theme) in the account profile. Three-section pill nav: Intelligence (live) · Analytics (M30) · Documents & Reports (M31).
  - **Backend** — migration `0039_platform_intel.sql` adds `accounts.platform_intel jsonb` (single column carries the whole 6-section snapshot — same single-jsonb pattern as M19/M22/M23) + jsonb-object CHECK + seeded demo content for Mondelez + Siemens Energy.
  - `schemas/platform_intel.py` — 6 section models (CatIntel, SupplierWatch, AbiIntel, BenchmarkAvgs, EngagementIntel, NpsIntel) + PlatformIntelOut/Update; `extra="allow"` everywhere so the prototype's evolving fields flow through without DDL churn.
  - Routes: `GET/PATCH /accounts/:id/platform-intel` — section-level replace, `null` value pops the key.
  - **Frontend** — `IntelReportsLayout.tsx` (cyan sub-tab strip) + `IntelligenceTab.tsx` (~500 lines, faithful port of `bIntel`) with all 6 sub-tabs:
    * Category Watch — section-avg times + heat list (🔥/🤝/⭐/❄) + insights with ok/warn/red tones
    * Supplier Watch — 5 risk-tier KPI tiles + tracked-suppliers table
    * Abi Engagement — 5 KPIs + complexity-mix bars + top types + insight callout
    * Industry Benchmark — 3-up comparison cards with Above/On Par/Below pill
    * Engagement Metrics — 5 channel KPIs + 7-segment user breakdown
    * NPS — score with Promoter/Passive/Detractor label + VoC quotes with sentiment-coloured left border
  - Tests: 6 in `test_platform_intel.py` (seeded GET, empty-state, section replace, null clears section, sol_mgr view-only, CSM-on-own can patch). All green.

- **M28 — Growth & Pipeline · External Intelligence (2026-05-17)** ([FUNC](./docs/features/M28-external-intelligence/FUNCTIONAL.md) · [TECH](./docs/features/M28-external-intelligence/TECHNICAL.md))
  - Replaces the M26 stub for the External Intelligence sub-tab. Faithful port of prototype `bExtIntel` + push-as-signal integration into the M27 SoftSignal flow.
  - **Backend** — migration `0038_intel_news.sql` adds `intel_news_category` enum (10 categories matching the prototype filter strip: financial_performance / supply_chain / supplier_strategy / expansion_capex / regulatory_compliance / sustainability_esg / digital_transformation / risk_geopolitical / product_innovation / m_and_a) + `intel_signal_relevance` enum + `intel_news_items` table with `signal_id` back-ref into `soft_signals`.
  - `services/intel_news.py` — `stub_generate` (deterministic 6-item set keyed on `sha256(account_name)`, spans ≥4 categories) + `_real_generate` (one Claude call, JSON-only schema, 24h cache) + `generate_intel_news` public entry with stub fallback.
  - Routes: `GET/POST /accounts/:id/intel-news`, `POST /accounts/:id/intel-news/refresh` (dedup on headline), `PATCH /intel-news/:id`, `POST /intel-news/:id/push-as-signal` (creates SoftSignal + back-link; idempotent), `DELETE /intel-news/:id` (admin-only).
  - **Push-as-signal mapping** — category → signal type (financial_performance → risk; supply_chain → critical; expansion_capex → expansion; sustainability_esg → positive; …) + relevance → impact 1:1.
  - **Frontend** — `ExternalIntelTab.tsx` (replaces M26 stub): refresh button, search input, 11-pill filter strip (All + 10 categories) with active-state coloured per category, cards with pulsing red-dot on high relevance + category pill + publication + date + AI/New chips + "→ Push as Soft Signal" button (turns into "✓ Signal created" once promoted). Pushing invalidates intel-news + signals + appetite queries so the M26 banner picks up the new signal next render.
  - Tests: 6 in `test_intel_news.py` (stub determinism + diversity, refresh+dedup, manual create+hide, push-as-signal idempotency with correct type+impact mapping, RBAC). All green.

- **Sprint-1 bug-fix pass (2026-05-17)** ([FUNC](./docs/features/SPRINT1-bugfix/FUNCTIONAL.md) · [TECH](./docs/features/SPRINT1-bugfix/TECHNICAL.md))
  - 7 bugs from `Bug_Tracker_For 1st Sprint.xlsx` (Harish, 2026-05-12) cleared in one commit (`190ac7f`).
  - **Bug 7 — Reassign owner widened** (P1, Roles): `can_reassign_account_owner` now `{admin, cs_director, vp_csm, vp_sales}` (was admin-only). Frontend `AccountListPage` swaps `isAdmin` for `canReassign` on the per-row Reassign link + the bulk-reassign affordance. Audited by the existing SQLA before_flush listener.
  - **Bug 5 — Sticky logout** (P2, Other): `AppShell` `<aside>` now `sticky top-0 h-screen self-start` so the navy sidebar is viewport-locked. Inner `<nav>` scrolls; the avatar + sign-out footer stays put on long content.
  - **Bug 4 — Contact dedup on name OR email** (P2, Contacts): `ContactFormModal` preflights case-insensitive name + email against the loaded list; Save disables with "Duplicate detected" + red banner naming the existing row. Backend `create_contact` adds a server-side name-clash check returning 409 (email was already covered by `ux_client_contacts_account_email`).
  - **Bug 2 — AI extraction non-Admin** (P1, MOM): verified `/documents/:id/extract-fields` + `/extract-goals` + `/ai/quality-check` are view-gated or auth-only, not admin-gated. The visible failure is the apply step (PATCH /engagement, POST /contacts) which is per-section write-gated; that's exposed clearly under Bug 1.
  - **Bug 3 — Per-document notes** (P1, MOM): migration `0037_documents_notes.sql` adds `documents.notes text`. `DocumentOut` + new `DocumentNotesUpdate` schema + `PATCH /documents/:id/notes` route (same write gate as the summary edit). `KindUploadCard` gains a `NotesEditor` per row — save on blur or Cmd/Ctrl+Enter, "+ Add note" link when empty, content visible read-only for non-writers.
  - **Bug 6 — Paste / CSV / MD / XLSX upload** (P1, MOM): `services/extract.py` now treats `.csv` / `.md` / `.markdown` as plain UTF-8 text. `config.allowed_doc_extensions` + `render.yaml ALLOWED_DOC_EXTENSIONS` extended. `KindUploadCard` adds a **Paste text** button that opens a textarea modal; pasted content becomes a synthetic `pasted-{kind}-{ts}.txt` `File` and flows through the regular `handleFiles` pipeline so Celery picks it up like a real upload. Excel was already supported via markitdown.
  - **Bug 1 — Role-aware upload** (P1, Roles): `KindUploadCard` reads `data.is_editable` (returned by `/accounts/:id/documents`, derived from `can_write_documents(role, kind)`). When the role can't write that kind: file input + Paste button disabled, drag-drop is a no-op, and an amber "Read-only — your role can't upload {VPDs|MoMs} on this account" badge replaces the upload prompt.

- **M27 — Growth & Pipeline · Signals & Activity (2026-05-17)** ([FUNC](./docs/features/M26-27-growth-pipeline/FUNCTIONAL.md) · [TECH](./docs/features/M26-27-growth-pipeline/TECHNICAL.md))
  - Replaces the M26 stub for the Signals & Activity sub-tab and plugs soft signals back into the Appetite Score so the Signal Mix component is live data instead of the neutral placeholder.
  - **Backend**: migration `0036_signals_activities.sql` creates `signal_type / signal_impact / signal_status / activity_type` enums + `soft_signals` + `account_activities` tables. CHECK on `soft_signals` enforces resolution atomicity (`status='resolved'` ↔ `resolved_at + resolved_by + resolved_note≥5 chars` all set).
  - Endpoints: `GET/POST /accounts/:id/signals`, `PATCH /signals/:id`, `POST /signals/:id/resolve` (note required), `POST /signals/:id/reopen` (admin-only — M13/M19/M22/M23 asymmetry), `DELETE /signals/:id` (admin-only hard delete). Activities mirror the shape: `GET/POST /accounts/:id/activities`, `PATCH /activities/:id`, `DELETE` is soft via `hidden=true`.
  - **Appetite hookup**: `services/appetite.py` `sig_pts` now derives from real signals — `pos_share>50% → 25`, `neutral>50% → 15`, `risk>50% → 8`, `critical>30% → 0` (mirrors prototype). Renewal-proximity branch restored: `dtr<90 and no risk/critical → 6` (instead of 0).
  - **Frontend**: `SignalsActivityTab.tsx` two-card layout (Soft Signals left, Activity Feed right) faithful to prototype `bStrategyEngage`. Signal row: type pill + impact + Resolve / Hide / Delete (admin) actions; resolved rows surface their resolution note inline. Resolve modal demands ≥5-char note (server-enforced). Activity log modal: type pills + title + summary + attendees + items. Appetite query invalidated on every signal change so the M26 banner reflects the score shift immediately.
  - Tests: 7 cases in `test_signals.py` (create + list, resolve requires note, 409 on second resolve, admin-only reopen, `sig_pts` response curve from baseline→25→0 as signal mix shifts, activity soft-delete, RBAC). All green.

- **M26 — Growth & Pipeline · Account Plan + Appetite Score (2026-05-17)** ([FUNC](./docs/features/M26-27-growth-pipeline/FUNCTIONAL.md) · [TECH](./docs/features/M26-27-growth-pipeline/TECHNICAL.md))
  - New top-level account tab **🚀 Growth & Pipeline** (emerald theme) with three sub-tabs in prototype order: **Account Plan** (live), **Signals & Activity** (M27 stub, live in commit `a45a6cb`), **External Intelligence** (M28 stub).
  - **Backend**: migration `0035_account_plays.sql` — `account_plays` table (title, value_usd, prob 0..100, when_text, trigger_text, modes[] subset of rescue/retain/expand, role, added_by, hidden) + CHECKs (prob range, modes subset, mode enum) + `accounts.plan_current_mode` override.
  - Endpoints: `GET/POST /accounts/:id/plays`, `PATCH/DELETE /plays/:id`, `GET /accounts/:id/appetite-score`, `POST /accounts/:id/plan-mode` (null clears override → auto).
  - **Appetite service** (`services/appetite.py`) — port of prototype `calcAppetiteScore`: Health 40% + Signal mix 25% + Renewal proximity 15% + ARR growth 20%. Mode mapping 0–39 rescue / 40–69 retain / 70–100 expand. Hard overrides (Renewal-type capped at retain). Tier+type vocab mapped to prototype's T1/T2/T3 + Hyper/Standard Growth / Retention table so `ARR_TARGETS` keeps working.
  - **Frontend**: `AccountPlanTab.tsx` faithful port of `bPlan` — mode banner with override modal (Auto / Rescue / Retain / Expand), "How is this mode determined?" 4-tile breakdown, mode-adaptive ACV growth tile, ARR burn-down with on_track/behind/declining status, Plays list with stage colour + per-play delete + "Show all plays" toggle (mode pills), Add Play modal with 10-step Sales-stage ladder.
  - Tests: 8 cases in `test_plays.py` (CRUD, soft-delete hides, appetite breakdown sums to score, override + clear, pipeline lifts projected ACV, sol_mgr forbidden, CSM-own allowed). All green.

- **M25 — AccountList portfolio rollups + renewal alerts (2026-05-17)** ([FUNC](./docs/features/M25-account-list-rollups/FUNCTIONAL.md) · [TECH](./docs/features/M25-account-list-rollups/TECHNICAL.md))
  - `AccountListItem` schema extended with `alignment_status` (green/amber/red from `cs_goals.alignment_status` rollup) + `goal_count` + `next_checkpoint_{type,date,days_until}` + `overdue_checkpoint_count` (from M21 Checkpoints) + `dr_outcome` (M23). `accounts.dr_outcome` comes free off the row.
  - `routes/accounts.py` new `_attach_rollups()` batch-fetches two queries for the visible page (one aggregating cs_goals counts per account, one fetching non-signed-off checkpoints). Two extra DB calls regardless of page size.
  - `AccountListPage.tsx` — new `RollupBadges` component renders the alignment dot (green/amber/red) + next-checkpoint chip with tone-by-days (>7d slate, ≤7d amber, overdue red) + outcome pill below the renewal cell. New top-of-list `RenewalAlertsBanner` lists every account with `days_to_renewal ∈ [0, 60]`, per-account chips clickable to jump to the overview (T-7 red, T-30 amber, otherwise yellow), caps display at 10 + "+N more".
  - Tests: 5 cases in `test_account_rollups.py` (shape, alignment rollup derives, next-checkpoint earliest-upcoming, overdue counts, dr_outcome surfaces). All green. Used slug-targeted lookups to avoid the cross-test count pollution that flakes `test_accounts.py`.

- **M23 — Delivery & Renewal (dual-track + red flags + readiness + outcome) (2026-05-12)** ([FUNC](./docs/features/M18-23-success-management/FUNCTIONAL.md) · [TECH](./docs/features/M18-23-success-management/TECHNICAL.md))
  - Migration `0033_delivery_renewal.sql` adds `accounts.delivery_renewal jsonb` + `dr_outcome` (text-with-CHECK in `renewed/at_risk/not_renewed/undecided`) + `dr_outcome_set_at/by` + stamp-consistency CHECK.
  - Schema: `ExpandItem · RedFlag · ReadinessAnswer · Readiness · Track1Derived` + `DeliveryRenewalOut/Update/RedFlagCreate/OutcomeSet` — all `extra="allow"`.
  - Routes: `GET /accounts/:id/delivery-renewal` (hydrates `track1` from M21 Checkpoints — next_type, next_days_until, overdue_count, signed_off_count; computes `expand_paused` and `readiness_score` every read), `PATCH /delivery-renewal` (409 when outcome is set), `POST /red-flags` (201; server-generates id + raised_at + raised_by), `POST /red-flags/:id/resolve` (idempotent), `POST /outcome` (one-shot; 409 on re-set), `POST /reopen` (admin-only — M13/M19/M22 unlock asymmetry).
  - **Bug found + fixed during dev**: shallow-copy + in-place jsonb mutation left old/new dict-graphs value-equal so SQLAlchemy skipped the UPDATE. Switched all DR mutation paths to `copy.deepcopy(real.delivery_renewal or {})` — caught by the red-flag resolve test.
  - Frontend `DeliveryRenewalTab.tsx`: dual-track top row (Track 1 mini-summary from M21 · Track 2 status pill), 4-column Kanban (Value Proof / Expand Ask / New Scope / Close), red-flag panel with type chips + Resolve per row, Renewal Readiness 3-question grid with proof notes + score badge (n/3 yes), Outcome buttons (Renewed / At risk / Not renewed) with admin-only Re-open when locked.
  - Tests: 6 in `test_delivery_renewal.py`. All green.

- **M22 — Value Delivery Document (4-section + 3-lever savings + lock) (2026-05-12)** ([FUNC](./docs/features/M18-23-success-management/FUNCTIONAL.md) · [TECH](./docs/features/M18-23-success-management/TECHNICAL.md))
  - Migration `0032_value_delivery_document.sql` adds `accounts.value_delivery_document jsonb` + `vdd_locked_at/by` + lock-consistency + jsonb-object CHECKs.
  - Schema: `VddOut/Update/Lock` + `MetricSnapshot` + `ApproachItem` (SavingsLever cost/risk/adoption) + `ValueDeliveredItem` (CSM-attributed identified/committed/implemented in $M) + `InitiativeStage` (mirrors cs_goals vocab).
  - Routes: `GET /accounts/:id/value-delivery-document` (auto-drafts on first read from `success_contract.value_narrative` newline-split → priorities, `success_metrics` snapshot, `cs_goals.initiatives` → approach + value_delivered), `PATCH` (409 if locked), `POST /lock` (422 if any of the 4 sections empty), `POST /unlock` (admin-only).
  - Frontend `VDDTab.tsx`: 4 section cards (priorities · agreed metrics · approach with 3-lever pill toggles + stage select · value-delivered 3-amount grid), CSM-attributed rollup tiles ($Identified / $Committed / $Implemented), exec summary textarea, sticky save bar with Save / Lock / Unlock — Lock disabled until all 4 sections have ≥1 item.
  - Tests: 7 in `test_vdd.py`. All green.

- **M21 — Checkpoints · Kickoff / MBR / QBR / Renewal + sign-off (2026-05-12)** ([FUNC](./docs/features/M18-23-success-management/FUNCTIONAL.md) · [TECH](./docs/features/M18-23-success-management/TECHNICAL.md))
  - Migration `0031_checkpoints.sql` — `checkpoints` table with `checkpoint_type` (Kickoff/MBR/QBR/Renewal) + `checkpoint_status` (not_held/held/signed_off) enums + CHECKs (sign-off consistency, snapshot-is-object).
  - Routes: `GET/POST /accounts/:id/checkpoints`, `POST /auto-schedule` (idempotent; requires `gate_signed`; Kickoff at signing / MBR+90d / QBR+180d / Renewal=`gate_renewal_date - 14d` or `signed + 335d` fallback), `PATCH /checkpoints/:id` (409 if signed_off), `POST /:id/sign-off` (writes immutable `signed_off_snapshot` of initiatives + metrics + client_acknowledgement + next_actions), `DELETE /:id` (409 if signed_off).
  - Frontend `CheckpointsTab.tsx`: timeline with Auto-schedule + Add buttons + status summary; CheckpointCard with type icon, scheduled/held/signed dates, overdue flag, inline notes editor, Mark held / Sign off transitions, signed-off snapshot rendered inline. SignOffModal — initiatives one-per-line + metric checkboxes (from M20 metrics list) + client ack + next actions + held_date.
  - Signed-off checkpoints are permanent evidence: no PATCH, no DELETE, no second sign-off. Same invariant as M13 signing.
  - Tests: 7 in `test_checkpoints.py`. All green.

- **M20 — Value Tracking · metrics with status engine (2026-05-12)** ([FUNC](./docs/features/M18-23-success-management/FUNCTIONAL.md) · [TECH](./docs/features/M18-23-success-management/TECHNICAL.md))
  - Migration `0030_success_metrics.sql` — `success_metrics` table (account_id, name, metric_type enum, target_value, current_value, status_override, owner, soft-delete fields) + enum types via DO blocks (Postgres has no `CREATE TYPE IF NOT EXISTS`).
  - **Status engine** (`schemas/metric.py::derive_status`): quantitative metrics parse the digits-and-dots from `target_value` / `current_value` strings → `pct = cur / tgt` → `≥0.8 green / ≥0.5 amber / else red`. Qualitative metrics map `high → green`, `medium/med → amber`, `low → red`. `status_override` short-circuits the calc; empty/blank `current_value` → grey. Handles `$2M` / `80%` / `H/M/L` uniformly.
  - Routes: 6 — `account_router` (list/create), `metric_router` (patch/log/delete/restore). Soft-delete requires a reason; restore is admin-only.
  - Frontend `ValueTrackingTab.tsx`: StatusSummary tile, MetricCard with progress bar, LogValueRow (one-click value log), CreateMetricModal, DeleteConfirm. Per-metric history feed.
  - Tests: 9 in `test_metrics.py`. All green.

- **M19 — Success Contract · 3-lock structure + Goals fold-in (2026-05-12)** ([FUNC](./docs/features/M18-23-success-management/FUNCTIONAL.md) · [TECH](./docs/features/M18-23-success-management/TECHNICAL.md))
  - Migration `0029_success_contract.sql` — `accounts.success_contract jsonb` + `success_contract_locked_at/by` columns with CHECK constraints (lock consistency + jsonb-is-object).
  - Schema: `SuccessContractOut/Update/Lock` (3 locks = primary metric + measurement method + value narrative ≥10 chars). `MeasureFreq` Literal (Monthly/Quarterly/Bi-annual/Annual). `extra="allow"` so future fields flow through.
  - Routes: GET (auto-drafts on first read from `account_solutioning.value_definition` + `sh_value_from_solutioning` + `sh_stakeholder_signoff` → measure_owner), PATCH (409 if locked; **None** values pop keys so the contract stays genuinely-empty when fully reset → the auto-draft branch in GET only fires on real emptiness), POST `/lock` (validates 3 locks satisfied), POST `/unlock` (admin-only — M13 asymmetry).
  - **Routing change**: `/goals` route now redirects to `/success-management/contract-goals`. Old top-level Goals nav removed. `ContractGoalsTab.tsx` stacks `SuccessContractCard` above the M15 `GoalsTab` content unchanged.
  - Frontend `SuccessContractCard.tsx`: three Lock cards with lock-pip tracker, dirty tracking, save/lock/unlock actions; "Pre-filled from Sales Handoff" amber badge when auto-drafted.
  - Tests: 9 in `test_success_contract.py`. All green.

- **M18 — Success Management group scaffold (2026-05-12)** ([FUNC](./docs/features/M18-23-success-management/FUNCTIONAL.md) · [TECH](./docs/features/M18-23-success-management/TECHNICAL.md))
  - New `SuccessManagementLayout.tsx` (pink theme) + 5 sub-tab stub pages (VDD / Contract & Goals / Value Tracking / Checkpoints / Delivery & Renewal). Shared `SMStub` component explains the future scope for each.
  - `AccountProfileLayout.tsx` nav reduced from 9 to 5 top-level entries — Overview · **Account Kit** · **Success Management** · Contacts · Value Def. Old `/pre-sales`, `/brief`, `/solutioning`, `/sales-handoff`, `/cs-onboarding` paths kept as back-compat redirects.
  - Phase-1 enabler for M19–M23. Stubs replaced sub-tab by sub-tab in subsequent milestones.

- **M17 — Account Kit grouping (refactor) (2026-05-12)** (UI refactor — no doc folder; covered under the umbrella ones)
  - 5 previously-flat tabs (Pre-Sales / Brief / Solutioning / Sales Handoff / CS Onboarding) grouped under a single **Account Kit** top-level entry.
  - New `AccountKitLayout.tsx` (orange theme) with a pill-style sub-tab strip + `<Outlet>` re-passing `account` via context — same shape later reused by `SuccessManagementLayout` (M18) and `GrowthPipelineLayout` (M26).
  - Back-compat redirects kept in `App.tsx` so existing bookmarks land in the new nested URLs.

- **M15.1 — AI candidate-goals extraction from VPD (2026-05-12)** ([FUNC](./docs/features/M15.1-vpd-goals-extraction/FUNCTIONAL.md) · [TECH](./docs/features/M15.1-vpd-goals-extraction/TECHNICAL.md))
  - After the existing VPD AI summary + `extract_vpd_fields` pass, the worker runs a second pass that pulls candidate Goals from the doc text and persists them on the document row as `cs_goals_extracted jsonb` (migration `0034_documents_cs_goals_extracted.sql`).
  - Frontend surfaces a **"Review N candidate goals →"** CTA on the VPD doc; clicking opens `VpdGoalsExtractionReview.tsx` with per-row checkbox + inline edit (title / category dropdown / target_value / target_date / owner) + initiatives + rationale + confidence pill. **Create N goals** fans out via `Promise.allSettled` — 409 → skipped; other errors → failed (matches M16 fan-out semantics). Apply step uses existing `POST /accounts/:id/cs-goals` (per-row write RBAC enforced there).
  - **Backend**: `schemas/cs_goals_extraction.py` (`ExtractedGoal` + `ExtractedInitiative` + `CsGoalsExtractionResult`, `extra="allow"`). `services/claude.py` adds `_stub_cs_goals_extract` (deterministic — splits on bullets, classifies by keyword bag, caps at 6) + `_real_cs_goals_extract` (one Claude call, JSON-only schema, 24h cache keyed on `sha256(vpd-goals|model|text)`) + `extract_cs_goals_from_vpd` public entry. Falls back to stub on key absence or transient failure. `routes/documents.py` adds `POST /documents/:id/extract-goals` — view-gated, vpd-kind-only, billed against `ai_quota`.
  - **Verified end-to-end against real Claude** with a Mondelez VPD-style bullet list: 4 well-classified goals (cost_savings / base_rationalization / risk_mitigation / adoption) + initiatives with `stage` populated (`committed`, `in_flight`). `is_stub: false`.
  - Tests: 10 in `test_cs_goals_extraction.py` (category classifier ×4, stub extractor bullets + cap + per-category + empty + fallback path). All green.

- **M16 — MoM → Multi-screen Field Extraction (2026-05-12)** ([FUNC](./docs/features/M16-mom-extraction/FUNCTIONAL.md) · [TECH](./docs/features/M16-mom-extraction/TECHNICAL.md))
  - **No manual click required** (post-refactor 2026-05-12): the Celery worker auto-runs `extract_from_mom()` for every `kind='mom'` upload right after AI summarisation. Result persists on `documents.mom_extracted_fields` jsonb + `mom_extracted_at` timestamptz (`0026_documents_mom_extracted.sql`). The frontend's existing 1.5s document-polling loop sees the column flip and one-shot applies the result: engagement + brief land as **dirty drafts** on Pre-Sales + Brief (sticky save bar pulses), contacts auto-create (409 = duplicate email skipped), green toast confirms. Per-doc `localStorage.awb:extraction-applied:<doc_id>` flag survives reloads so contacts never re-create.
  - **Upload pipeline expanded**: `.eml` (Outlook mail, stdlib `email` parser — prefers `text/plain`, falls back to naive HTML strip, prepends From/To/Cc/Subject/Date header block), plus `.docx/.pdf/.txt/.vtt` previously supported. `.doc` (legacy binary Word) accepted at upload but extractor returns a clear "Open in Word and Save As .docx" error — no reliable pure-Python `.doc` parser exists and shelling out to antiword/LibreOffice on Render would balloon the image.
  - **New endpoint**: `POST /api/v1/documents/:id/extract-fields` returns a structured `MomExtractionResult` (account_fields / engagement / contacts / brief) — read-only, view-gated (`can_view_account`), billed against `ai_quota`.
  - **Claude prompt** that knows the SDR 23-section template (Account Name / Meeting Date / Contacts / Meeting Type / Company Profile / Trigger Intel / Annual Revenue / GICS Industry / Headquarters / Focus / SF Link / Total Procurement Contacts / Additional info / Top Procurement Contacts / Competitor Companies / Beroe Clients in Similar Industry / Clients in the same country / Presence of internal MI Team / Company Insights / Intent Signals / Legacy Beroe LiVE Stats). Explicit derivation rules: SPOC=named meeting attendee (`is_spoc=true` for ONE row only), Sponsor=most senior procurement contact, MI Team entries→`is_internal_beroe=true` (excluded from contact creation), maturity = high/medium/low from CEB+LiVE engagement stats, `call_type`=first_discovery for Regular/Trigger/Lost Client. `max_tokens=4000`, single shot.
  - **Stub extractor** for when no Anthropic key is configured — deterministic regex-based parser that walks the 23-section template, extracts contact lines via `Name<linkedin>-Title` Outlook markup pattern, classifies seniority + function by keyword bag, computes news `days_ago` against today's date. ~80% as useful as real Claude on SDR-template MoMs.
  - **Frontend review modal** (`MomExtractionReview.tsx`): four section cards (Account info / Engagement / Contacts / Brief). Account info is read-only chips (no PATCH endpoint yet). Engagement + Brief have per-section Apply toggles. Contacts have per-row checkboxes; internal Beroe contacts disabled-by-default. **Apply selected** fires PATCH `/engagement` + PATCH `/brief` + POST `/contacts` × N in parallel via `Promise.allSettled`. Per-section status pills (Applying… / Done / N created · M skipped · K failed) surface inline as each finishes; 409 collisions counted as skipped.
  - **24h cache** keyed by `sha256(model + text)` so re-opening the same MoM doesn't bill twice. One Anthropic retry on transient errors, then graceful fallback to stub — UI never breaks.
  - **Verified end-to-end** against real Ciena (3-5B Trigger + Lost Client) and Caldic (1-3B Regular) `.eml` samples — both extract 5-6 contacts each with correct SPOC/sponsor classification, correct procurement_maturity (Ciena=high from "CEB Member" + 14 logged users + 566 mins; Caldic=low from "Not a CEB" + zero registered), correct `is_internal_beroe=true` for Caldic's MI Team (Susana Navarro + Harsha Potluri), news items with `days_ago` computed against 2026-05-12 (23d / 35d).
  - **Deferred**: account-header PATCH endpoint (industry / country / revenue / tier are surfaced as chips but not applied); auto-run during Celery doc processing (would save 5–15s modal wait but doubles Anthropic spend per upload).

- **M15 — CS Goal Validation & Alignment (2026-05-12)** ([FUNC](./docs/features/M15-cs-goals/FUNCTIONAL.md) · [TECH](./docs/features/M15-cs-goals/TECHNICAL.md))
  - New `cs_goals` table — id, account_id, title, category (enum: cost_savings / base_rationalization / risk_mitigation / adoption / other), target_value, target_date, owner, alignment_status (enum), phase_a/b/c (jsonb), initiatives (jsonb), history (jsonb), soft-delete fields, audit fields. `0024_cs_goals.sql`.
  - Two routers: `account_router` (list + create) and `goal_router` (get / patch / delete / restore). PATCH auto-derives `alignment_status` from the three `*_complete` flags unless the caller sets it explicitly; soft-delete requires a reason (5–600 chars); restore is `is_global_admin` only.
  - Pydantic `PhaseA / PhaseB / PhaseC / Initiative / HistoryAction` use `model_config(extra="allow")` so per-category fields flow through without churn.
  - History feed appended server-side on every meaningful action (`created` / `phase_a_completed` / `phase_b_completed` / `phase_c_completed` / `updated` / `soft_deleted` / `restored`). Distinct from `audit_log` (field-level mechanical capture).
  - Frontend: `GoalsTab.tsx` (~750 lines) — list + alignment-dot indicator + show-deleted toggle + add-goal modal + per-goal expand with `PhaseAEditor` / `PhaseBEditor` / `PhaseCEditor` (category-aware fields) + `InitiativeList` (with category-specific value stages) + `HistoryFeed`. Sticky save bar + soft-delete prompt + admin restore.
  - `api.delete()` extended to accept an optional body (for the mandatory delete reason).
  - Replaces the existing `/goals` placeholder tab; CSOnboardingTab now links here via "Manage Goals →".
  - Tests: 10 new pytest cases (`test_cs_goals.py`) — full CRUD + alignment derivation + initiative roundtrip + soft-delete + restore RBAC + 409 on patch-of-deleted + CSM RBAC.
  - **Deferred to follow-up:** AI VDD extraction (needs Claude wiring + extraction prompt + review modal).

- **M14 — CS Onboarding: Entry + Stakeholders (2026-05-12)** ([FUNC](./docs/features/M14-cs-onboarding/FUNCTIONAL.md) · [TECH](./docs/features/M14-cs-onboarding/TECHNICAL.md))
  - Five new columns on `accounts`: `cs_entry_type` enum (A / B), `cs_entry_b_context`, `cs_entry_b_goals`, `cs_handover_checklist` (jsonb — CSM-side), `cs_stakeholders` (jsonb — `{commercial, champion, category}` × `{name, email, phone}`). `0023_cs_onboarding.sql`.
  - New `can_write_cs_onboarding` predicate (same write set as engagement); new GET + PATCH routes that MERGE the jsonb columns on partial updates so concurrent role-edits don't race.
  - Frontend `CSOnboardingTab.tsx`: Entry picker (instant-save) + handover checklist (Entry A) OR baseline context (Entry B) + 3-role stakeholder map with coverage banner. `activated = gate_signed || cs_entry_type='B'` hides inner content for fresh accounts.
  - `AccountDetail` exposes `cs_entry_type` + `can_view_cs_onboarding` so the nav doesn't need a second call.
  - Tests: 9 new pytest cases — blank GET, Entry B activation, invalid enum 422, checklist + stakeholder merge semantics across roles, RBAC (CSM own / CSM other / solutioning view-only), AccountDetail surfaces cs_entry_type.

- **M13 — Sales Hand-off & Signing (2026-05-12)** ([FUNC](./docs/features/M13-sales-handoff/FUNCTIONAL.md) · [TECH](./docs/features/M13-sales-handoff/TECHNICAL.md))
  - 18 `gate_*` columns on `accounts` (signing date, ACV, term, derived renewal + VDD due dates, confirmed_by/_at, unlock metadata, contract doc, modules, tier, segment, subscribers) + `handover_quality_check` jsonb. 11 `sh_*` columns on `account_solutioning` (sales-side validation + engagement timeline + watch-outs + handoff doc). `0022_sales_handoff_signing.sql`.
  - New routes: `GET / POST /sign`, `POST /sign/unlock`, `PATCH /handover-checklist`, `PATCH /contract-doc`. Renewal + VDD due dates derived from `signed_date + term_years` (Feb-29 falls back to Feb-28; VDD pulled to renewal − 30 days if 6-month default overshoots).
  - Solutioning lock endpoint now auto-snapshots `value_definition` + themes into `sh_value_from_solutioning` / `sh_value_themes_from_solutioning` / `sh_value_received_at`. Re-lock preserves prior snapshot (doesn't clobber Sales's edits during unlock window).
  - Solutioning PATCH split by field ownership: `sol_fields` gated by lock + `can_write_solutioning`; `sh_*` fields editable post-lock by `can_write_sales_handoff`. `is_editable` is now a coarse OR; per-field RBAC enforced in PATCH handler.
  - New RBAC: `can_sign_account` (admin / VP Sales / VP Inside Sales / CO assigned / ISM assigned), `can_unlock_signing` (admin only — every unlock lands under a director-grade user in the audit trail), `can_write_sales_handoff` (joint Sales + Solutioning write).
  - Frontend `SalesHandoffTab.tsx`: Sales Hand-off card with sticky save bar + CLIENT SIGNED stage gate (pending → live → unlocked states) + Handover Quality Check (4 items).
  - Tests: 10 new pytest cases (`test_signing.py`) — visibility / capability flags, sign with date derivation, 409 on double-sign, CSM forbidden, unlock + re-sign cycle clears unlocked flag, reason ≥10 chars enforced, unlock admin-only, checklist merge, lock auto-snapshot, sh-fields editable while locked / value_definition blocked.

- **M12 — Pre-Meeting Brief on Pre-Sales (2026-05-11)** ([FUNC](./docs/features/AK03a-engagement-info/FUNCTIONAL.md) — covered in engagement work · [TECH](./docs/features/AK03a-engagement-info/TECHNICAL.md))
  - New `meeting_briefs` table — one per account, scalar call info + 14 JSONB collections (attendees, minefields, objectives, discovery questions, value anchors, public signals, news, annual reports, closing scenarios, stat cards, call timer, email insights, cheat sheet). `0020_meeting_briefs.sql`.
  - 14 nested Pydantic models validate every JSONB row shape on PATCH; whole-document update with 409 / 422 guards. Write permission = engagement OR solutioning so both Pre-Sales and Solutioning teams can prep.
  - Frontend `MeetingBriefEditor.tsx`: single component, collapsible `<details>` sections, generic `ItemList<T>` + `StringListField` helpers, sticky save bar with reset-brief action.
  - **Brief promoted to own top-level tab (Phase 3 of this session)** — was originally embedded in Pre-Sales as a collapsible section; now `/accounts/:id/brief` with a "Open Brief →" shortcut card left on Pre-Sales below the MoM uploads.
  - Tests: 9 cases covering roundtrip across every collection, shape validation (severity / confidence / call_type), RBAC, delete-clear.

- **M11 — Solutioning Sales Hand-off Lock (2026-05-11)** (no doc folder — small feature shipped under M13's umbrella)
  - `account_solutioning.locked_at` + `locked_by` columns. `POST /solutioning/lock` requires a non-empty value_definition; `POST /solutioning/unlock` reopens. PATCH on locked solutioning fields returns 409.
  - **Originally shipped with a Trial / POC block (9 fields + `trial_kind` enum), rolled back in `0021_drop_solutioning_trial_fields.sql` after the user confirmed it wasn't part of the v20 prototype's Solutioning page UI** — only the lock remains. The lock infrastructure is what M13 builds on for the Sales Hand-off snapshot flow.

- **M10 — Production polish + deploy (2026-05-09)** ([FUNC](./docs/features/M10-production/FUNCTIONAL.md) · [TECH](./docs/features/M10-production/TECHNICAL.md))
  - **Deployed to Render + Vercel** end-to-end. `render.yaml` Blueprint stands up FastAPI + Celery worker + managed Redis in one click; `apps/web/vercel.json` adds SPA-fallback rewrite so deep links don't 404.
  - **Visual prototype match** — Tailwind tokens lifted from prototype `:root` (card-border #e4eaf6, navy-4 #001e52, rounded-card 14px). Sidebar restyled to `.sb-btn` with brightened text contrast; sub-nav switched from pills to underline `.tab-b` pattern; cards harmonized everywhere.
  - **AK02 KPI strip** — uniform mini-cards with **red alert pill + ⚠** for danger renewal/health (prevents the vertical jaggedness from mixed-height stats).
  - **Overview redesigned** — no header duplication; engagement snapshot, three-up status mini-cards (Roster / Documents / Solutioning), lifecycle progress bar with today marker, Sales Discovery summary preview.
  - **Unsaved-changes guard** (Pre-Sales + Solutioning): sticky save bar pulses amber when dirty; navigating away pops a Save & continue / Discard / Stay dialog with prettified destination labels; `Cmd / Ctrl + S` saves; `beforeunload` for browser-close.
  - **Persistent favourites** — new `user_favorites` table + RLS (0016); `GET / POST / DELETE /api/v1/me/favorites/{account_id}`; star toggle on AK01 row + AK02 header; sidebar **Pinned** + (CSM-only) **My portfolio** sections; one-shot localStorage→DB migration.
  - **Categories admin** — `/admin/categories` two-column page (pending/approved) with **reject-with-reason** modal that captures ≥5-char reason and writes it to `audit_log`. Unified query key + 30s staleTime + skeleton.
  - **Solutioning** sub-tab moved next to Pre-Sales; **Sortable Contacts columns**.
  - **DB perf escape hatch** — auto-detects session vs transaction-mode pooler from `DATABASE_URL` port (5432 vs 6543); flips `statement_cache_size` and pool sizing accordingly. Production runs on 6543 to escape the 15-client cap.
  - **CI fixes**: ESLint v9 flat config (was crashing on `.eslintrc.cjs`); committed `apps/api/uv.lock`; dropped duplicate pnpm version pin.
  - **UX recovery**: Rerun button enabled on >90s-old stuck-pending docs; documents dedup now restores soft-deleted rows; `vercel.json` SPA rewrite stops deep-link 404s.
- **M9 — Admin: Account creation + User management (2026-05-08)** ([FUNC](./docs/features/M9-admin/FUNCTIONAL.md) · [TECH](./docs/features/M9-admin/TECHNICAL.md))
  - **Backend:**
    - `POST /api/v1/accounts` — admin/cs_director/vp_csm; `_slugify` + `_unique_slug` (`-2`/`-3` on collision); CSM-role validation; uses existing audit listener
    - `POST /api/v1/users` — admin invites via Supabase Auth `invite_user_by_email`; mirrors into `public.users` with `status='pending'`, `invited_at`, `invited_by`
    - `PATCH /api/v1/users/:id` — admin edits role/team/full_name; **self-demote guard**; calls `invalidate_user_cache(id)` so the 60s perf cache doesn't paper over a role change
    - `DELETE /api/v1/users/:id` — soft-deactivate; **self-deactivate guard**
    - `POST /api/v1/users/:id/resend-invite` — re-trigger email (only when status=pending)
    - `0015_users_invite_status.sql` — `user_status` ENUM (`pending`/`active`/`deactivated`) + `invited_at`/`invited_by` columns
  - **Frontend:**
    - AK01 `+ New account` CTA + `CreateAccountModal` — required fields surfaced, optional under "Add more details" toggle, CSM dropdown filtered to csm+cs_team_manager, on save → `navigate('/accounts/:id/overview')`
    - `/admin/users` page — table + role filter + show-deactivated toggle + Invite/Edit/Deactivate/Resend actions
    - Sidebar Admin section (admin-only); active-route highlight on Accounts + Users
    - `RequireAdmin` route guard wired into `App.tsx`
  - **Phase-2 SSO compatibility:** the admin user-management UI doesn't change when SSO replaces the password step. Email is the link key; SSO login matches to `public.users` row pre-provisioned by admin and flips status `pending → active` automatically.
  - **Tests:** 10 new pytest cases (97 total) — admin/non-admin RBAC, slug-collision, self-demote/deactivate guards, invite happy path with real Supabase `admin.create_user` stub
- **BRD audit pass — five M-prime milestones (2026-05-08)** (driven by gap audit; closes critical Sprint-1 gaps before sign-off)
  - **M6.5 — AK03.b Contacts schema realigned to BRD table 12** (`0011_contacts_brd_realign.sql`):
    new ENUMs `contact_function`, `contact_seniority`, `contact_decision_power`; `notes` text (≤500); name ≥3 chars; per-account email uniqueness via `ux_client_contacts_account_email`. Backfilled from legacy `role`/`influence` then dropped them. `is_spoc`/`is_sponsor` retained for SPOC-pinned UX.
  - **M7.1 — Document AI-tag lifecycle + aggregate risks section** (`0012_documents_ai_edited.sql`):
    `documents.ai_edited` + `ai_edited_by` + `ai_edited_at`. New `PATCH /api/v1/documents/:id/summary` flips the flag; rerun-ai resets it. UI shows **AI-generated** vs **AI-assisted** pill with edit-summary inline. Aggregate Sales Discovery Summary prompt restructured to "Narrative / Decisions / Action items / Risks & concerns" (BRD §4.3.c logic).
  - **M2.5 — F01 lockout + forgot-password** (`0013_login_attempts.sql`):
    `login_attempts` table; new endpoints `POST /auth/login-status` + `/auth/login-record-failure`. 5 fails / 15 min window enforced server-side (BRD AC-3). Login UI: counter, "Forgot password?" link, 30-min reset flow via Supabase + new `/reset-password` page (BRD AC-4).
  - **M3.5 — AK01 enhancements**:
    `?renewal_within_days` filter, page-size picker (25/50/100), `/accounts/export.csv` (CSV stream, ≤10k rows, respects filters), `POST /accounts/bulk/reassign-owner`, search extended to CSM email + primary contact name. UI: bulk-select column + bulk reassign modal + CSV download button.
  - **M7.5 — AK03.d Solutioning / VPD structured fields + Handover action** (`0014_solutioning.sql`):
    `account_solutioning` (proposed_solution / engagement_type / engagement_duration_months / value_themes[] / value_definition / estimated_value_musd / `ai_extracted_*` / `ai_edited`). New `engagement_type` ENUM. `accounts.handed_off_to_solutioning` + `_at` + `_by` flags. New routes `GET/PATCH /accounts/:id/solutioning` + `POST /accounts/:id/handover-to-solutioning`. Worker: VPD uploads run `extract_vpd_fields()` (Claude + stub fallback) and write candidate values; never overwrites user-edited fields. Frontend: new `SolutioningTab` with AI-tag pill + value-themes chips + sticky save bar; "Hand over to Solutioning" CTA on Pre-Sales tab. AK02 sub-nav now shows Overview / Pre-Sales / Contacts / Documents / **Solutioning** / Value Def / Goals.
  - **Cross-cutting**:
    - 403 → `/access-denied` redirect from `lib/api.ts`; AccessDenied page reads `?from=` + `?detail=`.
    - Per-user/day Claude rate-limit (matrix Q5) — `services/ai_quota.py`, in-memory counter, wired into `/ai/quality-check` + document re-runs. 200 calls/UTC-day default.
    - Documents tab: drag-drop multi-file upload, rerun-AI confirmation, inline summary edit.
    - Sortable Client Contacts columns (`?sort_by=name|title|function|seniority|decision_power|email|created_at`).
    - Prototype HTML copied into `prototype/beroe_awb_v20.html` (was empty dir) + `prototype/README.md`.
    - Value Definition + Goals & Initiatives placeholder tabs (BRD §4.2 sub-nav completion).
  - **Tests:** 87/87 green (no test count change — schema migration didn't break the existing suite; engagement audit test made re-run-safe with a per-run suffix)

- **M7 — AK03.c Documents + Celery AI pipeline** ([FUNC](./docs/features/AK03c-documents/FUNCTIONAL.md) · [TECH](./docs/features/AK03c-documents/TECHNICAL.md))
  - `Document`, `Job`, `AccountDiscoverySummary` ORMs (`apps/api/app/models/document.py`) + Pydantic schemas (`schemas/document.py`)
  - 7 endpoints across 3 routers (`apps/api/app/routes/documents.py`):
    - `GET /api/v1/accounts/:id/documents` (with `?include_deleted` admin-only + optional `?kind` filter)
    - `POST /api/v1/accounts/:id/documents` — multipart upload, hash-dedup, kind-aware RBAC, returns 202 + job_id
    - `GET /api/v1/documents/:id` + `/download-url` (5-min signed)
    - `POST /api/v1/documents/:id/rerun-ai`
    - `DELETE /api/v1/documents/:id` (soft)
    - `GET /api/v1/accounts/:id/discovery-summary`
    - `GET /api/v1/jobs/:id`
  - **Storage** (`services/files.py`): Supabase Storage helpers via service-role key (RLS-bypassing). Naming: `<account_id>/<doc_id>__<sanitised>`. Buckets `meeting_records`, `vpd`, `contracts` created in `0010_storage_buckets.sql` with RLS = service-role + admin only
  - **Extract** (`services/extract.py`): `.docx` (python-docx, paragraphs + tables), `.pdf` (pypdf, page-by-page), `.vtt` (strips cues + timestamps), `.txt` (utf-8). Audio/video raises explicit "v1.1" error
  - **AI** (`services/claude.py`): `summarise_document(text, kind)` → 200-word summary + entities (people, decisions, action_items, dates) with **stub fallback** when key isn't real, 24h TTL cache, one retry on transient errors. `aggregate_account_summary(per_doc_summaries)` → ≤300-word account-level rollup. Both stay within budget — Celery task never re-raises so retries don't bill the API repeatedly
  - **Celery** (`workers/celery_app.py` + `workers/tasks.py`): single task `process_document(job_id)` — load → mark running → download → extract → summarise → regen aggregate → mark complete. Uses `asyncio.run()` to drive existing async clients
  - Pytest: 17 new tests (87 total) — extract unit tests + RBAC matrix (CSM forbidden on VPD; solutioning_manager allowed) + dedup + soft delete + rerun + jobs/:id auth
  - Frontend: `DocumentsTab` with Sales Discovery Summary card on top, kind picker + file input, list with status pills + stub-AI tag + summary expand + entity chips, 2-second job polling for active uploads, rerun + soft delete actions, 100 MB / extension client-side validation
  - Wired into `App.tsx` at `/accounts/:id/documents` (replaces M7 placeholder)
- **M6 — AK03.b Client Contacts** ([FUNC](./docs/features/AK03b-client-contacts/FUNCTIONAL.md) · [TECH](./docs/features/AK03b-client-contacts/TECHNICAL.md))
  - `ClientContact` ORM (`apps/api/app/models/contact.py`) + Pydantic v2 schemas (`schemas/contact.py`) — `ContactOut`, `ContactListResponse`, `ContactCreate`, `ContactUpdate`
  - 5 endpoints (`apps/api/app/routes/contacts.py`):
    - `GET /api/v1/accounts/:id/contacts` — `is_editable` flag + admin-only `?include_deleted=true` (only deletions within 30 days)
    - `POST /api/v1/accounts/:id/contacts` — matrix-aware (`can_write_contacts`)
    - `PATCH /api/v1/contacts/:id` — partial update via `model_dump(exclude_unset=True)`
    - `DELETE /api/v1/contacts/:id` — soft delete (sets `deleted_at`)
    - `POST /api/v1/contacts/:id/restore` — admin-only, 30-day window enforced
  - **Audit auto-capture extended to ClientContact**: `AUDITED_MODELS` now includes contacts; `row_id` resolution generalized to all audited models (was Account-only). `new_value`/`old_value` carry `account_id` so contact edits surface on the account's Overview activity feed via JSONB containment
  - `0009_seed_contacts_demo.sql` — 12 demo contacts across the 4 accounts (Siemens=4, Mondelēz=3, Sanofi=3, Novo Nordisk=2; each has 1 SPOC + 1 sponsor)
  - Pytest: 12 new tests (70 total) — RBAC matrix coverage incl. solutioning has F all (matrix Q3), audit-log capture verification, full soft-delete + restore lifecycle
  - Frontend: `ContactsTab` with list (SPOC + sponsor pinned to top), influence pill (color-coded), add/edit modal with email validation, soft-delete with confirm, admin "Show deleted" toggle + Restore action
  - Wired into `App.tsx` at `/accounts/:id/contacts` (replaces M6 placeholder)
- **M1 — Repo skeleton + dev loop + safety rails** ([FUNCTIONAL](./docs/features/M1-skeleton/FUNCTIONAL.md) · [TECHNICAL](./docs/features/M1-skeleton/TECHNICAL.md))
  - Monorepo wired (`apps/web`, `apps/api`, `packages/shared`)
  - `apps/web` scaffolded: Vite + React + TS + Tailwind + shadcn config + auth provider abstraction
  - `apps/api` scaffolded: FastAPI + uv + Pydantic settings + `/health` endpoint + Dockerfile
  - `supabase/` config (8h JWT expiry, signup disabled), migrations folder, seed placeholder
  - `docker-compose.yml` for local dev (Postgres + Redis + api + worker)
  - GitHub Actions: `web-ci`, `api-ci`, `security` (gitleaks + block-tracked-`.env`)
  - Pre-commit: gitleaks + standard hygiene
  - `.env.example` files at root + apps/web + apps/api; gitignore excludes `.env` and `.claude/settings.local.json`
  - Full `docs/` skeleton (architecture, security, features)
- **M5 — AK03.a Engagement Info + audit-log auto-writer** ([FUNC](./docs/features/AK03a-engagement-info/FUNCTIONAL.md) · [TECH](./docs/features/AK03a-engagement-info/TECHNICAL.md))
  - `account_engagement` ORM + Pydantic schemas
  - **SQLAlchemy `before_flush` listener** auto-writes one `audit_log` row per changed field, transactionally with the data change. JSONB `new_value`/`old_value` always carry parent `account_id` so the AK02 activity feed picks up child-row edits automatically
  - Per-request `current_user_id_var` ContextVar wired in `core/deps.py` so the listener can attribute writes
  - `GET/PATCH /api/v1/accounts/:id/engagement` (matrix-aware: solutioning_manager view-only per Q3)
  - `POST /api/v1/ai/quality-check` — Claude-backed scoring (1–5) with **stub fallback** when `ANTHROPIC_API_KEY` isn't configured. LRU cache for repeat calls.
  - `GET/POST /api/v1/lookups/categories` — propose-new flow (lands as `approved=false`); admin approval endpoint
  - `GET /api/v1/lookups/geographies`
  - AK01 search now also matches `slug` (so `?q=mondelez` finds Mondelēz)
  - `0008_seed_engagement_demo.sql` — engagement rows for the 4 demo accounts (varied quality so the AI button shows different scores per row)
  - Pytest: 18 new tests (58 total, 75% coverage) — incl. audit-writer verification, AI stub scoring, category approval flow
  - Frontend: `PreSalesTab` with engagement objective + AI button + word counter, multi-select categories with propose-new pills, geographies, profile, origin, stakeholders, sticky save bar with dirty tracking + diff PATCH
- **M4 — AK02 Account Profile shell + Overview** ([FUNC](./docs/features/AK02-account-profile/FUNCTIONAL.md) · [TECH](./docs/features/AK02-account-profile/TECHNICAL.md))
  - `GET /api/v1/accounts/:id` — single-account detail with `is_editable` and `can_view_*` capability flags (drives sub-nav visibility)
  - `GET /api/v1/accounts/:id/activity` — paged audit-log feed scoped to the account; captures direct edits + child-row JSONB containment (`account_engagement`, `client_contacts`, `documents`, `account_assignments`)
  - `AuditLog` ORM (`apps/api/app/models/audit.py`)
  - `0007_seed_audit_demo.sql` — 5 demo audit entries so the feed isn't empty
  - Frontend: `AccountProfileLayout` (breadcrumb + header with brand stats + sub-nav), `OverviewTab` (metrics + engagement context + activity feed), `PlaceholderTab` for Pre-Sales/Contacts/Documents (M5/M6/M7 banners)
  - Nested routes: `/accounts/:accountId/{overview,pre-sales,contacts,documents}` — each bookmarkable
  - Row click in AK01 navigates to AK02 (with `stopPropagation` on Reassign so the modal still works)
  - Pytest: 8 new tests (40 total), 75% coverage
- **M3 — AK01 Account List** ([FUNC](./docs/features/AK01-account-list/FUNCTIONAL.md) · [TECH](./docs/features/AK01-account-list/TECHNICAL.md))
  - 4 demo accounts seeded (Siemens, Mondelēz, Sanofi, Novo Nordisk) with assignments — `0004_seed_demo_accounts.sql`
  - `Account` ORM + Pydantic schemas (`AccountListItem`, `AccountListResponse`)
  - `GET /api/v1/accounts` with search (name/country/industry), filters (industry/tier/region/csm/category), sort (5 columns × asc/desc), pagination (1..200), per-row `is_editable`
  - `require_account_access(write=...)` factory ready for M4+
  - `can_view_account` / `can_edit_account` / `can_*` per-function helpers in `rbac.py`
  - **Matrix realign** (2026-05-08): RLS policies + RBAC re-aligned to `Roles_Access_Matrix_Reviewed_05072026.xlsx` (`0005_realign_rls_per_matrix.sql`)
  - 2 additional users + APAC team seeded (`0006_seed_team.sql`); Sanofi reassigned to `csm2`
  - `PATCH /api/v1/accounts/:id/owner` (admin only) + `GET /api/v1/users` (admin only) endpoints
  - Frontend: `AppShell` (sidebar + brand), `/accounts` page (search + filters + sortable headers + pagination + URL state), admin-only `ReassignOwnerModal`
  - Pytest: 32 tests pass (24 new in M3), 74% coverage
  - End-to-end: 7/7 pass against live Supabase
  - **DB gotcha discovered + fixed**: Supabase direct DB is IPv6-only; switched to transaction-mode pooler (`aws-1-ap-northeast-1.pooler.supabase.com:6543`) with statement cache disabled
- **M2 — Auth + RBAC (F01 + F02)** ([F01-FUNC](./docs/features/F01-auth/FUNCTIONAL.md) · [F01-TECH](./docs/features/F01-auth/TECHNICAL.md) · [F02-FUNC](./docs/features/F02-rbac/FUNCTIONAL.md) · [F02-TECH](./docs/features/F02-rbac/TECHNICAL.md))
  - Supabase project `Account_workbench` (id `fclkazponiwvmvzgvwei`) wired
  - Schema: 14 tables, 7 enums, indexes, soft deletes (`supabase/migrations/0001_init_schema.sql`)
  - RLS: policies on every table, helper fns `current_user_role`, `user_assigned_to_account`, role-group helpers (`0002_rls_policies.sql`)
  - Lookups seeded: 11 roles, 5 geos, 10 categories (`0003_seed_lookups.sql`)
  - 5 placeholder users seeded via `scripts/seed_users.mjs` (idempotent)
  - FastAPI auth: ES256 + HS256 dispatcher, JWKS cache, `get_current_user`, `require_role`, `permissions_for`
  - `GET /api/v1/me` returns `{ user, permissions }`
  - Pytest: 11 tests pass (auth + RBAC matrix), 92% coverage on auth modules
  - End-to-end verified: 5 real Supabase logins → /me round-trip → correct role + permissions
  - Frontend: `AuthProvider`, `RequireAuth`, login screen, role-aware home page
  - Beroe SSO swap path documented (Phase 2 — `auth-sso.ts` is one import change)

### 🚧 In progress
_(none — Sprint 1 deployed and stakeholder-demo-ready)_

### ⏳ Up next
- **M24 — Leadership view.** New top-level cross-account portfolio dashboard: M23 outcome rollup (renewed / at_risk / not_renewed counts), value-delivered total from M22 VDDs, overdue-checkpoint count from M21, red-flag list across portfolio. Read-only dashboards.
- **M16.1 — Account-header PATCH endpoint.** The MoM extraction modal still surfaces industry / country / annual_revenue / tier_band / sf_link as informational chips because there's no scalar PATCH on `accounts`. Add `PATCH /api/v1/accounts/:id` for those five fields so the apply step covers the whole header.
- **`platform_intel` ETL pipeline (v1.1)** — today the Intelligence + Analytics surfaces read from `accounts.platform_intel` jsonb seeded for Mondelez + Siemens via migrations 0039–0041. Real ingestion is a Beroe-Live → AWB feed that lands the same JSON shape on a schedule. When that pipeline ships the **frontend doesn't change** — same `GET /platform-intel` endpoint serves it, every screen updates automatically (see `docs/DATA-WIRING-AUDIT.md`).
- **PPT / PDF export of reports** — QBR / MBR / Utilization currently render as HTML inside an iframe + Download HTML. PPT needs python-pptx templates; PDF needs reportlab. Buttons disabled with v1.1 tooltips.
- **v1.1 backlog** — bulk import for users; audio/video transcription on document upload; AI assistant side panel; release the test-pollution flakes (`test_pagination`, `test_list_contacts_admin`) by switching cross-test cleanup to fixture-scoped truncates; Option B period-scoped queries (server-side period scaling, currently client-side Option A in Analytics); SD regional split sourced from telemetry; Industry-benchmark cross-account aggregation server-side.

---

## Decisions log

> Append-only. Date — decision — reason. Link to discussion or doc when relevant.

- **2026-05-08** — Stack locked: React + Vite + TS (web), FastAPI (api), Supabase (DB/auth/storage), Anthropic Claude (AI), Celery+Redis (jobs), Vercel + Render (hosting). Reason: BRD-allowed; user preference for Python over Node on backend.
- **2026-05-08** — Audio/video transcription deferred to v1.1. Reason: keeps Sprint 1 deliverable; BRD says budget allows but we ship text-only first.
- **2026-05-08** — Supabase MCP used for schema management. Reason: scripts schema changes; avoids manual SQL paste.
- **2026-05-08** — Two-doc policy per feature (FUNCTIONAL + TECHNICAL). Reason: stakeholders need plain-English; engineers need detail.
- **2026-05-08** — All secrets in `.env` only; gitleaks pre-commit + GitHub Secret Scanning enforced. Reason: zero tolerance for credential leaks.
- **2026-05-08** — Auth provider abstraction (`AuthProvider` interface) so Beroe SSO is a config swap when ready. Reason: BRD says Phase 2 SSO; don't paint into a corner.
- **2026-05-08** — JWT verifier dispatches on `alg`: ES256 (asymmetric, JWKS) for real Supabase user tokens; HS256 (symmetric, JWT secret) for tests. Reason: new Supabase projects sign with ES256 — discovered during M2 e2e test. JWKS cached 1h with self-healing rotation.
- **2026-05-08** — RLS as third wall + FastAPI `require_role` as second wall + frontend gating as first. App role lives in `public.users.role`, NOT in JWT claims. Reason: defense-in-depth + can't be elevated by tampering with JWT.
- **2026-05-08** — Seeded 5 placeholder users (anand=admin, santosh=vp_sales, megha=cs_director, harish=csm, purnima=solutioning_manager) via `scripts/seed_users.mjs`. Reason: M2 test users; will be replaced when Beroe shares production list.
- **2026-05-08** — Migration application path: raw SQL via Supabase Management API (Supabase MCP not registered in this Claude Code session). Reason: same outcome, no manual paste; SQL files committed to `supabase/migrations/` for reproducibility.
- **2026-05-08** — DATABASE_URL switched from direct host (IPv6-only `db.<ref>.supabase.co`) to transaction-mode pooler (`aws-1-ap-northeast-1.pooler.supabase.com:6543`). Reason: direct host unreachable from IPv4-only networks (CI, Render). Pooler also requires asyncpg `statement_cache_size=0` — set in `app/db/session.py`.
- **2026-05-08** — `is_editable` flag computed server-side per row using `can_edit_account(role, is_assigned)` so the frontend never has to derive permissions itself. Reason: keep capability logic in one place; frontend just renders.
- **2026-05-08** — **Matrix realign**: `Roles_Access_Matrix_Reviewed_05072026.xlsx` is the canonical source for RBAC. When BRD §3.2 narrative conflicts with the matrix, **matrix wins** (confirmed by stakeholder). Concrete shifts:
  - `vp_sales` is **not** a global admin — read-only across most functions; can view audit log.
  - `solutioning_manager` **cannot** edit `account_engagement` (matrix Q3: "Only sol. Sections").
  - `commercial_owner` Account List scope is **own portfolio only** (`accounts.co_user_id == auth.uid()`).
  - Audit Log viewable by all VPs + CS Director + Admin (matrix Q6: "All").
  - Re-assign owner is **admin only**.
  - CSM/CS Team Manager see ALL accounts in the list (read-only on non-own/non-team).
- **2026-05-08** — Seeded 2 more placeholder users + APAC team: `team.lead@beroe-inc.com` (cs_team_manager) and `csm2@beroe-inc.com` (csm). Sanofi reassigned to csm2 to exercise the read-only-on-other-CSMs path. Reason: enables CS Team Manager scope tests + cross-CSM read-only verification.
- **2026-05-08** — `User.role` mapped to Postgres `role_key` ENUM (was `String`). Reason: filtering by enum required automatic SQLA cast; the `String` mapping caused `operator does not exist: role_key = character varying`.
- **2026-05-08** — Audit-writer `row_id` resolution generalized: was `getattr(obj, "id", None) if isinstance(obj, Account) else None` (Account-only); now `getattr(obj, "id", None)` for every model in `AUDITED_MODELS`. Reason: M6 added `ClientContact` to audited set — without the generalization, contact-level edits would have logged with `row_id=null` and broken the per-row audit trail.
- **2026-05-08** — Soft-delete + 30-day restore window enforced server-side in `/restore` (not just hidden in UI). Restore requires admin role. Reason: defense-in-depth — UI hiding is a usability nicety, not a security boundary.
- **2026-05-08** — M7 storage policy: all three buckets (`meeting_records`, `vpd`, `contracts`) are private; only the FastAPI process (service-role key) and admins can touch objects directly. Regular users get 5-minute signed URLs minted by the API on demand. Reason: defense-in-depth — RLS on `storage.objects` plus FastAPI scope checks make a leaked anon key insufficient to exfiltrate uploads.
- **2026-05-08** — Celery `process_document` never re-raises — failures are written to `jobs.error` and the task returns. Reason: Celery's default retry behaviour would burn the Anthropic budget on persistent failures; user can manually click Rerun.
- **2026-05-08** — Per-account dedup on `documents` keyed on `(account_id, sha256(file))`. Returns the existing row with `duplicate=true` instead of inserting. Reason: avoids accidental double-billing on AI summarisation when the same MOM is uploaded twice.
- **2026-05-08** — Worker uses `asyncio.run()` to drive the existing async SQLAlchemy + Supabase clients from inside Celery's sync task model. Reason: avoids adding `psycopg2` and a parallel sync engine; one DB driver, one Storage client.
- **2026-05-08** — BRD audit pass identified ~20 gaps; bundled into 5 M-prime milestones (M2.5/M3.5/M6.5/M7.1/M7.5) and shipped together. Reason: pre-stakeholder-sign-off correctness pass; the audit report (see chat log) is the canonical baseline.
- **2026-05-08** — AK03.b vocabulary realigned to BRD table 12 verbatim: `function` (procurement / supply_chain / finance / operations / it / other), `seniority` (cxo / vp / director / manager / other), `decision_power` (executive_sponsor / influencer / champion / detractor / unknown), plus `notes` (≤500). Legacy `role`/`influence` dropped; data backfilled deterministically. Reason: stakeholder UAT will compare field-by-field against the BRD spec; vocabulary mismatch would fail.
- **2026-05-08** — AI-tag lifecycle: `ai_generated` → `ai_assisted` flips on user edit (`Document.ai_edited`, `AccountSolutioning.ai_edited`). Reason: BRD §4.3.c/d traceability — readers need to know whether a summary they're quoting was reviewed by a human.
- **2026-05-08** — VPD candidate writes never overwrite user-edited Solutioning fields (`AccountSolutioning.ai_edited` gates wholesale refresh; only empty fields are filled). Reason: re-uploading a refreshed VPD shouldn't blow away handcrafted edits.
- **2026-05-08** — Per-user/day Claude rate-limit (`services/ai_quota.py`, default 200) in-memory only for Sprint 1. Reason: single-process API today; swap to Redis INCR on horizontal scale. Matrix Q5 answer was "yes — cap usage".
- **2026-05-08** — Login lockout window keyed on `(lower(email), 15-min sliding window)` via DB table, not in-memory. Reason: must survive API restarts and remain consistent across multi-process workers; Supabase's own rate-limit is internal and not user-visible.
- **2026-05-08** — Bulk reassign endpoint admin-only (matches `can_reassign_account_owner`). BRD open-Q answer ("Both — admin or CS Director") stays unresolved pending stakeholder confirmation; matrix wins per project rule. Reason: tightening is reversible; loosening leaves an audit hole.
- **2026-05-08** — M9 perf pass: switched DATABASE_URL to **session-mode pooler (port 5432)** with `statement_cache_size=200`; turned off `pool_pre_ping` (saves a SELECT 1 per checkout); added 60s `_USER_CACHE` in `core/deps.py` and 30s/60s `_CACHE`/`_TEAM_CACHE` in new `core/scope.py`. Reason: 800–1500 ms per endpoint over 150 ms RTT was unacceptable. Now `/me` is ~2 ms warm, account-scoped endpoints ~240 ms (5× faster). Caches are immutable snapshots so write paths can't accidentally write through detached objects.
- **2026-05-08** — Account creation = admin / cs_director / vp_csm (`can_create_account` predicate). Slug auto-generated via `_slugify(name)` + `_unique_slug` (numeric suffix on collision). Reason: matches "Manage Accounts = F" cluster in matrix; keeps slug deterministic and human-readable.
- **2026-05-08** — User invite uses Supabase Auth `invite_user_by_email` with service-role key. `public.users.id` is the same UUID as `auth.users.id` (FK constraint), pre-provisioned by admin so role+team are set *before* first login. Re-invite same email is idempotent: resets status to `pending`, refreshes role, re-sends link. Reason: Phase-2 SSO will swap the email step for SSO email-match; the data model + admin UI stays identical.
- **2026-05-08** — Admin self-protection: cannot demote self out of admin (PATCH /users/:id with role!=admin → 400) and cannot deactivate self (DELETE /users/:id → 400). Reason: prevents workspace lockout via single accidental click.
- **2026-05-08** — `invalidate_user_cache(user_id)` called explicitly after every user PATCH/DELETE so the 60s identity-cache TTL doesn't delay a role change taking effect. Reason: defense-in-depth on role demotions — if you remove someone's admin perms, they should stop being admin on the next request, not 60s later.

### M10 — Production polish + deploy (2026-05-09)

- **2026-05-09** — Deployed via **Render Blueprint** (`render.yaml`) for backend + Celery + Redis, **Vercel** for frontend. Reason: Blueprint declares all three services + env wiring once; one-click reproducible setup; secrets stay out of git via `sync: false`. Manual service-by-service Render setup was 3× the work and prone to URL-copy errors on `CELERY_BROKER_URL` between web and worker.
- **2026-05-09** — `apps/web/vercel.json` SPA fallback (`{"source": "/(.*)", "destination": "/index.html"}`). Reason: deep links like `/accounts/<id>/documents` 404'd on direct paste / browser refresh because Vercel looked for a static file at that path. The rewrite only kicks in after asset lookup fails, so JS/CSS bundles still serve correctly.
- **2026-05-09** — DB pooler mode auto-detects from `DATABASE_URL` port (`:5432` session, `:6543` transaction). Reason: session-mode caps at 15 clients on Free tier — production hit `EMAXCONNSESSION` immediately because API+worker+local stack shared the same project. Transaction-mode raises the cap to ~200 at the cost of ~110 ms per query (no server-side prepared statements). Worth the latency to escape the cap.
- **2026-05-09** — Production runs on transaction-mode pooler (`:6543`); local dev can stay on either since prod no longer competes for those 15 slots. Code-path single — flip the env var on the host to switch.
- **2026-05-09** — Favourites moved from localStorage (Phase 1) to `user_favorites` Postgres table with RLS (`user_id = auth.uid()`). Hook auto-migrates Phase-1 entries on first load via POST loop, then wipes the localStorage key. Reason: cross-device sync, audit-able, and the public API of `useFavoriteAccounts` is unchanged so no caller churn.
- **2026-05-09** — Category rejection writes the **reason** to `audit_log` before the row is deleted (route writes the audit row directly because `lookup_categories` isn't in the SQLAlchemy `before_flush` listener). Reason: governance — anyone can later see why a proposal was killed and by whom; deleting the row keeps the picker clean for everyone else.
- **2026-05-09** — Unsaved-changes guard via click-capture + `beforeunload` (NOT React Router's `useBlocker` which requires the data router). Reason: avoids migrating `<BrowserRouter>` to `createBrowserRouter` + `RouterProvider` — much smaller change to ship guard on Pre-Sales + Solutioning tabs only.
- **2026-05-09** — Rerun button enabled on docs that are **>90 s old AND still pending/processing**. Reason: hard-disabled state was permanent on EMAXCONNSESSION-style hangs; user couldn't self-recover. Anything older than 90s is either stuck or too far gone to interrupt — let the user re-trigger.
- **2026-05-09** — ESLint migrated from `.eslintrc.cjs` to flat `eslint.config.js`. Reason: ESLint v9 dropped legacy config support entirely; `.eslintrc.*` makes the linter crash with no rules evaluated. Same rules + `ignoreRestSiblings: true` (for the `const {a, b, ...rest}` drop-keys pattern in `serialise()` helpers) + `react-refresh/only-export-components: off` (we deliberately export hooks alongside components).
- **2026-05-09** — `apps/api/uv.lock` committed. Reason: Render's `uv sync --frozen` build command requires it; refusing to deploy without a lockfile is correct production behaviour (no surprise version drift).
- **2026-05-09** — Render API pool downsized to 3 base + 7 overflow = 10 max (was 10+20=30) when on session-mode pooler. Reason: 15-client Supabase cap. Tx-mode mode bumps it back to 10+20=30 since the cap is ~200.
- **2026-05-09** — Audited and committed pre-existing TypeScript / ESLint warnings before deploy. Reason: CI's `--max-warnings 0` flag is a hard gate; one warning blocks the entire deploy pipeline. Fixed AuthProvider's `let unsub` → `const`, useMemo deps `[authUser, meQuery]`.

### M11–M15 — Sales Handoff + CS Onboarding + Goals (2026-05-11 → 2026-05-12)

- **2026-05-11** — Trial / POC fields rolled back from `account_solutioning` in `0021_drop_solutioning_trial_fields.sql`. Reason: user confirmed the v20 prototype's Solutioning page UI doesn't include trial/POC fields — they were sourced from the prototype's account-data objects but never rendered. Kept the `locked_at` / `locked_by` lock columns since `passSolToHandoff` IS in the prototype.
- **2026-05-12** — Pre-Meeting Brief promoted from a collapsible inside Pre-Sales to its own top-level tab (`/accounts/:id/brief`). Reason: matches the prototype's "Account Kit" model where Brief is one of the named sub-tabs. Promotion keeps the editor component unchanged; just adds a route and a slim shortcut card on Pre-Sales.
- **2026-05-12** — **Additive over restructure** chosen for Phases 3–5. Sales Handoff / CS Onboarding / Goals ship as new top-level tabs in the AK02 nav, not as sub-tabs inside an "Account Kit" container. Reason: less disruptive than rewriting the routing + nav; sub-tab restructure can be a follow-up if the team prefers the prototype's exact shape.
- **2026-05-12** — Signing event is a structured POST (`/accounts/:id/sign`), not a free-form PATCH. Reason: signing is a milestone, not a mutable field. Forces a single audit trail entry per signing decision and a single point to compute derived dates (renewal, VDD due).
- **2026-05-12** — Renewal + VDD due dates are **stored**, not derived on read. Reason: queryable / sortable on the account list without joins. Recomputed in the route handler whenever `/sign` fires; `gate_unlocked` is the signal that they may be stale until re-confirmed.
- **2026-05-12** — `Custom` contract terms leave `gate_renewal_date` null instead of guessing. Reason: less wrong than picking an arbitrary year count. UI shows "—"; follow-up could expose a manual renewal-date input for Custom.
- **2026-05-12** — Signing unlock is **admin-only** (`is_global_admin`). Reason: every unlock should land under a director-grade user in the audit trail. VP Sales can sign but can't unlock — the asymmetry is intentional.
- **2026-05-12** — Solutioning lock now auto-snapshots `value_definition` into `sh_value_from_solutioning` on first lock; subsequent re-locks (after unlock) preserve the prior snapshot. Reason: Sales's edits during the unlock window mustn't be clobbered just because Solutioning re-passes.
- **2026-05-12** — Solutioning PATCH split by field ownership: `sol_fields` (value definition) gated by lock + `can_write_solutioning`; `sh_*` fields gated by `can_write_sales_handoff`, no lock check. Reason: post-lock the value definition is read-only but the sales-side context fields are the whole point of the post-lock flow.
- **2026-05-12** — CSM-side handover checklist on CS Onboarding (M14) is **stored separately** from the Sales-side checklist on Sales Hand-off (M13). Reason: two-sided handshake. The Sales side says "we delivered this"; the CS side says "we received it." Combining into one jsonb keyed by side was rejected as over-engineering for four items.
- **2026-05-12** — Three CS stakeholder roles (Budget Owner / Champion / Category Manager) stored as a flat jsonb on `accounts.cs_stakeholders`, NOT as rows in `client_contacts`. Reason: the 3-role map is a fundamentally different concept from the broader Client Contacts list (which has many people). Partial-role updates MERGE per-field in the route handler so concurrent edits across roles don't race.
- **2026-05-12** — Goals stored in a new `cs_goals` table with phases + initiatives + history as JSONB (not normalized into sub-tables). Reason: the prototype iterates these field-by-field constantly; normalization would force a migration sweep every time. Pydantic enforces shape at the API boundary. When cross-account queries on individual initiatives become a real need, we'll normalize.
- **2026-05-12** — `cs_goals.history` is **separate** from the global `audit_log`. Reason: `audit_log` captures field-level DB writes via the SQLAlchemy event listener (mechanical). `cs_goals.history` captures business-level events — `phase_a_completed`, `soft_deleted`, `restored` — written intentionally by the route handler. Both coexist; the Goals tab renders only `history`.
- **2026-05-12** — Goal `alignment_status` **auto-derives** from the three `*_complete` flags on PATCH unless the caller sends an explicit status. Reason: most callers (including the UI's "mark complete" checkbox) shouldn't have to compute alignment; the explicit-override escape hatch covers out-of-order signoffs.
- **2026-05-12** — Goal soft-delete requires a `reason` (5–600 chars), enforced by both Pydantic AND a DB CHECK constraint (`chk_cs_goals_delete_has_reason`). Reason: the audit trail is only useful if reasons are non-trivial. Belt-and-braces in case a direct DB write skips the API.
- **2026-05-12** — Goal restore is **admin-only**, not in the regular CS write set. Reason: deleting a goal is reversible; reversing the deletion should land under a director-grade user. Matches the M13 signing-unlock asymmetry.
- **2026-05-12** — `api.delete()` extended to accept an optional body. Reason: needed for `/cs-goals/:id` soft-delete which carries the mandatory reason. DELETE with a body is valid HTTP (used by Elasticsearch APIs etc.); the existing `request<T>()` already supports the shape.
- **2026-05-12** — Scope cache (`apps/api/app/core/scope.py`) `_FIELDS` whitelist extended with the new `gate_*` (M13) and `cs_*` (M14) columns. Reason: cached account rows must include the new fields or AccountDetail returns nulls for them. Forgot this on the first run of M13; tests caught it with `gate_signed: Input should be a valid boolean [input_value=None]`.
- **2026-05-12** — `_hard_clear` test helper soft-deletes residual goals at the start of each test rather than asserting exact counts. Reason: cross-test DB state accumulates because we never hard-delete (soft delete keeps history). One test was rewritten to do id-based existence assertions instead of count-based; pattern propagated to the rest.

### M16 — MoM → Multi-screen Field Extraction (2026-05-12)

- **2026-05-12** — `.doc` (legacy binary Word) handled at upload by accepting the extension but raising a friendly "Open in Word and Save As .docx" `ExtractError` in the extractor. Reason: there is no reliable pure-Python `.doc` parser, and shelling out to `antiword` / `libreoffice` on Render would balloon the container image. The friendlier-than-rejection-at-upload approach lets the doc still get stored if the user wants it on record, then surfaces the actionable next step in the error message.
- **2026-05-12** — `.eml` parsing prepends a `=== HEADERS ===` block (From / To / Cc / Subject / Date) before the body. Reason: SDR-prepared MoMs put a lot of context in the email headers (who's running the call, who's invited from the Sales/Solutioning team, when it's happening) — without prepending them, Claude doesn't see this signal and stops surfacing Beroe-side attendees in the brief output.
- **2026-05-12** — `MomExtractionResult` schema **reuses** the existing `Attendee` / `SnapshotStat` / `NewsItem` / `PublicSignal` / `ValueAnchor` / `EmailInsight` shapes from `meeting_brief.py` rather than defining parallel "Extracted*" mirrors. Reason: lets `MeetingBriefUpdate(**extracted_brief.model_dump())` apply directly without translation. If the brief schema evolves later, the extraction shape evolves with it automatically.
- **2026-05-12** — All nested extraction shapes use `model_config = ConfigDict(extra="allow")`. Reason: matches the per-category extra-fields pattern in M15 (Goals); future prompt revisions can add fields like `engagement.trigger_intel_summary` or `account_fields.gics_subsector` without a schema bump.
- **2026-05-12** — `is_internal_beroe` is a contact-level flag in the extraction payload, NOT a separate "beroe_team" array. Reason: keeps the UI logic single-collection (one contacts list, with internal rows disabled-by-default). The model is also asked to set `is_internal_beroe=true` for "Presence of internal MI Team" rows, so the prompt handles the SDR-template's most common Beroe-staff disclosure without a separate parsing pass.
- **2026-05-12** — Extraction endpoint is **view-gated** (`can_view_account`), not write-gated. Reason: extracting is read-only — it returns a payload, doesn't mutate state. The actual writes go through the existing PATCH `/engagement` / PATCH `/brief` / POST `/contacts` endpoints, each of which keeps its own write RBAC. This means a Solutioning Manager (view-only on engagement per matrix Q3) can still preview what an MoM would populate, but the Engagement section will 403 on apply — surfaced inline as a section-error pill.
- **2026-05-12** — Extraction is billed against the **same** `ai_quota` cap (`claude_user_daily_limit = 200/UTC-day`) shared with doc-summarise + quality-check. Reason: one user, one bucket. Easier to reason about than per-endpoint sub-caps. Matrix Q5 answered "yes, cap usage" without specifying per-function buckets.
- **2026-05-12** — Real-Claude failure path falls back to the **deterministic stub**, not to a hard error. Reason: a degraded result is more useful than a broken modal. The `is_stub=true` flag + amber "Stub AI" chip in the UI makes the degradation visible without breaking the flow. Same pattern we use in `summarise_document` and `aggregate_account_summary`.
- **2026-05-12** — Frontend fan-out apply uses `Promise.allSettled` (not `Promise.all`). Reason: one failing section shouldn't roll back the others. Engagement-PATCH 403 doesn't kill the parallel brief-PATCH or contacts-POSTs. Each section reports its own outcome via the per-section status pill.
- **2026-05-12** — Contact 409 (unique-email collision) counted as **skipped**, not **failed**, in the fan-out reporter. Reason: 409 on a known duplicate is the correct behaviour (BRD says emails are unique-per-account); presenting it as a failure would falsely alarm the CSM. The status message reads e.g. `Created 3 contacts (1 skipped — already exists)`.
- **2026-05-12** — Extraction call cache key is `sha256(model + text)`, NOT keyed on document_id. Reason: re-uploading the same MoM to a different account (rare but possible) hits the cache and saves an Anthropic call. The cached result is `model_copy(update={"document_id": ...})` before return so the caller always sees the right ID. Cache TTL 24h, single-process in-memory; swap to Redis if extraction frequency grows.
- **2026-05-12** — Account-header fields (industry / country / annual_revenue / tier_band / sf_link) are surfaced in the modal as **read-only chips** even though the AI extracts them — no scalar PATCH on `accounts` exists yet. Reason: the M16 ship was scoped to a single milestone. Tracked as M16.1 in ⏳ Up next; landing a five-field PATCH is straightforward but warranted its own RBAC review.
- **2026-05-12** — Filename match between MoM and account name **not used**. Reason: stakeholder feedback was unambiguous — "after creating the account then only will go inside and upload the mom so account name is not a problem." The MoM is uploaded INSIDE an already-created account context, so the account_id is known from the URL. Removed the need for fuzzy filename → account matching that an earlier design contemplated.
- **2026-05-12** — **No "Extract fields" button.** Stakeholder feedback: "after uploading and processing, do the extraction that time itself. don't make user to click extract fields and all. only one click [the upload] populate all the values." Refactored: Celery worker auto-runs `extract_from_mom()` after AI summarisation, persists to `documents.mom_extracted_fields` jsonb (migration 0026). Frontend's existing 1.5s polling sees the column land → one-shot applies engagement+brief as dirty drafts + auto-creates contacts. Manual `/extract-fields` endpoint retained as a no-cost API surface (24h cache makes it free for re-calls after the worker already ran).
- **2026-05-12** — Per-doc `awb:extraction-applied:<doc_id>` localStorage flag prevents double-create on reload. Reason: if a CSM reloads mid-flow, the frontend would otherwise re-POST the same contacts (they'd 409 as duplicates and report "skipped" — correct but noisy). Set the flag synchronously before the async work starts (via sessionStorage) and persistently after (localStorage), so re-entry is impossible even with rapid invalidations.
- **2026-05-12** — Worker extraction step exception is **logged + swallowed**, not raised. Reason: same pattern as the VPD candidate extraction — a failure during the optional structured-fields step must not fail the parent AI summary job. If MoM extraction breaks, the doc still gets a summary; user can re-run later.

### M17–M27 — Account Kit + Success Mgmt + Growth & Pipeline (2026-05-12 → 2026-05-17)

- **2026-05-12** — Top-level account nav reduced from 9 flat tabs to 5 themed groups: Overview · **Account Kit** (orange) · **Success Management** (pink) · Contacts · Value Def — plus **Growth & Pipeline** (emerald) added in M26. Reason: 9 tabs were unmaintainable in the prototype and tested poorly with stakeholders. Each group has a coloured pill-strip sub-tab inside, mirroring the prototype's information architecture. Back-compat redirects preserved every old URL.
- **2026-05-12** — Layout pattern standardised across the three group layouts (`AccountKitLayout`, `SuccessManagementLayout`, `GrowthPipelineLayout`): pill sub-tab strip with NavLink active state + `<Outlet context={{ account }} />` re-pass. Reason: zero per-leaf-tab data fetching for the account header; layout owns one fetch, leaves consume via `useAccountFromLayout`.
- **2026-05-12** — Three-lock Success Contract (M19) gated by `success_contract_locked_at` + `success_contract_locked_by`. Same pair-CHECK pattern as M13/M22/M23 unlock. Auto-draft on first GET pulls value_narrative / measure_owner / measure_freq seeds from solutioning + handoff fields. Reason: CSMs landing on a blank form go cold; pre-filled seeds turn a 5-minute task into a review-and-confirm.
- **2026-05-12** — PATCH-with-null pops the key on the jsonb merge in M19/M22/M23 (not just sets it to None). Reason: dict-with-None-values keeps the column "non-empty" so the auto-draft branch in GET wouldn't fire on a fully-reset contract. `has_data = any(v for v in sc.values())` plus pop-on-None gives the right idempotent reset semantics.
- **2026-05-12** — `success_metrics.status` (M20) derives server-side from `current_value` / `target_value` rather than being stored. Quantitative: parse `$2M` / `80%` → `pct = cur / tgt` → `≥0.8 green / ≥0.5 amber / else red`. Qualitative: `high → green`, `medium / med → amber`, `low → red`. `status_override` (admin/CSM short-circuit) takes precedence; blank current → grey. Reason: status is the cheapest possible derived value — storing it would invite drift between target/current/status; derivation is per-render and free.
- **2026-05-12** — M20 migration uses DO blocks for enum creation (`do $$ begin create type ... exception when duplicate_object then null; end $$;`). Reason: Postgres has no `CREATE TYPE IF NOT EXISTS`, and idempotent migrations are mandatory in this project (every migration script is re-run-safe).
- **2026-05-12** — M21 Checkpoints `auto-schedule` is **idempotent** — only inserts the standard cadence (Kickoff / MBR / QBR / Renewal) for types not already present. Renewal date prefers `gate_renewal_date - 14d` (M13 signing) over `signed_date + 335d` fallback. Reason: re-running the button after signing-unlock-resign cycles must not duplicate rows; preferring the contract-derived renewal date keeps the calendar accurate when terms get amended.
- **2026-05-12** — Signed-off checkpoints (M21) are permanent evidence: PATCH and DELETE return 409. Same invariant as M13 signing-lock + M19 contract-lock + M22 VDD-lock + M23 outcome-set. Reason: the audit trail is only useful if it can't be retroactively rewritten by the CSM who wrote it; admin re-open is the only escape hatch.
- **2026-05-12** — `value_delivery_document` (M22) auto-draft on first GET pulls from M19 success_contract narrative (newline-split → strategic_priorities), M20 success_metrics (snapshot → agreed_success_metrics), and M15 cs_goals.initiatives (→ approach + value_delivered). Reason: the VDD's whole point is to consolidate everything that's already in the system; making the CSM retype it would undermine the value proposition.
- **2026-05-12** — M23 mutations use `copy.deepcopy(real.delivery_renewal or {})` instead of shallow `dict(...)`. Reason: shallow copy + in-place mutation of inner dicts left old/new graphs **value-equal** so SQLAlchemy's change detection skipped the UPDATE — caught by the red-flag resolve test that intermittently showed the flag as still-open even after a successful resolve POST. Pattern propagated to add_red_flag + patch_dr.
- **2026-05-12** — Outcome on M23 is one-shot (409 on re-set). Admin re-open clears the stamp. Reason: setting the renewal outcome is a Big Deal — it feeds the leadership forecast tier. Asymmetric escape hatch (CSM sets, only admin reverses) keeps the gate consistent with M13/M19/M22.
- **2026-05-17** — M25 rollups attached via two batch queries (cs_goals counts per account + checkpoints per account), not N+1 row-by-row. Reason: 600-account page would have made the list page unusable. Two extra queries regardless of page size; dr_outcome comes free off the row.
- **2026-05-17** — M25 alignment rollup logic: aligned_count == total → green; any aligned or partial → amber; all not_started → red; no goals → null. Reason: keeps the indicator scannable in the list view. Stakeholders look for "amber means in-progress" rather than precise percentages on the list.
- **2026-05-17** — M26 Appetite Score is a faithful port of prototype `calcAppetiteScore`: Health 40% + Signal mix 25% + Renewal proximity 15% + ARR growth 20% → 0..100 → rescue ≤39 / retain 40..69 / expand ≥70. Vocab mapping table (`_TIER_MAP`, `_TYPE_MAP`) bridges our `tier`/`account_type` to the prototype's T1/T2/T3 + Hyper/Standard Growth / Retention naming so the `ARR_TARGETS` table keeps working without rewrite. Reason: the appetite score is the single most-discussed mechanic in the prototype; faithful port avoids re-explaining the math to every stakeholder review.
- **2026-05-17** — M26 signal-mix component left as a `15` placeholder until M27 ships soft_signals — then the real `pos_share>50%→25 · neutral>50%→15 · risk>50%→8 · critical>30%→0` curve. Reason: keeping the appetite math live while the signals table was being designed; switching it on landed cleanly in `0036_signals_activities.sql` + `services/appetite.py` rewrite.
- **2026-05-17** — M27 signal resolution requires a `resolved_note ≥ 5 chars` enforced via both Pydantic (`Field(..., min_length=5)`) and DB CHECK (`chk_soft_signals_resolution_consistent`). Reason: same belt-and-braces pattern as M15 cs_goals soft-delete reason. Resolution audit value is only there if the note is non-trivial; a "fixed" one-word note is worse than nothing.
- **2026-05-17** — M27 `account_activities.linked_metrics` is a `uuid[]` reference, not a join table. Reason: an activity links to ≤5 metrics in practice; an array column avoids a join table for what is a denormalized data view. If we ever need cross-account "which activities touched metric X" queries, we'll add a GIN index on `linked_metrics`.

### Sprint-1 bug-fix pass (2026-05-17)

- **2026-05-17** — Reassign owner widened to `{admin, cs_director, vp_csm, vp_sales}` (was admin-only). Reason: stakeholder bug tracker says CS Director + VPs need to reassign for routine owner-handoff (e.g. when a CSM leaves the team). Re-tightens the **2026-05-08** matrix-narrative decision; the new allow-list is defensible because every reassign is audited by the existing SQLA before_flush listener.
- **2026-05-17** — Sidebar pinned with CSS (`sticky top-0 h-screen self-start`) rather than `position: fixed`. Reason: avoids having to add a left padding to `<main>` to compensate for the fixed sidebar; the flex layout already gives the right column the remaining width — sticky just locks the aside to the viewport height so its inner footer stays visible.
- **2026-05-17** — Contact dedup enforced on **name OR email**, case-insensitive trim. Frontend preflights (Save button disables); backend `create_contact` adds a server-side name-clash 409 (email already covered by the unique index). Reason: stakeholder bug observed "silent duplicates" — the existing email-only index let same-name no-email rows through; doubly-checking both fields removes the gap without adding a second DB constraint (kept the column nullable for emails-not-yet-collected).
- **2026-05-17** — `extract_text` now handles `.csv` / `.md` / `.markdown` as UTF-8 plain text (no markitdown). Reason: stakeholder bug listed these as required upload formats. CSV is read-tabular by Claude already; markdown is a text format. Bundling them under the `.txt` decode path keeps the extractor footprint flat — no new deps.
- **2026-05-17** — Paste-text upload wraps clipboard content as a synthetic `pasted-{kind}-{ts}.txt` `File` and pushes through the regular `handleFiles` pipeline (not a separate paste endpoint). Reason: one upload path = one bug class. Celery, AI summarisation, MoM/VPD extraction, document table — all the existing plumbing fires automatically; reviewers don't need to learn a new flow.
- **2026-05-17** — `KindUploadCard` upload affordance disabled when `data.is_editable` is false. Reason: stakeholder bug 1 — "Upload option needs to be disabled" for roles that can't write. The endpoint already returned `is_editable` derived from `can_write_documents(role, kind)`; just needed the frontend to honour it.
- **2026-05-17** — `documents.notes` (Bug 3) added as a free-text column rather than reusing `ai_summary_text`. Reason: notes and AI summaries are separate concerns — the AI summary changes on re-run, but human-written notes shouldn't. Distinct field also keeps the AI-tag lifecycle (`ai_edited` → `ai_assisted`) clean since notes aren't ai_edited material.

### M28 — External Intelligence (2026-05-17)

- **2026-05-17** — Intel-news category enum → soft-signal type map hardcoded in `routes/intel_news.py` (`_CATEGORY_TO_SIGNAL_TYPE`): financial_performance/regulatory/risk_geopolitical → `risk`; supply_chain → `critical`; expansion_capex/m_and_a → `expansion`; sustainability/digital → `positive`; product_innovation/supplier_strategy → `neutral`. Reason: the prototype `pushNewsAsSignal` does the same mapping. Reasonable defaults for sprint-1; will become editable once stakeholders surface edge cases.
- **2026-05-17** — Push-as-signal is **idempotent**: second call returns the existing `signal_id` without creating a duplicate. Reason: the CSM might click the button twice (debounce edge case) or revisit the modal. Idempotency keeps the signals feed clean.
- **2026-05-17** — Intel-news AI generation uses the shared `_doc_cache` from `services/claude.py` (24h TTL, sha256 key on `intel|model|account_name|industry`). Reason: same caching infrastructure as MoM extraction + VPD goals extraction; no separate cache to maintain.

### M29–M31 — Intelligence & Reports (2026-05-17 → 2026-05-18)

- **2026-05-17** — Intelligence + Analytics surfaces live in **one** `accounts.platform_intel` jsonb column rather than 8 separate tables (cat_intel, supplier_watch, abi, benchmark, engagement, nps, usage, modules, super_users). Reason: data shape evolves with the prototype every iteration; cross-account queries on these sub-fields aren't a sprint-1 need (the surface is read 1:1 by the Intelligence tab); the ETL pipeline (v1.1) writes one big JSON blob per account on a schedule, which fits a single column cleanly.
- **2026-05-17** — Sample seed content on Mondelez + Siemens via migrations 0039–0040 carries through to QBR/MBR/Utilization report HTML (M31). Reason: the same column is the source of truth — when real telemetry lands, every screen + every report picks it up via the existing `GET /platform-intel` endpoint with no further code changes.
- **2026-05-18** — Analytics charts ship as **inline SVG** instead of Chart.js. Reason: keeps the bundle lean (no ~200kB chart dependency), avoids React-Chart.js interop quirks, and the chart vocab needed (line / multi-line / bar / donut) is small enough to write directly. Trade-off: no built-in interactivity (tooltips/zoom) — adequate for stakeholder review; can upgrade to Recharts later if needed.
- **2026-05-18** — Reports HTML generation is **server-side string concatenation**, not Jinja templates. Reason: the templates are small (~150 lines each) and inline-styled for portability; no external template-engine dependency. PPT/PDF export (v1.1) will need `python-pptx` and `reportlab` and can keep the same data-fetch shape.
- **2026-05-18** — `DOC_MATERIALS` lives as a frontend constant (`apps/web/src/types/doc_materials.ts`), not a DB table. Reason: it's a static catalog of Beroe product collateral, not customer data. Updating it is a code commit; same as the prototype.

### M32 — Home tab + nav consolidation (2026-05-18)

- **2026-05-18** — Top-level account nav reduced from 7 entries (Overview + Account Kit + Success Mgmt + Growth + Intel + Contacts + Value Def) to **exactly 5** matching the prototype (Home / Account Kit / Success Mgmt / Growth / Intel). Reason: prototype line 2784 is canonical. Contacts + Value Def belong inside their workflow context (Pre-Sales / Solutioning respectively), not as top-level distractions.
- **2026-05-18** — Contacts kept as a fully-routed page (richer than the prototype's inline list) and reached from a **shortcut card on Pre-Sales** rather than a top-level tab. Reason: we built more than the prototype here (sortable columns, SPOC/sponsor pinning, soft-delete + 30-day restore). Throwing that away to match the prototype's simpler shape would lose value. Funnel + reach via the workflow stays prototype-faithful.
- **2026-05-18** — `/value-def` redirects to `/account-kit/solutioning` rather than being a thin alias. Reason: prevents future drift — there's one place for value definition (`account_solutioning.value_definition`) and one URL for it. Old bookmarks keep working via the redirect.
- **2026-05-18** — Home tab is **client-side composition** of existing endpoints — no new backend route. Reason: every block on Home (Priority Action, This Week, Top Signals, Pipeline, Activity, Health bar) is a derived view of M19–M28 data. A dedicated `/home-summary` endpoint would be a duplication; running 7 parallel queries via TanStack Query is faster on a cold tab and degrades gracefully when any single fetch errors.
- **2026-05-18** — Priority cascade hardcoded in the frontend (entry → overdue CP → held-no-signoff → red flag → no value → no checkpoints). Reason: same logic as the prototype's `bHome` priority cascade. Future configurability (per-account rule overrides) is a v1.1 backlog item.

### M33 — Account-header trio (2026-05-18)

- **2026-05-18** — Replaced 5-card KPI strip (ACV / Renewal / Health / Tier / Category) with the prototype's **3-piece trio** in the header (Period selector · Health badge · Mode pill). Reason: prototype line 2807-2812 is canonical, and the displaced KPIs already live on Home as the 4 KPI tiles + in-context on individual tabs (Account Kit shows tier/category; Home shows ACV + renewal). No information lost; less header clutter.
- **2026-05-18** — Period state persisted in `localStorage` under `awb:account-period` (not in URL query string). Reason: URL noise — every navigation would carry `?period=90d` clutter. `localStorage` is per-device; `storage` event listener keeps multiple tabs in sync. Cross-device sync is a v1.1 nice-to-have.
- **2026-05-18** — Period scaling implemented as **Option A** (client-side multiplication: 30d → ÷3, 90d → 1, FY → ×4) in `AnalyticsTab`, matching prototype `periodScale()` exactly. Reason: backend doesn't have time-series telemetry yet (`platform_intel` carries 90d-baseline + 12-month series as static JSON). Option B (server-side `?period=` filtering against real time-series) lands when the v1.1 ETL ships. Frontend swap will be a 5-line change.
- **2026-05-18** — Mode pill fetched at the layout level via `GET /appetite-score` rather than re-fetched per sub-tab. Reason: stays consistent across navigation; single TanStack Query cache entry shared with `AccountPlanTab`. Invalidated when signals or plays mutate (M27 push-as-signal flow).

### Data-wiring audit (2026-05-18)

- **2026-05-18** — Audit pass over every frontend `.tsx` for suspicious hardcoded literals. Method: regex sweep for customer names, $-amounts, percent strings, trend words, ratings. 13 hits found; 11 were input placeholders / scoring weights / static collateral; **2 were genuine hardcoded data** values — both fixed in this commit. Reason: confidence check before real customer data lands. Without this, demo accounts hide stale literals; once ETL ships those literals would conflict with real data.
- **2026-05-18** — Telemetry-side Abi fields (`usage_trend`, `avg_feedback`) carried via the existing `extra="allow"` on the Pydantic `AbiIntel` model rather than adding strict schema fields. Reason: low cost to add, but it sets a precedent — telemetry fields evolve faster than core schemas, and `extra="allow"` is exactly the relief valve for that. Frontend reads with a type-safe `?? "—"` fallback so an empty seed doesn't render fabricated values.
- **2026-05-18** — `docs/DATA-WIRING-AUDIT.md` is the canonical per-screen data-source manifest. Reason: stakeholder ETL conversation needs a single doc to point to. Re-runnable regex commands at the bottom so the audit can be repeated as new screens land.

---

## Known issues / pinned bugs
_(none yet)_

---

## Stakeholder notes
_(reserved for manual notes from product/business stakeholders — not auto-edited)_

---

## How to update this file

Updated at the end of every milestone by Claude Code. Steps:
1. Move completed items from 🚧 → ✅ with link to FUNCTIONAL.md.
2. Add the next milestone to ⏳.
3. Append any new decisions made during this milestone (chronological).
4. Add any new known issues.

Never delete history. The decisions log is append-only.
