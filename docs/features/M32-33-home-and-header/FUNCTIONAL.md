# M32 + M33 — Home Tab + Account-Header Trio

**Shipped:** 2026-05-18 (M32 `1aeeee0` · M33 `a9ed678` + period-scaling `7122ccd`)

## Why

Two related changes, both driven by prototype fidelity:

1. The prototype's top-level account nav (`beroe_awb_v20.html` line 2784) is exactly 5 tabs — Home / Account Kit / Success Mgmt / Growth & Pipeline / Intelligence & Reports. Our app had 7 (Overview + 5 + Contacts + Value Def). Trim to match.
2. The prototype's account-header top-right (line 2807-2812) is a 3-piece trio — period selector + health badge + mode pill. Our header was a 5-card KPI strip. Swap to match.

---

## M32 — Home tab + nav consolidation

### Top-level nav (5 tabs)

| Tab | Theme | Visibility |
|---|---|---|
| 🏠 Home | purple | always |
| 📋 Account Kit | orange | gated on `can_view_pre_sales \|\| can_view_solutioning \|\| ...` |
| 🎯 Success Management | pink | `can_view_cs_onboarding` |
| 🚀 Growth & Pipeline | emerald | `can_view_cs_onboarding` |
| 📊 Intelligence & Reports | cyan | always |

Contacts + Value Def removed from the nav. Both still accessible:
- **Contacts** — routed at `/contacts` (no nav entry). Reached from a "Client Contacts → Manage Contacts" shortcut card on **Pre-Sales** (mirrors prototype's inline Client Contacts group at line 5874).
- **Value Def** — `/value-def` URL now redirects to `/account-kit/solutioning` (prototype puts the value-definition field inside Solutioning at line 5956).

### Home tab content

Faithful port of prototype `bHome`. Renders (top to bottom):

1. **Header strip** — Title + Home subtitle + account context (industry · country · tier · type) + mode-coloured pill from `appetite.current_mode` with score.
2. **Priority Action Card** — Cascading priority logic (highest-priority that applies wins):
   - Entry not done → "Complete account entry"
   - Overdue checkpoint > 7d → "X overdue by Nd"
   - Checkpoint held but not signed off → "Get client confirmation"
   - Track 2 paused (red flag) → "Address before expanding"
   - Metrics exist with no value logged → "Log first value"
   - No checkpoints scheduled → "Schedule cadence"
   - CTA deep-links into the right sub-tab via React Router.
3. **4 KPI tiles** — ACV · Renewal countdown · Health score · Open signals count.
4. **🗓 This Week** — Computed client-side (port of prototype `generateThisWeekActions`):
   - Up to 2 critical signals
   - Renewal in ≤90d
   - Up to 2 high-prob plays (prob ≥60)
   - Stale metrics (>30 days since last update)
   - Fallback: "All on track" when nothing urgent
5. **📡 Top Signals** — 3 highest-impact active soft signals from M27 + "→ All signals & activity" deep link.
6. **🚀 Expansion Pipeline** — Plays with prob ≥60 + expand mode + weighted-pipeline total + "→ Full account plan" deep link.
7. **💬 Recent Activity** — Latest 4 from M27 activities (type-coloured icon + summary + date).
8. **Health bar** — Only renders when there's a problem: overdue CP count > 0 OR Track 2 paused. Deep-links to Checkpoints / Delivery & Renewal.

---

## M33 — Account-header trio

Top-right of every account page, in this exact order:

### 1. PeriodBar — 30d / 90d / FY
- Pill group exactly matching prototype `.per-bar` + `.per-btn` styling
- Default 90d
- Persists in `localStorage` under `awb:account-period`
- Multi-tab sync via the `storage` event listener

### 2. HealthBadge
- Score number stacked over coloured status label
- Bands: ≥70 green "Healthy" · 40–69 amber "At Risk" · <40 red "Critical"
- `—` when no score recorded

### 3. ModePill
- Current Appetite Score mode from `GET /appetite-score`
- Rendered with prototype icon + colour: 🚨 Rescue red / 🛡️ Retain orange / 🚀 Expand cyan
- Hover title shows `Appetite 82/100 · Auto-recommended` or `Manual override`

### Period scaling (Option A — wired into Analytics)

The selector wasn't cosmetic — it scales the Analytics sub-tabs client-side, matching prototype `periodScale()`:

| Period | Scale | Behaviour |
|---|---|---|
| 30d | ÷ 3 | Numbers ÷3; Usage table slices to last 1 month |
| 90d | × 1 | Baseline |
| FY | × 4 | Numbers ×4; Usage table shows all 12 months |

A small banner above the sections names the current window so users know what they're looking at.

**Option B** (server-side period-scoped queries) is deferred to v1.1 when the real `platform_intel` ETL ships — we'll add `?period=` query params to the `GET /platform-intel` endpoint and the backend will compute from time-series.

---

## Verify

1. Open any account → top nav has exactly 5 emoji-prefixed tabs (no Overview / Contacts / Value Def)
2. Top-right header shows period pills + health badge + mode pill — visible on every sub-tab
3. **🏠 Home** — Priority Action Card with deep-link CTA; all 4 KPI tiles + 4 cards populated
4. Click 30d / 90d / FY → state persists across refresh; multi-tab sync works (open same account in two tabs)
5. Navigate to **Intelligence & Reports → Analytics** → toggle 30d / FY → numbers shift
6. Visit `/accounts/<id>/value-def` directly → auto-redirects to Solutioning
7. **Pre-Sales** → scroll past Brief card → new "Client Contacts → Manage Contacts" shortcut card opens the rich contacts page
