# AK03.a — Pre-Sales & Solutioning · Engagement Info

## What it does

The Pre-Sales tab on every account profile. Captures everything the team agreed during discovery and solutioning so the rest of the workspace knows the engagement context — what categories the client cares about, what success looks like, who the stakeholders are, and how mature the procurement function is.

The form supports an **AI quality check** on the engagement objective. Click the button and Claude scores the text 1–5 on three things — specific, measurable, value-stated. Below 3 is flagged with a yellow warning the user can dismiss.

## Who uses it

Anyone with view access to the account can see the form. Edit access follows the matrix:

| Role | Can edit Engagement Info? |
|---|---|
| Admin · CS Director · VP — CSM | Yes (all accounts) |
| CSM | Only their assigned accounts |
| CS Team Manager | Only their team's accounts |
| Inside Sales Manager | Only their assigned accounts |
| Solutioning Manager | **No (matrix Q3 — only Solutioning sections)** |
| VP — Sales · VP — Solutioning · VP — Inside Sales · Commercial Owner | View only |

Read-only users see every field but every input is disabled.

## How it works (user flow)

1. User opens an account profile and clicks the **Pre-Sales** tab.
2. The form loads with whatever was saved before (blank if first edit).
3. They edit fields. The form tracks unsaved changes.
4. The **AI quality check** button is available next to the engagement objective. Clicking it returns a 1–5 score plus a short comment.
5. **Save** writes to the database and the activity feed (every changed field appears with old → new in the Overview tab).
6. **Discard** reverts the form to the saved state.

## Fields

| Field | Type | Source | Notes |
|---|---|---|---|
| SDR / lead source | Text | User | Who brought the lead in |
| Pre-discovery date | Date | User | When initial discovery happened |
| Discovery lead | Text | User | Beroe-side lead |
| Sales lead | Text | User | Beroe-side sales lead |
| Target categories | Multi-select + propose new | User · `lookup_categories` | New names appear as **pending** until an admin approves |
| Engagement objective | Long text | User | **Yellow warning if < 120 words** · AI quality check available |
| Procurement maturity | Low / Medium / High | User | |
| AI penetration | Low / Medium / High | User | |
| Procurement spend ($M) | Number | User | Up to 4 decimals |
| Geographies | Multi-select | User · `lookup_geographies` | |
| SPOC | Text | User | Single point of contact |
| Sponsor | Text | User | Executive sponsor |
| Power users | Text | User | Comma-separated names |

## Business rules

- **Save writes one audit_log entry per changed field** with the old and new value. Activity feed picks them up automatically.
- **Length warning**: yellow caption when the objective is < 120 words (BRD §4.3.a). Doesn't block save.
- **AI quality check**: low score (< 3) shows a yellow box with the comment. User can **Dismiss**. Editing the text re-arms the check (clears the dismissal).
- **Propose new category**: new names land as `approved=false` and show "(pending)" until an admin approves them. Duplicate proposals (case-insensitive) are rejected.
- **Demo without Claude key**: if `ANTHROPIC_API_KEY` looks like a stub, the AI endpoint returns a deterministic heuristic score with a `[stub]` note. UI still works.
- **No CSV bulk import in M5** — that's Sprint 4 (BRD AK11), and only CS Director / VP — CSM / Admin will be able to run it.

## What it stores

`account_engagement` table — one row per account. Created on first save (PATCH) if it doesn't exist.

## What gets logged

Every UPDATE produces N audit_log rows where N = number of fields changed. Each row has:
- `table_name = 'account_engagement'`
- `field_name = <the column>`
- `old_value` / `new_value` JSONB containing both the field value and the parent `account_id` (so the AK02 Overview activity feed picks it up).
- `changed_by_user_id` = the signed-in user.

## Edge cases user might hit

| Scenario | What happens |
|---|---|
| First open, no engagement saved yet | Form renders with empty values; first Save creates the row |
| User pastes a 50-word objective | Yellow word-count caption + AI score returns 2 — clear actionable comment |
| User edits text after dismissing the warning | Warning re-armed; need to dismiss again |
| Solutioning Manager opens the form | Every field is disabled; no Save bar |
| Admin edits, CSM views | CSM sees the latest values immediately on next page load (via TanStack Query refetch) |
| Two users edit at once | Last-write-wins; both saves succeed; both audit entries logged |
| Network error during save | Inline red message; form stays dirty so user can retry |

## Status

✅ Built (M5). Live against the real Supabase project.

## Demo

Local: `pnpm dev` → log in → open any account → **Pre-Sales** tab.

| Account | What you'll see |
|---|---|
| Siemens Energy AG | Strong objective (365 chars). AI button → score 4–5 |
| Mondelēz International | Generic objective ("Cost savings on packaging…"). AI button → score 1–2 with yellow warning |
| Sanofi S.A. | Moderate objective (273 chars). AI button → score 3–4 |
| Novo Nordisk A/S | Empty objective. Word-count caption shows 0 |

Login as `harish@beroe-inc.com` and open Sanofi → form is read-only. Switch to Mondelēz → form is editable. Click Save with any change → return to Overview tab and see the new audit entries.
