# M9 — Admin (Account creation + User management) — Technical

## Files touched

| File | Purpose |
|---|---|
| `supabase/migrations/0015_users_invite_status.sql` | Adds `user_status` ENUM + `users.status / invited_at / invited_by` |
| `apps/api/app/models/user.py` | ORM mapped to new columns + `UserStatus` ENUM |
| `apps/api/app/models/account.py` | (No change in M9 — existing columns sufficient for create) |
| `apps/api/app/schemas/account.py` | New `AccountCreate` schema |
| `apps/api/app/schemas/user.py` | `UserOut` extended; new `UserInvite`, `UserUpdate` |
| `apps/api/app/core/rbac.py` | New `can_create_account` + `can_manage_users_role` predicates |
| `apps/api/app/routes/accounts.py` | New `POST /accounts` + `_slugify` + `_unique_slug` |
| `apps/api/app/routes/users.py` | Admin endpoints: `POST`, `PATCH`, `DELETE`, `POST /:id/resend-invite` |
| `apps/api/app/core/deps.py` | `invalidate_user_cache(user_id)` helper called after PATCH/DELETE |
| `apps/api/tests/test_admin.py` | 10 pytest cases (account create RBAC + slug uniqueness + user invite/edit/deactivate + self-protection) |
| `apps/web/src/types/auth.ts` | `UserStatus`, `UserInvite`, `UserUpdate` types |
| `apps/web/src/routes/admin/UsersPage.tsx` | `/admin/users` page with table + invite/edit modals |
| `apps/web/src/routes/accounts/AccountListPage.tsx` | `+ New account` CTA + `CreateAccountModal` |
| `apps/web/src/components/AppShell.tsx` | Sidebar Admin section (admin-only) + active-route highlight |
| `apps/web/src/App.tsx` | `/admin/users` route + `RequireAdmin` guard |

## Data model

### `users` (extended)
```sql
alter table users
  add column status user_status not null default 'active',  -- pending | active | deactivated
  add column invited_at timestamptz,
  add column invited_by uuid references users(id);
```

### `accounts` (no change)
The existing schema covers everything `AccountCreate` accepts.

## API contracts

### `POST /api/v1/accounts`
- **Auth:** required.
- **Permissions:** `can_create_account(role)` → admin / cs_director / vp_csm.
- **Body:** `AccountCreate` — `name` (≥2), `csm_user_id` required; everything else optional.
- **Server:**
  1. Validate CSM exists, is active, has role `csm` or `cs_team_manager`.
  2. Validate optional Commercial Owner exists.
  3. Validate `contract_start <= contract_end` if both provided.
  4. `slug = _slugify(name)` → `_unique_slug` appends `-2`, `-3`, ... until free.
  5. Insert row. Audit listener captures the insert automatically.
- **Response:** 201 + `AccountListItem` shape (so frontend can slot it into the list or navigate).

### `GET /api/v1/users` (extended)
- **Permissions:** admin only.
- **Query:** `role` (filter), `include_deactivated` (default false).

### `POST /api/v1/users` (admin invite)
- **Permissions:** admin.
- **Body:** `UserInvite` — `email`, `full_name`, `role`, optional `team_id`.
- **Server:**
  1. Call `supabase.auth.admin.invite_user_by_email(email, ...)` with the service-role key. Supabase creates `auth.users` row + emails a 30-minute reset link.
  2. Capture the `auth_user.id` returned.
  3. Insert into `public.users` with `id = auth_user.id`, `status='pending'`, `invited_at=now`, `invited_by=current_user`.
  4. If the email already exists in `public.users`, **re-invite path**: reset to `pending`, refresh metadata, return the row.
- **Response:** 201 + `UserOut`.
- **Error:** 409 if Supabase reports the email is already registered globally; 502 on transient Supabase failure.

### `PATCH /api/v1/users/:user_id`
- **Permissions:** admin.
- **Body:** `UserUpdate` — partial. Any of `full_name`, `role`, `team_id`.
- **Server:** apply `model_dump(exclude_unset=True)`. Self-demotion guard: caller cannot drop themselves to non-admin.
- **Cache:** calls `invalidate_user_cache(user_id)` after commit so the 60s identity-cache TTL doesn't paper over the change.

### `DELETE /api/v1/users/:user_id`
- **Permissions:** admin. Caller cannot deactivate themselves.
- **Server:** soft delete (`deleted_at = now()`, `status = 'deactivated'`). Cache invalidated.
- **Audit:** capture (status field is in `AUDITED_MODELS`).
- **Response:** 204.

