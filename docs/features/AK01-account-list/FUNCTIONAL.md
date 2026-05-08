# AK01 — Account List

## What it does

The first screen a user sees after signing in. Shows every account the user is allowed to see, with quick search, filters, sortable columns, and a clear visual indicator of which accounts they can edit vs. only view.

## Who uses it

Every authenticated user. The list automatically narrows to the rows the user's role permits:

| Role | What they see |
|---|---|
| Admin, CS Director, VP — CSM, VP — Sales | All accounts (full edit) |
| VP — Solutioning, VP — Inside Sales | All accounts (read-only) |
| Solutioning Manager, Inside Sales Manager, Commercial Owner | All accounts (read; edit only on relevant sub-resources later) |
| CSM, CS Team Manager | Only accounts assigned to them (full edit on those) |

A row marked **"(read-only)"** appears greyed-out for users who can view but not edit.

## How it works (user flow)

1. User signs in → automatically lands on `/accounts`.
2. Account list loads.
3. User can:
   - **Search** by typing in the box at the top — searches name, country, and industry simultaneously. Updates as you type (debounced).
   - **Filter** by Industry, Tier, or Region using dropdowns.
   - **Sort** by clicking any sortable column header (ACV, Renewal, Health, Last Activity). Click again to flip direction.
   - **Paginate** through pages of 50 accounts at a time.
   - **Clear filters** with one click.
4. Filters and search are reflected in the URL so the page is bookmarkable and shareable.

## What the table shows

Each row:

| Column | Notes |
|---|---|
| **Account** | Logo block (initials), name, tier · account type. "(read-only)" tag if user can't edit. |
| **ACV** | Current ACV with target underneath. |
| **Renewal** | Days to renewal pill (red ≤ 30 days, amber ≤ 90, green > 90) + the actual date. |
| **Health** | Pill (Healthy ≥ 65, At Risk 48–64, Unhealthy < 48) + numeric score. |
| **Last activity** | Relative time ("3d ago", "2w ago"). |
| **CSM** | Assigned CSM's full name. |
| **Industry / Country** | Stacked text. |

## Business rules

- **Server is the truth.** The frontend filters by URL state; the backend enforces what rows the user can see (defense-in-depth: API decorator + Postgres Row Level Security).
- **Search is case-insensitive** and matches anywhere in the name, country, or industry.
- **Page size is 50.** No infinite scroll in Sprint 1.
- **Empty state.** If a CSM has no assigned accounts, they see a friendly "No accounts assigned. Contact your CS Director." message.
- **Filtered empty state.** If filters yield zero rows, "No accounts match these filters" with a Clear filters button.
- **Read-only badge.** Users who can view but not edit see "(read-only)" inline on each row name.
- **Performance target (BRD).** List loads under 1.5s for 600 accounts.

## What it stores

Nothing new. Reads from `accounts` and `users` tables (created in M2).

## What gets logged

Standard request logs (path, status, request ID). Failed access (403) is logged with user and request context for security review.

## Edge cases user might hit

| Scenario | What happens |
|---|---|
| CSM has no assigned accounts | Empty state with helpful message |
| Search yields 0 results | "No accounts match — try clearing filters" |
| Network/server error | Inline red banner with the message |
| User clicks a non-sortable column | Nothing — only Name/ACV/Renewal/Health/Last Activity are sortable |
| URL has `?industry=Foo` for a value that doesn't exist | Empty result, but URL preserved (user can clear filters) |
| Same column header clicked twice | Sort direction flips |
| User pages past the last page | Next button is disabled |

## Status

✅ Built (M3). Live against the real Supabase project, 4 demo accounts seeded.

## Demo

Local: `pnpm dev` then http://localhost:5173 → sign in.

| Login as | Sees |
|---|---|
| `anand@beroe-inc.com` (Admin) | All 4 accounts, all editable |
| `harish@beroe-inc.com` (CSM) | All 4 (assigned to all), all editable |
| `purnima@beroe-inc.com` (Solutioning Manager) | All 4 (read-only) |
| `megha@beroe-inc.com` (CS Director) | All 4, all editable |
| `santosh@beroe-inc.com` (VP — Sales) | All 4, all editable |

Try filtering by `industry=Pharmaceuticals` (2 rows), searching `siemens` (1 row), sorting by ACV desc (Siemens Energy AG first).
