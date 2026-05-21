# Bug Tracker v3 — 20-May-2026 batch (13 bugs)

Source: `/Users/anandkaliappan/Desktop/Beroe/Bug_Tracker_v3 (1).xlsx`, sheet "Bug Log", rows 34–46. All filed by Harish, all "Account Profile" module.

## Mapping

| # | Sev | Where | Title | Plan |
|---|---|---|---|---|
| H34 | P2 | Home — Risk % | Risk box should show trend / health-decline / checkpoint hints | Enhance tile subline |
| H35 | P2 | Home — ACV | ACV box should show Target / Gap / Pipeline | Enhance tile subline |
| H36 | P2 | Home — Health | Health box should show Product score | Enhance tile subline |
| H37 | P2 | Home — AI Brief | AI Account Brief tile missing | New tile on Home, server-side Claude call |
| H38 | P2 | Home — Account Pulse | Pulse box should expand to Value Tracking link, Adoption %, Modules, Depth/User, Metrics | Convert tile into a richer card |
| H39 | P2 | Pre-Sales | Spell error "Meeting Minutess" → "Meeting Minutes" | Already capitalised in our copy — confirm and clean any stragglers |
| H40 | P2 | Sales Handoff | Success Metrics should be **inline** on Sales Handoff, not a link-only card | Convert R17 shortcut into an embedded metrics summary |
| H41 | P2 | Sales Handoff — Client Signed | After signing, display should surface Modules / Tier / Segment / Subscribers / Confirmed-by / Doc upload | Verify the post-signed display already covers this; tighten where it doesn't |
| H42 | P2 | CS Onboarding — Goal V&A | "What does it mean?" must be clickable & editable inline | The 3 detail blocks on R21 are read-only — make them editable |
| H43 | P2 | CS Onboarding — Goal V&A | "Groundwork" must be clickable & editable inline | Same as H42 |
| H44 | P2 | CS Onboarding — Goal V&A | "Agreed target" must be clickable & editable inline | Same as H42 |
| H45 | P1 | Brief | Brief presentation off; should be auto-generated | Add a "Generate brief with AI" path + improve layout fidelity |
| H46 | P1 | Brief | 8 sub-items: snapshot autogen, Room AI questions, Minefield AI, Objective AI, Discovery category dropdown, Value Anchors AI, Categories tab, Cheat Sheet AI | Server-side `/brief/ai-suggest?section=...` for each section + UI hooks |

## Architecture decisions

- **AI suggestion endpoint**: Rather than build the full AI side panel (deferred per Gap Audit), add a focused `POST /api/v1/accounts/:id/brief/ai-suggest` with `section` param. Returns structured suggestions for one section. Re-uses the Claude wrapper / quota / cache infra already in services/claude.py.
- **Goal V&A inline editor**: The R21 surface (3 detail blocks) lives in `GoalAlignmentRow` inside `CSOnboardingTab`. Make each block editable via PATCH `/cs-goals/:id` on save — existing route accepts `phase_a`, `phase_b`, `phase_c` updates.
- **Home tile enrichment (H34–H38)**: All client-side derivation using data we already fetch on Home — no new endpoints needed except H37's AI brief.
- **Inline Success Metrics on Sales Handoff (H40)**: Embed a read-only MetricsSummary block on Sales Handoff that mirrors the M20 metrics list. New endpoint not needed — re-query the existing metrics list.
