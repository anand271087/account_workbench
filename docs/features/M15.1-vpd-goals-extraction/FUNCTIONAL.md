# M15.1 — AI Candidate-Goals Extraction from VPD — Functional Spec

**Shipped:** 2026-05-12 (commit `9c4ee13`)

## Why

When a CSM uploaded a Value Proposition Deck (VPD), M16-style auto-extraction already filled the Solutioning fields (`extract_vpd_fields`). But the VPD also implicitly contains the **customer-success goals** the CSM will be measured against — saving cocoa costs, consolidating suppliers, mitigating single-source risk. Asking the CSM to retype those into M15 Goals was friction without value.

M15.1 closes that gap: the same upload that fills Solutioning now also extracts candidate Goals and shows a per-row review modal.

## What the user sees

1. Upload a VPD (`.docx`, `.pptx`, `.pdf`, etc.) on the Solutioning tab as normal
2. AI summary completes → violet **Fields populated** badge (existing M16 flow)
3. Below the filename row, a new violet link appears: **"Review N candidate goals →"**
4. Click → modal with N goal rows:
   - Per-row checkbox (low-confidence rows unchecked by default)
   - Editable: title, category dropdown, target_value, target_date, owner
   - Initiatives, rationale, and confidence pill (high/medium/low) shown but read-only
5. Click **Create N goals** → fan-out POST to `/cs-goals`
6. Per-row pills flip ✓ Created / Skipped (409 duplicate) / Failed
7. Close modal → navigate to **Success Management → Contract & Goals** → new rows appear with initiatives attached

## Behind the scenes

- **No new endpoint required at the user level** — the worker auto-runs the extraction; the manual `POST /documents/:id/extract-goals` endpoint exists for re-extraction but the polling-driven flow handles the happy path.
- **Stub fallback** — when no Anthropic API key is configured, a deterministic regex-based extractor splits on bullet lines, classifies by keyword bag, and caps at 6 goals. UI shows an amber "Stub AI" chip when it's running.
- **24h cache** keyed on `sha256(vpd-goals|model|text)` — re-uploading the same VPD doesn't bill twice.

## RBAC

- View modal: anyone with view access on the parent account (extraction is read-only)
- Create goals: per-row write RBAC enforced by the existing `POST /accounts/:id/cs-goals` endpoint (`can_write_cs_onboarding`)
- 409 on duplicate goal title → counted as **Skipped**, not Failed

## Verified end-to-end against real Claude

A Mondelez VPD bullet list:

```
- Save 8-12% on cocoa procurement through benchmark-driven negotiations, targeting $2.4M
- Consolidate supplier base across packaging from 47 to 12 vendors by Q3 2026
- Mitigate single-source risk on three critical SKUs in cocoa supply chain
- Drive Beroe platform adoption across 5 procurement BUs in EMEA
```

Yielded 4 well-classified goals + 2 initiatives under cocoa savings with correct stages (committed, in_flight). `is_stub: false`.