### `POST /api/v1/users/:user_id/resend-invite`
- **Permissions:** admin.
- **Server:** must be `pending` (active users don't need a link). Calls `invite_user_by_email` again, updates `invited_at`/`invited_by`.

## Frontend

### Sidebar (`AppShell.tsx`)
- New **Admin** section (admin-only, gated on `me.permissions.is_global_admin`) with **Users** link.
- Active-route highlight added to `Accounts` and `Users` items so the chosen page is obvious.

### `+ New account` (`AccountListPage.tsx::CreateAccountModal`)
- Single modal, no wizard.
- Required fields up top; optional fields under "Add more details" toggle.
- CSM dropdown filtered to `csm` + `cs_team_manager` only.
- On success: `navigate(`/accounts/${id}/overview`)`.

### `/admin/users` (`routes/admin/UsersPage.tsx`)
- Table: Name · Email · Role · Status · Actions.
- Filters: role dropdown + "Show deactivated" toggle.
- `+ Invite user` modal.
- Per-row actions:
  - **Edit** (full_name + role; email read-only)
  - **Resend** (only if status=pending)
  - **Deactivate** (hidden when row is self or already deactivated)
- TanStack Query keys: `["admin-users", roleFilter, includeDeactivated]` invalidated on every mutation.

### Routing (`App.tsx`)
- New `/admin/users` route guarded by `RequireAuth` + new `RequireAdmin` (redirects to `/access-denied` if `!me.permissions.is_global_admin`).

## Tests (`apps/api/tests/test_admin.py`)

10 cases, all green:

**Account creation:**
- `test_create_account_admin_succeeds` — happy path; `is_editable=true`; slug is `m9-test-acme-…`
- `test_create_account_csm_forbidden` — non-admin → 403
- `test_create_account_rejects_admin_as_csm` — wrong CSM role → 400
- `test_create_account_slug_collision_appends_suffix` — same name twice → second gets `-2`

**User management:**
- `test_invite_user_admin_succeeds` — happy path; status=pending; email captured by stub
- `test_invite_user_csm_forbidden` — non-admin → 403
- `test_admin_self_demote_blocked` — 400
- `test_admin_can_edit_other_user_full_name` — invite + PATCH happy path
- `test_admin_self_deactivate_blocked` — 400
- `test_admin_can_deactivate_other_user` — invite + DELETE; not in default list; visible with `?include_deactivated=true`; status=`deactivated`

### Test fixture: `stub_supabase_invite`

Replaces `invite_user_by_email` with `auth.admin.create_user(email_confirm=true)` — same `auth.users` row, no email sent. The fixture also tracks created auth ids and tears them down afterwards.

## Performance

The 60s `_USER_CACHE` from the perf pass is invalidated explicitly after every PATCH/DELETE/deactivate so role changes take effect on the very next request (not 60s later). No new caches added in M9.

## Security notes

- **Auth required** on every admin endpoint.
- **`require_admin()` dependency** as well as inline `_ : Annotated[User, Depends(require_admin())]` on each route — defense-in-depth.
- **Service-role key never leaves the API server** — Supabase Admin API only called from the FastAPI process.
- **Self-demote / self-deactivate guards** prevent the admin locking themselves out of admin functions.
- **403 → /access-denied** redirect from `lib/api.ts` already in place from earlier work.
- **Audit log** captures every change via existing `before_flush` listener.

## Phase-2 SSO compatibility

Nothing in M9 has to change when Beroe SSO replaces the password step:
- The `public.users` row is the canonical store of role/team/status.
- SSO login is matched to `public.users` by email (lower-cased).
- The admin UI keeps working identically. Only the *invite* email becomes a "tell teammate to log in via SSO."
- We could remove the `invite_user_by_email` Supabase call in Phase 2 in favor of admin-create-user (no email) and rely on SSO email matching to flip status to `active`. That's a route-level swap, not a UI change.

## Known limitations & TODOs

- Team management (create/edit teams) isn't in M9 — admin can pick existing team_id but can't create new teams from UI. Lands when teams become more dynamic.
- No bulk import for users (can add when there's a CSV need).
- No 2FA or MFA — relies on Supabase or Beroe SSO to provide that layer.
- No notification when a deactivated user attempts to log in — they just get 403 on /me.
