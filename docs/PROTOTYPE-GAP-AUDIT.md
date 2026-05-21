# Prototype-vs-Shipped Gap Audit

**Run date:** 2026-05-20
**Prototype:** `prototype/beroe_awb_v20.html` (9035 lines)
**Method:** Indexed every top-level `function build*` / `function b<Tab>` in the prototype, grepped `apps/web/src` for the equivalent name / behaviour, then read the prototype source for each unmatched feature to confirm scope.

---

## Information architecture (matches)

| Prototype | Shipped | Notes |
|---|---|---|
| 5 top-level account tabs (line 2784) | ✅ Home / Account Kit / Success Mgmt / Growth & Pipeline / Intel & Reports | M32 |
| Top-right header trio (line 2807-2812) | ✅ Period / Health / Mode pill | M33 |
| Account Kit 5 sub-tabs (line 5756) | ✅ Pre-Sales / Brief / Solutioning / Sales Handoff / CS Onboarding | M17 |
| Success Mgmt 5 sub-tabs | ✅ VDD / Contract & Goals / Value Tracking / Checkpoints / Delivery & Renewal | M18 |
| Growth & Pipeline 3 sub-tabs | ✅ Account Plan / Signals & Activity / External Intel | M26 |
| Intel & Reports 3 sub-tabs | ✅ Intelligence / Analytics / Documents & Reports | M29 |
| Leadership view | ✅ Just shipped (M24, `dd58178`) | — |

---

## Hard gaps — prototype features that have NO shipped equivalent

### 1. AI side panel ("Ask Claude") — high impact
- **Prototype:** `buildAIPanel()` at line 7947 + `buildAIContext()` at line 8007 + `sendAIMessage()` etc. Triggered from contextual buttons all over the app (line 3167 on Success Contract metric, 3710 on goal extraction, 4068 on checkpoint sign-off, 6300+6315 on Goals validation).
- **Behaviour:** Slide-in rail with chat history. Every screen has "💡 Ask Claude" buttons that pre-fill a prompt with the surrounding account context. State: `S.aiPanelOpen`, `S.aiMessages`, `S.anthropicKey`.
- **Shipped:** Nothing equivalent. Document AI summary + MoM/VPD extraction + intel-news generation all exist, but there's no conversational rail.
- **Effort:** Medium (1–2 days). Backend: `POST /api/v1/ai/chat` streaming endpoint that takes account_id + question + prior messages, billed against the same `ai_quota`. Frontend: slide-in panel component + contextual "Ask Claude" buttons on the same screens the prototype has them.

### 2. Global search dropdown (Cmd+K) — medium impact
- **Prototype:** `buildSearchDropdown()` line 7912 + `onSearchInput()` line 7873. Topbar input that searches accounts + signals + contacts as you type.
- **Behaviour:** ⌘K opens, type ≥2 chars, results grouped by entity type with keyboard nav.
- **Shipped:** Nothing — no global search anywhere.
- **Effort:** Small-medium (1 day). Backend: `GET /api/v1/search?q=…` returning grouped hits with RBAC scope applied. Frontend: portaled dropdown wired into AppShell topbar.

### 3. Outbound Email + per-play Email Pitch modals
- **Prototype:** `buildEmailModal()` line 7671, `buildEmailPitchModal()` line 7657. Per-play "Email Pitch" button on Account Plan (line 5644, 7651) opens a composer.
- **Shipped:** Nothing. Account Plan has plays but no email composer.
- **Effort:** Small (half day). Likely just a `<textarea>` modal with subject + body + copy-to-clipboard. No SMTP wiring needed for v1.

### 4. Escalation modal/section (Delivery & Renewal)
- **Prototype:** `buildEscalationModal()` line 4114, `buildEscalationSection()` line 4149. Distinct from red flags — a formal escalation flow.
- **Shipped:** DR tab has red flags (M23 `0033_delivery_renewal.sql`) but no separate escalation. The two may overlap conceptually; need to read prototype carefully to decide if "escalation" = red flag with severity, or a separate channel.
- **Effort:** Small (half day) if it's just a red-flag UX layer; medium if it's a new column with notifications.

### 5. Product & Services Saturation widget (Account Plan)
- **Prototype:** `bProductSaturation()` line 5615+5718. Constants `BEROE_PRODUCTS` (line 1294) + `INDUSTRY_SAT_BENCH` (line 1314). Shows which Beroe modules the account owns, vs industry-average saturation, vs tier upgrade headroom.
- **Behaviour:** Donut + per-module owned/gap grid + industry benchmark dot. Drives expansion plays.
- **Shipped:** Nothing. The Analytics tab has module activity but not the cross-portfolio saturation comparison.
- **Effort:** Small (half day) — pure frontend, data comes from `gate_contract_modules` already on the account. `BEROE_PRODUCTS` is a static catalog (same shape as `DOC_MATERIALS`).

### 6. Metrics thread pane (per-metric history with AI suggestions)
- **Prototype:** `buildThreadPane()` line 1934 + `buildSuggestionEntry()` line 2044 + `buildSourceCountPills()` line 1990. Right-side rail on Value Tracking that for the selected metric shows: full update history, auto-suggested matches from signals, source pill counts (signals, activities, docs).
- **Shipped:** Value Tracking has metrics + Log Value rows + log entry history inline, but no rich thread pane with cross-system suggestions.
- **Effort:** Medium (1 day). Frontend-heavy, but it's a re-arrangement of data we already serve (M27 signals, M27 activities, metric log entries).

