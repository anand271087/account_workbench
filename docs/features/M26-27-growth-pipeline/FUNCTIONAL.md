# M26 + M27 — Growth & Pipeline — Functional Spec

**Shipped:** 2026-05-17 (commits `d32a094`, `a45a6cb`)

## What's in the top-level tab

New top-level **🚀 Growth & Pipeline** tab (emerald theme) in the account profile. Three sub-tabs in prototype order:

| Sub-tab | Status | What it does |
|---------|--------|--------------|
| Account Plan | **Live** (M26) | Mode banner + Appetite Score + ACV + ARR + Plays |
| Signals & Activity | **Live** (M27) | Soft Signals panel + Activity Feed panel |
| External Intelligence | Stub (M28) | Market + competitor + research intel — placeholder |

Visibility: same `can_view_cs_onboarding` gate as Success Management.

---

## M26 — Account Plan

The plan-of-record for the account. Faithful port of the prototype's `bPlan()` function.

### Mode banner

One of **Rescue** / **Retain** / **Expand** plus an icon, descriptive line, and the appetite score (0..100). The recommended mode is auto-calculated; the CSM can override via **Change mode**.

**Mode boundaries:** rescue 0–39 · retain 40–69 · expand 70–100.

**Hard overrides:**
- `account_type == "Renewal"` capped at retain (never expand)
- Hyper-Growth + low seat-utilization gate (placeholder until seat data ships)

### How is this mode determined?

Expander shows the 4-component breakdown:

| Weight | Component | Score | Derives from |
|--------|-----------|-------|--------------|
| 40% | Health Score | `health_pts/40` | `accounts.health_score` × 0.4 |
| 25% | Signal Mix | `sig_pts/25` | M27 soft signals — see below |
| 15% | Renewal Proximity | `renew_pts/15` | `gate_renewal_date` → days-to-renewal bands |
| 20% | ARR Growth | `arr_pts/20` | M26 plays pipeline vs target by tier/type |

### ACV growth tile

Mode-adaptive layout:
- **Rescue:** ACV at Risk · Days to Renewal · Risk Level
- **Retain:** Current ACV · Target (protect current) · Target growth %
- **Expand:** Current · Target · Gap · Pipeline (sum of prob-weighted plays)

### ARR burn-down

Three tiles + a progress bar:
- Current ACV
- Projected (ACV + pipeline)
- Target (Current × (1 + arr_target_pct))

Status line: `On Track` / `Behind Target` / `Declining`.

### Plays

Each play has: title, value ($USD), prob (0..100 sales stage), when (free text like "Q3 2026"), trigger (one-line why), modes (subset of rescue/retain/expand), role (e.g. CSM, AE). Probability maps to a 10-step ladder from `Accelerated Trials (1%)` to `Closed (100%)` matching the prototype.

Mode filter on the list:
- Default: shows plays tagged with the current mode
- "Show all plays" checkbox: shows all + adds mode pills per row

Add Play modal accepts all fields; multi-mode toggle for plays applicable across modes.

---

## M27 — Signals & Activity

Two side-by-side cards faithful to the prototype's `bStrategyEngage`.

### Soft Signals

Early indicators of risk / opportunity. Drives the Signal Mix component of M26's Appetite Score.

**5 signal types:** Risk · Positive · Expansion · Neutral · Critical (with prototype's exact colour palette).

**Fields:**
- Type, signal (title), description
- Impact: critical / high / medium / low
- Category (optional): commercial / product / strategic / relationship / etc.
- Status: active / resolved

**Resolution:** Click ✅ Resolve → modal demands a note (≥5 chars). Resolution note sticks to the audit trail and renders inline on the row in green.

**Other actions:**
- 👁️ Hide — soft hide (filter from view); admin can un-hide via DB
- ✕ Delete — admin-only hard delete
- ↩ Reopen — admin-only; clears resolution stamp

### Activity Feed

7 activity types matching the prototype: 📞 CSM Call · 🤝 Exec Visit · 📊 QBR · ⚡ Product · 📚 Research · 📝 Internal · 🚨 Escalation.

**Fields:** title, summary, attendees, items (action list), linked_metrics (optional refs to M20 success_metrics).

**Actions:** Log (modal), Delete (soft via hidden flag).

### Appetite score loop

Adding/resolving signals invalidates the M26 appetite query immediately, so the Account Plan banner re-derives the Signal Mix component in real time.

**Signal Mix scoring curve** (mirrors prototype):
- `(expansion + positive) / total > 0.5` → 25 pts (top of band)
- `neutral / total > 0.5` → 15 pts (default)
- `risk / total > 0.5` → 8 pts
- `critical / total > 0.3` → 0 pts (bottom)
- No signals → 15 pts (assume neutral)

---

## RBAC

| Action | Roles |
|--------|-------|
| View any sub-tab | `can_view_account` |
| Add/edit play, set mode, log activity, add signal | `can_write_cs_onboarding` |
| Resolve signal | `can_write_cs_onboarding` |
| Reopen resolved signal | Admin only |
| Hard-delete signal | Admin only |
| Delete play / activity | Same write set (soft via `hidden`) |
