# M25 — AccountList Portfolio Rollups + Renewal Alerts — Functional Spec

**Shipped:** 2026-05-17 (commit `0764eba`)

## Why

The `/accounts` list page was a flat list of accounts with renewal pill + health pill. Once M15 (Goals), M21 (Checkpoints), and M23 (Delivery & Renewal) shipped, the list could surface portfolio-level signal so a CSM Director scanning their book can spot trouble without drilling into individual accounts.

## What changed on the list

### Per-row badges (under the Renewal cell)

1. **Alignment dot** — single coloured circle hover-titled with the goal count.
   - 🟢 Green: every cs_goal on the account is `aligned`
   - 🟡 Amber: some `aligned` or `partial`
   - 🔴 Red: ≥1 goal but all `not_started`
   - No dot when no goals

2. **Next-checkpoint chip** — e.g. `MBR in 10d`. Tone:
   - Slate (default) when more than 7d away
   - Amber when ≤7d
   - Red when overdue (negative days)
   - Falls back to the most overdue checkpoint if no upcoming ones remain

3. **Outcome pill** — `Renewed` / `At risk` / `Not renewed`. Only renders when M23 outcome is set; uses the same colour scheme as the M23 outcome buttons.

### Renewal Alerts Banner

A new amber banner at the top of the list (above the table) when ≥1 account has `days_to_renewal ∈ [0, 60]`. Per-account chips:

- T-7 red — urgent
- T-30 amber — escalating
- otherwise yellow — heads-up

Each chip is clickable and navigates to that account's overview. Caps at 10 visible + `+N more` text.

## RBAC

No change. Rollups follow the same `can_view_account` gate as the list itself — every user only sees rollups for accounts they can already see.

## Verify

1. Pre-condition: pick an account with goals (M15), checkpoints (M21), and ideally a M23 outcome set
2. Open `/accounts`
3. Confirm the alignment dot + next-checkpoint chip + outcome pill render in the Renewal column for that row
4. Set `gate_renewal_date` on any account to ~30 days from today and confirm the renewal alerts banner picks it up
