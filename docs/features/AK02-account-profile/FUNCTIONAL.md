# AK02 — Account Profile (Overview tab + sub-nav shell)

## What it does

The page a user lands on after clicking an account in the Account List. Shows a header with the account's most important details and a tabbed sub-nav for the rest of the account's data:

- **Overview** — key metrics + recent activity feed (built in M4)
- **Pre-Sales** — engagement info form (ships M5)
- **Contacts** — client contact roster (ships M6)
- **Documents** — meeting records and solutioning documents (ships M7)

Each sub-tab has its own URL so it's bookmarkable.

## Who uses it

Every authenticated user — viewing scope follows the matrix:

- Anyone with **Account List** read access can open an account profile.
- The "(read-only)" badge appears for users who can view but not edit.
- The sub-nav itself shows all four tabs in Sprint 1 (matrix says "Account Profile (Overview)" is V for everyone). Per-tab edit/delete actions are still gated.

## How it works (user flow)

1. User is on `/accounts` and sees the list.
2. User clicks any row.
3. URL changes to `/accounts/<id>/overview` and the profile page loads.
4. Header shows: name, industry · country · CSM, ACV, days to renewal, health, tier, category.
5. Sub-nav lets the user switch between Overview, Pre-Sales, Contacts, Documents.
6. Breadcrumb at top: **Accounts › Account Name** — clicking "Accounts" goes back.

### Overview tab content
- **Key metrics** card — Current ACV · Target ACV · Renewal Date (with days to go) · Health Score
- **Engagement context** card — CSM · Commercial Owner · Account Type · Segment · Region · Contract dates
- **Recent activity** sidebar — last 5 events from the audit log (created/updated/deleted on this account or any of its child rows)

## Business rules

- **Read-only badge.** Users who can view but not edit the account see "(read-only)" inline next to the name in the header.
- **Sub-nav is rendered, but per-tab actions are gated** — e.g. CSMs see the Pre-Sales tab but can only edit it on their own accounts (M5 will enforce).
- **Activity feed = audit_log derived.** Every change anywhere in the account (account row, engagement, contacts, documents) shows up here, with the user who made it and how long ago.
- **404 if the account doesn't exist** or the user doesn't have view access — the API returns 404/403, the UI shows a friendly "Account not found" with a back-to-list button.
- **URL is bookmarkable.** `/accounts/<id>/contacts` works as a direct entry point and survives a refresh.
- **No edit on the Overview tab.** Edits happen on the dedicated sub-tabs (M5+).

## What it stores

Nothing new. Reads from `accounts`, `users`, and `audit_log`.

## What gets logged

Page views are not logged. Every UPDATE/DELETE that occurs on the page (M5+) writes to the audit log automatically.

## Edge cases user might hit

| Scenario | What happens |
|---|---|
| Account doesn't exist | Friendly "Account not found" page with Back-to-list button |
| User loses view access mid-session | API returns 403; UI redirects to `/access-denied` |
| Activity feed is empty | "No recent activity" — common right after seeding |
| Long account names | Truncated with ellipsis in the header |
| User opens `/accounts/<id>` directly with no sub-tab | Auto-redirects to `/accounts/<id>/overview` |
| User pastes an invalid UUID into the URL | API returns 422 (Pydantic validates UUIDs); UI shows generic error |

## Status

✅ Built (M4). Layout + Overview tab live. Pre-Sales / Contacts / Documents tabs are placeholders that ship in M5/M6/M7.

## Demo

Local: `pnpm dev` → log in → click any row in `/accounts`.

- **Siemens Energy AG** has 2 seeded audit entries (creation + CSM assignment).
- **Sanofi S.A.** shows the recent reassignment (Harish → csm2).
- **Mondelēz** shows a health-score recompute.
- **Novo Nordisk** shows a contract-start update.

Switch users to see the read-only badge:
- `purnima@beroe-inc.com` (Solutioning Mgr) — every account shows "(read-only)" in the header.
- `harish@beroe-inc.com` (CSM) — Sanofi shows "(read-only)" because csm2 is now the assigned CSM.
