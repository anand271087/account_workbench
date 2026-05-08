# F02 — Roles & Access Control

## Source of truth

[`Roles_Access_Matrix_Reviewed_05072026.xlsx`](../../../../Beroe/BRD/Roles_Access_Matrix_Reviewed_05072026.xlsx) is the canonical document. When BRD §3.2 narrative conflicts with the matrix, the matrix wins.

## What it does

Decides what each user can see and do in AWB based on their role. Eleven roles, 13 functions in scope. Enforced in three places (frontend, API, database) so a bug in one layer is caught by another.

## Who uses it

Every signed-in user. Their role is set by an admin when their account is created and is checked on every request.

## The full matrix (legend below)

| Function | CRUD | CSM | CS Team Mgr | CS Director | VP — CSM | Commercial Owner | VP — Sales | Solutioning Mgr | VP — Solutioning | Inside Sales Mgr | VP — Inside Sales | Admin |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Login & Auth | V/A/E/D | F | F | F | F | F | F | F | F | F | F | F |
| Home Dashboard | V | V | V | V | V | V | V | V | V | V | V | V |
| Account List | V/E (re-assign) | V (own + R all) | V (team + R all) | V (all) | V (all) | V (own portfolio) | V (all R) | V (all R) | V (all R) | V (all R) | V (all R) | F (all + reassign) |
| Account Profile (Overview) | V | V | V | V | V | V | V | V | V | V | V | V |
| Pre-Sales Engagement Info | V/A/E/D | F (own) | F (team) | F (all) | F (all) | V | V | V | V | F (own) | V | F (all) |
| Client Contacts | V/A/E/D | F (own) | F (team) | F (all) | F (all) | V | V | F (all) | V | F (own) | V | F (all) |
| Meeting Records (MOM) | V/A/E/D | F (own) | F (team) | F (all) | F (all) | V | V | F (all) | V | F (own) | V | F (all) |
| Solutioning Documents (VPD) | V/A/E/D | V | V (team) | F (all) | F (all) | V | V | F (all) | V | V | V | F (all) |
| Value Definition | V/A/E/D | F (own) | F (team) | F (all) | F (all) | V | V | V | V | V | V | F (all) |
| Goals & Initiatives | V/A/E/D | F (own) | F (team) | F (all) | F (all) | V | V | V | V | V | V | F (all) |
| AI — Re-run analysis | Run | Run (own) | Run (team) | Run (all) | Run (all) | — | — | Run (all) | — | Run (own) | — | Run (all) |
| Bulk Import (CSV) | Run | — | — | Run | Run | — | — | — | — | — | — | Run |
| Reports / Export | V | V (own) | V (team) | V (all) | V (all) | V (own) | V (all) | V (all) | V (all) | V (all) | V (all) | V (all) |
| Success Mgmt — Health Score | V | V (own) | V (team) | V (all) | V (all) | V (own) | V (all) | V (all) | V (all) | V (all) | V (all) | V (all) |
| Success Mgmt — Renewal Risk | V | V (own) | V (team) | V (all) | V (all) | V (own) | V (all) | V (all) | V (all) | V (all) | V (all) | V (all) |
| Success Mgmt — Activity Log | V/A | F (own) | F (team) | F (all) | F (all) | V | V | V | V | V | V | F (all) |
| Admin — User Management | V/A/E/D | — | — | — | — | — | — | — | — | — | — | F |
| Admin — Role Assignment | V/A/E | — | — | — | — | — | — | — | — | — | — | F |
| Admin — Audit Log Viewer | V | — | — | V | V | — | V | — | V | — | V | F |
| Admin — Soft-delete Restore | Run | — | — | — | — | — | — | — | — | — | — | F |

## Legend

- **F** — Full access (Create, Read, Update, Delete)
- **V** — View / Read-only
- **Run** — Can execute (e.g. Re-run AI, Bulk Import)
- **—** — No access
- **(own)** — Records the user is assigned to as CSM or CO
- **(team)** — Records owned by anyone on the user's team
- **(all)** — All records visible / editable
- **(own portfolio)** — Commercial Owner: only accounts where they're the CO
- **R / read-only** — Visible but not editable

## Stakeholder-confirmed clarifications (May 2026)

1. **Team = by named roster.** A CS Team Manager's "team" is the set of users with `team_id` matching theirs.
2. **Inside Sales Manager** edits Engagement Info (Q2 confirmed).
3. **Solutioning Manager** edits **only** Solutioning sections (VPD, Contacts, MOM) — **not** Pre-Sales Engagement Info, Value Definition, or Goals (Q3 confirmed).
4. **Commercial Owner** edits Sales Hand-off and Value Definition (enrichment) — Q4. (Wired in M5.)
5. **AI Re-run daily limit** per user, yes — implemented in M7 with the AI pipeline.
6. **Audit Log Viewer for VPs** = all (any function area), Q6 confirmed.

## Three walls of enforcement

```
   Frontend                         API                              Database
   ────────                         ───                              ────────
1. Hide buttons              2. require_role / require_account_access     3. Postgres RLS
   the user can't act on        decorators on every protected route       policies on every table
                                                                          (helper fns: current_user_role,
                                                                          role_can_view_audit, etc.)
```

A bug in any single layer is caught by the next. Tests assert each layer independently.

## UI behavior rules

- **Hide, don't grey out.** If a user lacks permission to an action, the button doesn't appear.
- **Filter, don't placeholder.** Forbidden records are removed from lists, not shown as locked rows.
- **Server is the truth.** Frontend gating is for UX only — backend re-checks every request.
- **Read-only badge.** On the Account List, rows that are visible but not editable show "(read-only)" inline.

## Status

✅ Built (M2 + M3 realign). Matrix-aligned. 32 backend tests pass.

## Demo

Sign in as different test users at http://localhost:5173/login. The Account List shows different `is_editable` distributions per role:

| Login as | Visible | Editable |
|---|---|---|
| `anand@beroe-inc.com` (Admin) | 4 | 4 |
| `megha@beroe-inc.com` (CS Director) | 4 | 4 |
| `harish@beroe-inc.com` (CSM) | 4 | 3 (Sanofi is read-only — assigned to csm2) |
| `csm2@beroe-inc.com` (CSM) | 4 | 1 (only Sanofi) |
| `team.lead@beroe-inc.com` (CS Team Mgr) | 4 | 4 (whole team's accounts) |
| `purnima@beroe-inc.com` (Solutioning Mgr) | 4 | 0 |
| `santosh@beroe-inc.com` (VP — Sales) | 4 | 0 |

Admin sees a small **Reassign** link next to each account name.
