# M18–M23 — Success Management — Functional Spec

**Scope:** Five sub-tabs under the **Success Management** top-level account tab. Owned by the CS team. Shipped 2026-05-12.

| Milestone | Sub-tab | What it does |
|-----------|---------|--------------|
| M18 | Scaffold | The pink-themed sub-tab layout + 5 stub pages |
| M19 | Contract & Goals | 3-lock Success Contract + M15 Goals folded in |
| M20 | Value Tracking | Success metrics with auto-derived status (green/amber/red) |
| M21 | Checkpoints | Kickoff/MBR/QBR/Renewal cadence with immutable sign-off |
| M22 | VDD | Value Delivery Document — 4 sections + lock |
| M23 | Delivery & Renewal | Dual-track view + 3-question readiness + final outcome |

---

## M18 — Scaffold

New top-level **Success Management** tab in the account profile nav (pink). Five sub-tabs in flow order: VDD → Contract & Goals → Value Tracking → Checkpoints → Delivery & Renewal. Each landed as a `SMStub` page initially, replaced in turn by the M19–M23 implementations.

URL pattern: `/accounts/:id/success-management/{vdd|contract-goals|value-tracking|checkpoints|delivery-renewal}`. Direct `/accounts/:id/success-management` redirects to `vdd`.

Visibility gated on `can_view_cs_onboarding` (same gate as the rest of the CS workflow).

---

## M19 — Success Contract (3-lock structure)

The CSM's commitment to the client. Locks once a 3-fold contract is satisfied; admin-only unlock.

**The three locks:**
1. **Primary success metric + unit** (e.g. `$2M documented savings`)
2. **Measurement method** (source / frequency monthly|quarterly|bi-annual|annual / owner)
3. **Value narrative** (≥10 chars, plain English)

**Auto-draft** — On first GET when the contract is empty:
- `value_narrative` ← `account_solutioning.value_definition` (truncated 600 chars), falling back to `sh_value_from_solutioning`
- `measure_owner` ← first comma-separated name from `sh_stakeholder_signoff`
- `measure_source` defaults to `"Validated by {owner} using Beroe data vs actuals"`
- `measure_freq` defaults to `Quarterly`

UI shows an amber **"Pre-filled from Sales Handoff"** badge so the CSM knows the values aren't theirs yet.

**Lock state transitions:**
- `locked_at = null` → in-draft. PATCH allowed.
- `locked_at` set → locked. PATCH returns 409. Unlock first (admin-only).
- POST `/lock` validates all 3 locks satisfied → 422 with `"Cannot lock — missing: primary metric + unit; ..."` if not.

**Goals fold-in:** The pre-existing `/goals` route now redirects to `/success-management/contract-goals`. The sub-tab stacks the Success Contract card on top of the unchanged M15 GoalsTab content.

---

## M20 — Value Tracking

Per-account success metrics — both quantitative ($-figures, percentages, counts) and qualitative (High/Medium/Low).

**Status engine (auto-derived):**
- Quantitative: parse digits-and-dots from `current_value` / `target_value` (so `$2.4M` and `80%` both work) → `pct = current / target`
  - ≥ 0.8 → green
  - ≥ 0.5 → amber
  - else → red
- Qualitative: map `high → green`, `medium / med → amber`, `low → red`
- `status_override` short-circuits the calc (admin/CSM escape hatch for "actually this is amber because of X")
- Empty / blank `current_value` → grey

**Per-metric history** captures every value log + override + edit. Soft delete requires a reason (≥5 chars). Restore is admin-only.

---

## M21 — Checkpoints

The four-checkpoint cadence enforced as a calendar plus an evidence ledger.

**Auto-schedule** (idempotent) — POST `/accounts/:id/checkpoints/auto-schedule` creates the missing standard cadence:
- Kickoff: `gate_signed_date`
- MBR: `gate_signed_date + 90d`
- QBR: `gate_signed_date + 180d`
- Renewal: `gate_renewal_date - 14d` (or `gate_signed_date + 335d` if renewal not set)

Re-running the button after an unlock/re-sign cycle only fills gaps; existing rows are preserved.

**Status flow:** `not_held` → `held` → `signed_off`. Signed-off is permanent evidence — PATCH, DELETE, and re-sign-off all return 409. The sign-off payload writes an immutable `signed_off_snapshot` with the initiatives reviewed, metrics discussed, client acknowledgement, and agreed next actions.

---

## M22 — Value Delivery Document (VDD)

The renewal-conversation source of truth. Four sections + lock + admin-only unlock.

**Sections:**
1. **Client strategic priorities** — free-text list of pillars / themes
2. **Agreed success metrics** — snapshot of M20 metrics (auto-drafted from `success_metrics`)
3. **Beroe's approach per initiative** — one row per initiative with 3-lever savings (cost / risk / adoption) and stage
4. **Value delivered** — CSM-attributed $-rollup per initiative (identified / committed / implemented in $M)

Plus an exec summary textarea at the bottom.

**Auto-draft on first GET** — pulls strategic priorities from `success_contract.value_narrative` (newline-split), metrics snapshot from `success_metrics`, and approach + value_delivered from `cs_goals.initiatives`. Lands as a populated draft the CSM reviews + locks.

**Lock requires ≥1 row in every section.** UI surfaces the missing-section count in the lock button's disabled state.

---

## M23 — Delivery & Renewal

The post-delivery view. Dual-track lifecycle + 3-question Renewal Readiness + final outcome.

**Track 1 — Renewal:** Mini-summary derived from M21 Checkpoints (next type + scheduled date + days-until + overdue count + signed-off count). Read-only — drive it from the Checkpoints sub-tab.

**Track 2 — Expand:** 4-column Kanban (Value Proof → Expand Ask → New Scope → Close). Items can have a name, amount, and a note. **Auto-pauses** when any open red flag exists.

**Red flags** — 4 types: missed_checkpoint, spoc_unresponsive, no_value_logged, escalation. Raised via the panel; each flag has a note. Resolution is one-click (idempotent).

**Renewal Readiness** — three yes/no/unknown questions with proof notes:
1. Did we deliver the metric?
2. Can we prove it with data?
3. Does the client acknowledge it?

Score badge (n/3 yes) updates live as answers flip.

**Final outcome** — single one-shot button: `Renewed` / `At risk` / `Not renewed`. Sets `dr_outcome` + `dr_outcome_set_at/by`. PATCH on the document returns 409 once an outcome is set. Admin re-open clears the stamp.

---

## RBAC summary

| Action | Roles |
|--------|-------|
| View any sub-tab | Anyone with `can_view_account` |
| PATCH all five sub-tabs | Admin, CS Director, VP CSM, CSM-on-own, CS Team Manager-on-team, ISM-on-own |
| Lock M19 Contract / M22 VDD | Same as write |
| Sign off M21 Checkpoint | Same as write |
| Set M23 outcome | Same as write |
| Unlock anything | Admin only |
| Restore deleted M20 metric / M15 goal | Admin only |
