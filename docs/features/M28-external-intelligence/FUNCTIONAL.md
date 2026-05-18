# M28 — Growth & Pipeline · External Intelligence

**Shipped:** 2026-05-17 (commit `273e66f`)

## Why

Closes the third sub-tab of the Growth & Pipeline top-level. M26 shipped Account Plan, M27 shipped Signals & Activity — both were sourced from in-account work. External Intelligence brings outside-the-account context (market moves, regulatory shifts, supplier strategy, M&A) into the same surface so the CSM has one place to translate market news into a SoftSignal that feeds the Appetite Score.

## What the user sees

### Header card
- Title + per-account description
- **🔄 Refresh** button (only for write-access roles) → fires the AI generator. Shows "Last refresh: N new items" feedback. Amber "Stub AI" chip when the stub generator runs.

### Search + filter
- Full-text search box (filters headline + summary + category label).
- **All + 10 category pills** with active-state coloured per the prototype `catCol` palette. Categories: Financial Performance · Supply Chain · Supplier Strategy · Expansion & Capex · Regulatory · Sustainability/ESG · Digital Transformation · Risk/Geopolitical · Product/Innovation · M&A.
- Live result count.

### News cards
Each card:
- Pulsing red dot for `high` relevance (animation matches prototype)
- Category pill (background = 15% tint of category colour)
- Publication + date + `New` chip (violet) + `AI` chip (cyan) when AI-generated
- Headline (clickable toggle for source link details)
- Summary
- Actions row:
  - **→ Push as Soft Signal** (turns into ✓ Signal created once promoted)
  - **👁️ Hide** (soft hide)
  - **✕ Delete** (admin-only hard delete)

### Push-as-Signal integration
Promotes a news item into an M27 SoftSignal via `POST /intel-news/:id/push-as-signal`. The created signal is back-linked from the news item (`signal_id`) so the button correctly flips to "Signal created" and stays idempotent on re-clicks. The M26 Appetite banner re-renders with the new Signal Mix component on the next read.

## Category → signal type mapping

| Intel category | Signal type | Rationale |
|---|---|---|
| financial_performance | risk | Cost pressure → procurement risk |
| supply_chain | critical | Disruptions need immediate attention |
| supplier_strategy | neutral | Informational; not always a signal |
| expansion_capex | expansion | Growth context → expand-mode play |
| regulatory_compliance | risk | Compliance gaps → risk signal |
| sustainability_esg | positive | Aligns with most procurement scorecards |
| digital_transformation | positive | Adjacent investment → adoption signal |
| risk_geopolitical | risk | Self-explanatory |
| product_innovation | neutral | Informational |
| m_and_a | expansion | Bolt-on acquisitions enlarge spend footprint |

`signal_relevance` (high/medium/low) maps 1:1 to signal `impact`.

## RBAC

| Action | Roles |
|---|---|
| View intel news | Anyone with `can_view_account` |
| Add manual item · Refresh · Push as signal · Hide | `can_write_cs_onboarding` (admin / cs_director / vp_csm / assigned CSM / cs_team_manager on team) |
| Hard delete | Admin only |

## Verify

1. Open any account → Growth & Pipeline → External Intelligence
2. Click **🔄 Refresh** → 6 cards land (deterministic seed by account name when no Anthropic key configured)
3. Filter by `Risk Signals & Geopolitical Exposure` → list narrows; pill goes red
4. On a high-relevance risk card click **→ Push as Soft Signal**
5. Navigate to **Signals & Activity** → confirm the new signal lives there with type = risk + impact = high
6. Back to **Account Plan** → Signal Mix component in the Appetite breakdown reflects the shift
