# M14 — CS Onboarding (Entry + Stakeholders)

## What it does

Adds the **CS Onboarding** tab — the CSM-side handshake after Sales hands off the account. Two entry paths (clean handover vs mid-contract pickup), a CSM-side handover checklist that mirrors Sales's checklist for a two-sided verification, and a three-role stakeholder map (Budget Owner / Day-to-day Champion / Category Manager) the CSM must complete before goal validation (M15) unblocks.

Mirrors the v20 prototype's "CS Onboarding" sub-tab inside the Account Kit. Like M13, we ship it as a top-level tab in the AK02 nav per the additive strategy chosen at the start of the Phase 3–5 sequence.

## Four concrete deliverables

### 1. Entry-type picker (CS-A)

Always-visible card with two big choices:

- **Entry A — Clean handover.** Requires `gate_signed=true`. Disabled with a hint until Sales has signed.
- **Entry B — Mid-contract pickup.** Always available — lets a CSM record baseline context on an unsigned account they're inheriting.

Picking either activates the rest of the tab (`activated = gate_signed || cs_entry_type='B'`). Click saves instantly via PATCH; no sticky save bar for this control.

### 2. CSM-side Handover Checklist (Entry A only)

Same four items as the Sales-side check in M13:
- Savings target defined
- Key stakeholders named
- Agreed categories listed
- Success metric indicated

Stored as `cs_handover_checklist` jsonb. Toggles save instantly. The Sales-side handshake lives on the Sales Hand-off tab — both columns must align for a "complete" handover.

### 3. Mid-contract baseline (Entry B only)

Two textareas (`cs_entry_b_context`, `cs_entry_b_goals`) — captures the facts of an inherited account. Don't perfect, just record. Goes through the standard sticky-save dirty-pulse pattern.

### 4. Stakeholder Map (3 mandatory roles)

Three role cards in a grid, each with name / email / phone:

- **Budget Owner** — signed the contract; renewal decision rests here.
- **Day-to-day Champion** — client SPOC; uses Beroe regularly.
- **Category Manager** — implements initiatives; key voice at QBR.

Partial fills allowed (name only is fine to start). Coverage banner at the bottom shows `N/3 filled` — turns green at 3/3 with a "✓ All three roles named" message. Goal Validation (M15) gates on "named" not "fully filled."

PATCH **merges** partial role updates so concurrent edits across roles don't race. Posting `{commercial: {email: "..."}}` updates the email without erasing the existing name.

## Permission matrix

Mirrors `can_write_engagement` — this is CSM territory.

| Role | View | Edit |
|---|---|---|
| Admin / CS Director / VP CSM | ✓ | ✓ |
| CSM (assigned) | ✓ | ✓ |
| CS Team Manager (team) | ✓ | ✓ |
| Inside Sales Manager (assigned) | ✓ | ✓ |
| VPs (Sales / Solutioning / Inside Sales) | ✓ | — |
| Commercial Owner | ✓ | — |
| Solutioning Manager | ✓ | — |
| CSM (unassigned) | ✓ | — |

## What it doesn't do

- **No reminder cadence** — the stakeholder coverage banner is passive. Alerting a CSM that a role is empty is a follow-up.
- **No contact-to-stakeholder sync** — the three CS roles are stored as a flat jsonb, separate from the broader Client Contacts list. The same person might appear in both; we don't enforce that link yet.
- **No history feed** — unlike M15 goals, CS Onboarding doesn't capture business-level events. Field-level changes still go to `audit_log` via the SQLAlchemy event listener.

## Open questions

- Should we promote the three-role stakeholders into the `client_contacts` table automatically? Pro: one source of truth for "who's the client SPOC?". Con: requires linking + dedup logic and a `cs_role` column there. Leaving as separate-but-connected for now.
- Entry B currently allows long free-text. If multiple CSMs handle the same account it could get messy. May need a "last edited by" surfaced on the card — for now relying on `audit_log`.
