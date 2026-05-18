# M29–M31 — Intelligence & Reports

**Shipped:** 2026-05-17 (M29 `f4f48d9`) · 2026-05-18 (M30 `457452a` · M31 `7d6a1a6`)

## Scope

The fifth (and final) top-level account tab — **📊 Intelligence & Reports** (cyan). Three sections in flow order, each rolled in its own milestone:

| Milestone | Section | What it does |
|---|---|---|
| M29 | Intelligence | 6 sub-tabs of platform telemetry (Category / Supplier / Abi / Benchmark / Engagement / NPS) |
| M30 | Analytics | 8 sub-tabs of deep-dive analytics with Numbers / Charts mode toggle |
| M31 | Documents & Reports | QBR / MBR / Utilization HTML report generation + Materials library |

All three read from a single source — `accounts.platform_intel` jsonb — seeded for Mondelez + Siemens by migrations 0039–0041. When the real Beroe-Live → AWB ETL ships (v1.1 backlog), the same column is overwritten and every screen + every report updates with zero code changes (see `docs/DATA-WIRING-AUDIT.md`).

---

## M29 — Intelligence section

### Sub-tabs

1. **Category Watch** — average time per category-page section + heat-ranked top categories (🔥 hot / 🤝 warm / ⭐ whitespace / ❄ cold) + tone-coloured insights (ok / warn / red).
2. **Supplier Watch** — 5 KPI tiles (Total Tracked + risk-tier counts) + tracked-suppliers table with risk pill per row.
3. **Abi Engagement** — 5 KPIs (Total Queries / Per User / Resolution Rate / Avg Response / Usage Trend) + complexity-mix bars (L1A / L1M / L2 / L3 / L4) + top query types list + insight callout.
4. **Industry Benchmark** — 3-up comparison cards: each metric shows the account value vs the industry average + Above / On Par / Below pill (≥120% / 80–120% / <80%).
5. **Engagement Metrics** — 5 channel KPIs (Alerts / Newsletters / Webinars / Podcasts / Training) + 7-segment user breakdown (Cat. Managers / Buyers / Sourcing / Directors / Exec Team / COE / CPO).
6. **NPS** — score with Promoter / Passive / Detractor band + Voice-of-Customer quotes with sentiment-coloured left border.

Empty-state when `has_data: false`.

---

## M30 — Analytics section

### Numbers / Charts toggle

Every sub-tab has a top-right pill group: `#` (Numbers) vs `📊 Chart`. Numbers mode renders tables; Charts mode renders inline SVG.

### Sub-tabs

1. **Usage & Logins** — Monthly Logins · Monthly Active Users · User Adoption breakdown. Charts: 2 line charts + 1 donut.
2. **Module Activity** — Module sessions + share + 12-month trend per module (MMD / Abi / SD / Downloads / Benchmarks). Charts: donut share + multi-line trend.
3. **Category Watch** — Section-time bar + top-categories bar (heat-coloured).
4. **Abi Intelligence** — KPIs + complexity donut + top query types bar.
5. **Supplier Discovery** — KPIs + 12-month trend line + region donut (EMEA / APAC / Americas).
6. **Supplier Risk** — Risk-tier distribution donut + bar.
7. **Custom Credits** — KPIs + credits-by-level bar + total-credits tile.
8. **Super Users** — Top 5 power-user roster (table-only — matches prototype).

### Period scaling

Reads the 30d / 90d / FY selector from the account header (M33). Scaling rules:

| Sub-tab | Behaviour |
|---|---|
| Usage | Slice 12-month series to last **1 / 3 / 12** months |
| Modules | Current-period totals × scale; 12-month trend chart unchanged |
| Category Watch | Visit counts × scale; section avg-time stays (per-session stat) |
| Abi | Total queries + complexity-mix counts × scale; proportions preserved |
| Supplier Discovery | SD total + region split × scale |
| Supplier Risk | Counts stay (snapshot-level, not period-bounded) |
| Custom Credits | Derives off scaled Abi total |
| Super Users | Per-user logins / CW views / Abi / SD / hours × scale |

Scale factors match prototype `periodScale()`: 30d → ÷3 · 90d → 1 · FY → ×4.

---

## M31 — Documents & Reports section

Three blocks (faithful port of prototype `bDocs`):

### 1. Report generation cards (QBR / MBR / Utilization)

Each card has HTML / PPT / PDF buttons:
- **HTML** — works. Server generates the report; frontend renders the result inside an iframe + offers "Download HTML" (Blob URL).
- **PPT / PDF** — disabled with v1.1 tooltips (need python-pptx + reportlab templates).

| Report | Sections |
|---|---|
| QBR (Quarterly Business Review) | Engagement Scope · Usage Analysis · Category Trends · Abi Usage · Success Metrics · Checkpoint Cadence · Industry Benchmark · Expansion Pipeline |
| MBR (Monthly Business Review) | This Month's Highlights · Open Checkpoints · Success Metrics Snapshot · Action Items |
| Utilization | Adoption Overview · Module-Wise Usage · Top Users (Super Users) |

### 2. Solutioning Proposals
Shortcut link to **Account Kit → Solutioning** rather than duplicating the upload UI — the existing documents pipeline (M7) handles uploads with AI summary + RBAC.

### 3. Available Materials library
6 groups × 3–5 items ported verbatim from prototype `DOC_MATERIALS`:
- Platform Overview · Product Modules · Data & Integration · Subscription Tiers · Use Cases & Case Studies · Training & Enablement

Click **View** on any item → modal with the summary. Static catalog — not customer data; updating it is a code commit.

---

## RBAC across all three sections

| Action | Roles |
|---|---|
| View any sub-tab | Anyone with `can_view_account` |
| PATCH platform_intel | `can_write_cs_onboarding` |
| Generate reports | View access — reports are read-only |
| AI extraction (intel-news refresh on M28 surface) | Write access |

---

## Demo verification

Mondelez + Siemens are seeded with full content via migrations 0039–0041. Stakeholders see populated data on every sub-tab. Empty accounts show the "No platform data yet" empty-state until telemetry lands.