### 7. Analytics event banner
- **Prototype:** `buildAnalyticsEventBanner()` line 2137. Above Analytics sub-tabs, shows callouts when significant metric drift / signal landed.
- **Shipped:** Nothing — Analytics goes straight into sub-tabs.
- **Effort:** Tiny (couple hours) — derive from already-loaded metrics + signals.

### 8. VDD upload-and-AI-review modal flow
- **Prototype:** `buildVDDUploadModal()` line 3674 + `buildVDDReviewModal()` line 3730. Lets the user upload a Word/PDF VDD doc, AI extracts sections, review modal lands them into the structured VDD form.
- **Shipped:** Manual VDD editing + auto-draft from M19/M20/M15 (M22), and we just shipped `POST /redraft` (R24). But no doc-upload path — the VDD has to be hand-typed today.
- **Effort:** Medium (1 day). Reuse the existing M16/M15.1 extraction infrastructure with a new prompt + review modal.

### 9. VPD metrics review modal
- **Prototype:** `buildVPDMetricsReviewModal()` line 6501. After a VPD doc lands, this modal extracts candidate **metrics** (not goals) and lets the user pick which to create.
- **Shipped:** M15.1 ships a CS-goals extraction from VPD (`cs_goals_extracted`), but not metrics extraction. The two are distinct — metrics are SMART measurements, goals are higher-level outcomes.
- **Effort:** Small-medium (4–6h). Same pattern as `extract_cs_goals_from_vpd`, swap the prompt + apply target.

### 10. Play → Metric link modal (Account Plan)
- **Prototype:** `buildPlayMetricModal()` line 4182. Lets you link an Account Plan play to a Success Metric so progress on the metric attributes to the play.
- **Shipped:** Plays and metrics exist independently. No linkage UI.
- **Effort:** Small (half day). Could be a free `linked_metric_id uuid` column on `account_plays` + a select-from-existing modal.

### 11. Signal Review modal (AI-extracted batch)
- **Prototype:** `buildSignalReviewModal()` line 7739. When AI extracts multiple soft signals from a source (MoM / intel article), this modal lets the CSM review the batch and approve/discard each.
- **Shipped:** External Intel has per-item "Push as Signal" (M28). No batch-review modal.
- **Effort:** Small (4h). UI-only — backend already supports POST /signals.

### 12. `bLanding` — post-handoff snapshot screen
- **Prototype:** `bLanding()` line 4882. Special screen that surfaces ACV gap / target / signed-date / pipeline / critical signals / hot categories / key TODOs / metrics summary. Renders when the account is in early CS phase (just signed).
- **Shipped:** HomeTab covers most of this, but the prototype's bLanding has some unique tiles (ACV gap calculation, BVD days-left). Could either ship as a new "Onboarding" sub-tab or fold the missing tiles into Home.
- **Effort:** Small (half day) — most data is already on Home; add the 2–3 missing tiles.

### 13. `bDeepDive` — Intel drill-down screen
- **Prototype:** `bDeepDive()` line 4841. A zoomed-in view, likely a drill-down into one of the Intel & Reports sub-tabs.
- **Shipped:** Nothing — uncertain what it adds beyond the existing Analytics sub-tabs.
- **Effort:** Unknown — need to read the full implementation before scoping. Possibly skippable if Analytics + Intel sub-tabs already cover the use case.

---

## Soft gaps — shipped but thinner than prototype

| Area | Prototype delta vs shipped |
|---|---|
| Goals validation buttons | Prototype has "💡 Ask Claude" buttons inline on every Goal (line 6300, 6315) — depend on the AI side panel landing first. |
| Sign-off modal | Prototype shows "💡 What should I document here?" AI prompt button (line 4068). Ours doesn't. |
| Brief print view | Prototype has `bMomBrief()` line 8806 which renders a **printable** brief from the MOM data, separate from the editable form. We only have the editor. |

---

## What's NOT a gap (verified)

- **Renewal Readiness** — present inside Delivery & Renewal tab (M23, line 3424 in prototype).
- **Sign-off modal** — shipped in CheckpointsTab (M21).
- **Mode override modal** — shipped in AccountPlanTab (M26).
- **Sales Discovery Summary** — shipped via Celery `aggregate_account_summary` + OverviewTab card.
- **MoM Brief editor** — shipped as `MeetingBriefEditor.tsx` (M12).

---

## Recommended prioritisation

1. **AI side panel (#1)** — single biggest stakeholder-visible feature. Unlocks #6 (thread pane suggestions) + the embedded "Ask Claude" buttons in #11 / Goals / Sign-off.
2. **Global search (#2)** — small effort, huge UX win across the whole app.
3. **Product Saturation (#5)** — pure frontend over existing data, fast win on the demo.
4. **VDD doc upload + review (#8)** — completes the "AI extracts from your docs" story we sold in M16/M15.1.
5. **Email + Email Pitch modals (#3)** — quick, lands the Growth & Pipeline flow.
6. **Escalation flow (#4)** — depends on whether stakeholders treat red flags as the escalation channel or want a separate one.
7. **Metrics thread pane (#6)** — most impactful Value Tracking UX upgrade.
8. **Signal Review batch modal (#11)** — needed once AI extraction is producing >1 signal per source.
9. Lower-priority cleanup: VPD metrics review (#9), Analytics event banner (#7), Play→Metric link (#10), bLanding tile gaps (#12), bDeepDive (#13 — defer until scoped).
