# M9 — Admin: Account creation + User management

## What it does
Two admin-only flows that are required to operate the workspace beyond the initial seed:

1. **Create a new account** — admins (and CS Director / VP — CSM) can spin up an account from the AK01 page and immediately land on the empty Overview to start filling Pre-Sales / Contacts / Documents / Solutioning tabs.
2. **Manage users** — admins invite teammates by email, assign their role and team, edit later, and deactivate when they leave. Designed to also work end-to-end after Beroe SSO replaces the password step (Phase 2).

## Who uses it

| Function | Roles allowed |
|---|---|
| Create account | Admin · CS Director · VP — CSM |
| Invite user | Admin |
| Edit user | Admin |
| Deactivate user | Admin |
| Re-send invite email | Admin |

## How it works (user flows)

### Create account

1. Open **Accounts** (AK01). Admin/CS Director/VP-CSM see a **+ New account** button in the top-right.
2. Click → modal with required fields (Name, Industry, Country, CSM owner) front-and-center; optional commercials/dates collapsed under "Add more details".
3. **Save → land on the Overview** tab of the newly-created account, ready to fill in engagement, contacts, documents, solutioning.
4. The slug is auto-derived from the name (e.g. *Acme Pharma* → `acme-pharma`); duplicates get `-2`, `-3`, etc.

### Invite a user

1. Sidebar → **Admin** section → **Users**.
2. Click **+ Invite user** → modal (email, full name, role, team).
3. Server emails a 30-minute Supabase magic link. The new row shows up immediately as **Invited** (status pill).
4. When the user clicks the link and sets a password, status flips to **Active** on next /me round-trip.
5. Admin can **Edit** to change role/full name, **Resend** the invite email, or **Deactivate** (soft delete).

### How this works alongside Beroe SSO

When SSO is enabled (Phase 2), the only thing that changes is *step 3*. Instead of sending a magic link, the admin tells the teammate "you're set up — sign in via Beroe SSO." When the teammate logs in via SSO for the first time, the backend matches their SSO email against the pre-provisioned `public.users` row and grants the role admin chose. **The role/team UI doesn't change.**

## Business rules

- **Names** of accounts are at least 2 characters; user full names at least 2.
- **Slug** is unique per workspace. We always generate from the name and append a numeric suffix on collision.
- **CSM owner is required** at creation. Only roles `csm` and `cs_team_manager` can own accounts; the form filters the dropdown accordingly.
- **Self-protection:** admin can't demote themselves out of admin and can't deactivate themselves.
- **Invited users land as `pending`.** They flip to `active` on first successful /me. Deactivated rows stay in the DB (soft-delete) for audit.
- **Re-invite same email** is allowed: it resets the row to `pending`, refreshes role/full_name, and re-sends the link.
- **Per-user/day Claude quota** still applies (separate from this feature).

## What it stores

For each account, the regular Account fields. For each user: email, full name, role (one of 11 enums), team_id, status (`pending` / `active` / `deactivated`), `invited_at`, `invited_by`, plus standard timestamps.

## What gets logged

Every account create / user invite / role-change / deactivate writes to the audit log via the SQLAlchemy `before_flush` listener. The Overview activity feed of an account picks up its own creation event automatically.

## Edge cases

| Scenario | What happens |
|---|---|
| Two admins create accounts with the same name simultaneously | Both succeed; second gets slug `…-2`. |
| Admin demotes themselves | 400 with "have another admin do it." |
| Admin deactivates themselves | 400 with "have another admin do it." |
| Re-invite an email that already exists | Row resets to `pending`, link re-sent (idempotent). |
| Role changed via PATCH | `_USER_CACHE` invalidated immediately so the user sees new perms on next request. |
| Non-admin tries `/admin/users` URL | `RequireAdmin` redirects to `/access-denied`. |
| Backend 403 on any admin call | `lib/api.ts` redirects to `/access-denied?from=…`. |

## Status
✅ Built — M9.

## Demo

1. Log in as `anand@beroe-inc.com` (admin).
2. AK01 → click **+ New account** → fill name + CSM → Save → land on Overview of the new account → walk Pre-Sales / Contacts / Documents / Solutioning tabs.
3. Sidebar → **Admin → Users** → **+ Invite user** → enter `test.user@beroe-inc.com`, role `csm` → Save → row shows up as **Invited**.
4. **Resend** → email sent again. **Edit** → change full name → save. **Deactivate** → row hides from default list; tick **Show deactivated** to see it again.
