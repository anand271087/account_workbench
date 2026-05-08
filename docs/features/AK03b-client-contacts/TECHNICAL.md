# AK03.b — Client Contacts — Technical

## Files touched

| File | Purpose |
|---|---|
| `apps/api/app/models/contact.py` | `ClientContact` SQLAlchemy ORM (columns + Postgres ENUMs `contact_role`/`influence_level`) |
| `apps/api/app/models/__init__.py` | Re-exports `ClientContact` so audit listener registration sees it |
| `apps/api/app/schemas/contact.py` | Pydantic v2: `ContactOut`, `ContactListResponse`, `ContactCreate`, `ContactUpdate` |
| `apps/api/app/routes/contacts.py` | 5 endpoints; two routers (account-scoped + id-scoped) |
| `apps/api/app/services/audit_writer.py` | `AUDITED_MODELS` includes `ClientContact`; `row_id` resolution generalized to all audited models |
| `apps/api/app/main.py` | Wires both contact routers |
| `supabase/migrations/0009_seed_contacts_demo.sql` | 12 seeded contacts across the 4 demo accounts |
| `apps/api/tests/test_contacts.py` | 12 pytest cases — CRUD, RBAC, soft delete + restore, audit log capture |
| `apps/web/src/types/contact.ts` | TS mirror of Pydantic schemas + label maps |
| `apps/web/src/routes/accounts/tabs/ContactsTab.tsx` | List + add/edit modal + soft-delete + admin restore |
| `apps/web/src/App.tsx` | `/accounts/:id/contacts` → `ContactsTab` |
| `apps/web/src/routes/accounts/tabs/PlaceholderTab.tsx` | Removed `ContactsPlaceholder` (replaced by real tab) |

## Data model

### `client_contacts` table (created in migration 0001)
```sql
client_contacts (
  id            uuid PK default gen_random_uuid(),
  account_id    uuid NOT NULL FK accounts(id),
  name          text NOT NULL,
  title         text,
  email         text,
  phone         text,
  role          contact_role,                          -- decision_maker|influencer|end_user|finance|it
  influence     influence_level,                       -- high|medium|low
  is_spoc       boolean NOT NULL default false,
  is_sponsor    boolean NOT NULL default false,
  created_at    timestamptz NOT NULL default now(),
  updated_at    timestamptz NOT NULL default now(),
  deleted_at    timestamptz                            -- soft delete; null = active
)
```

### RLS policies (defined in `0002_rls_policies.sql` / `0005_realign_rls_per_matrix.sql`)
- `select` policy: visible iff caller can `view` the parent account (matrix-scoped via `user_assigned_to_account` helper or global-read role).
- `insert/update/delete`: handled at the API layer (FastAPI `can_write_contacts`) — RLS allows authenticated writes; FastAPI is the gatekeeper (RLS is defense-in-depth).
- `service_role` bypasses all RLS (used by FastAPI with the service role JWT for hot-path reads).

### Audit log
Every insert/update/delete on `client_contacts` produces one `audit_log` row per changed field via the `before_flush` SQLAlchemy listener in `services/audit_writer.py`. The listener writes:

```python
new_value = {"account_id": str(contact.account_id), "name": ..., "is_spoc": ...}
old_value = {"account_id": str(contact.account_id), <previous value>}
```

Both `new_value` and `old_value` always carry `account_id` so the AK02 activity feed picks contact edits up via JSONB containment (`new_value @> {"account_id": "<uuid>"}`).

## API contracts

### `GET /api/v1/accounts/:account_id/contacts?include_deleted=<bool>`
- **Auth:** required.
- **Scope:** caller must `can_view_account(role, is_assigned, is_team)`.
- **`include_deleted=true`:** admin only (else 403). Restricts to deletions within the last 30 days.
- **Response 200:**
  ```json
  {
    "items": [ContactOut...],
    "total": 4,
    "is_editable": true
  }
  ```
- Sort: `is_spoc DESC, is_sponsor DESC, name ASC`.

### `POST /api/v1/accounts/:account_id/contacts`
- **Body:** `ContactCreate` (name required, all else optional).
- **Permissions:** `can_write_contacts(role, is_assigned, is_team)`.
- **Returns:** 201 + `ContactOut`.
- **Audit:** insert event with full snapshot in `new_value`.

### `PATCH /api/v1/contacts/:contact_id`
- **Body:** `ContactUpdate` (any subset of writable fields). Server applies `model_dump(exclude_unset=True)` so missing fields are untouched.
- **Returns:** 200 + `ContactOut`.
- **Audit:** one row per changed field with old + new value.

### `DELETE /api/v1/contacts/:contact_id`
- Sets `deleted_at = now()`. Returns 204.
- Audit: update event for `deleted_at` field.

### `POST /api/v1/contacts/:contact_id/restore`
- **Auth:** admin only.
- Validates the contact is currently soft-deleted and within the 30-day window.
- Clears `deleted_at`, returns 200 + `ContactOut`.

## Frontend state

### Component tree
```
ContactsTab
  ├─ filter bar  (admin: "Show deleted" toggle  |  edit: "+ Add contact")
  ├─ table
  │    └─ row: name | title | email/phone | role | influence | flags | actions
  └─ ContactFormModal (create or edit — same modal, prefilled when editing)
```

### TanStack Query keys
- `["contacts", accountId, includeDeleted]` — list query.
- `["activity", accountId]` — invalidated after every mutation so the Overview feed refreshes.

### Mutations (all invalidate the keys above)
- `createMutation` → POST
- `patchMutation` → PATCH
- `deleteMutation` → DELETE
- `restoreMutation` → POST `/restore`

### Empty/error states
- Loading: "Loading contacts…"
- Error: red text, simple retry by tab re-mount.
- No contacts: empty-state card with prompt to add the first one (only if editable).
- Deleted rows visually de-emphasized (`opacity-50`) and tagged with red "deleted" pill.

## Sequence: add a contact

```
User clicks "+ Add contact"
   → ContactFormModal opens
   → User fills name (required), optional fields, clicks Save
   → POST /api/v1/accounts/:id/contacts {name, ...}
   → FastAPI: _scope_for_account → 403 if not allowed
   → can_write_contacts → 403 if role can't edit
   → INSERT INTO client_contacts (...)
   → before_flush listener: INSERT INTO audit_log (action='insert', new_value={...})
   → COMMIT (single transaction)
   → 201 + ContactOut
   → Frontend: invalidate ["contacts", id] + ["activity", id]
   → Modal closes, table refreshes, activity feed picks up the entry
```

## Validation rules

| Field | Backend (Pydantic) | Frontend |
|---|---|---|
| name | `min_length=1`, required | required, trimmed |
| email | `EmailStr` (real email validator) | HTML5 `type="email"` + server-side check |
| phone | free-text string | free-text |
| role | enum (5 values) | enum select |
| influence | enum (3 values) | enum select |
| is_spoc, is_sponsor | bool, default false | checkboxes |

## Background jobs
None for AK03.b — all writes are synchronous.

## Tests
- `apps/api/tests/test_contacts.py` — 12 cases, all green:
  - `test_contacts_unauth_401` — no token → 401
  - `test_list_contacts_admin` — admin sees all 4 Siemens contacts incl. correct SPOC + sponsor counts
  - `test_list_contacts_csm_other_account_readonly` — csm not assigned to Sanofi → `is_editable=false`
  - `test_list_contacts_solutioning_can_edit` — matrix Q3 says solutioning has F (all) on contacts
  - `test_create_contact_admin` — happy path + DB cleanup
  - `test_create_contact_csm_forbidden_on_other` — 403 when not assigned
  - `test_create_contact_validation` — empty name + bad email → 422
  - `test_patch_contact_admin` — happy path + restore seed value
  - `test_patch_contact_csm_other_forbidden` — 403
  - `test_soft_delete_and_restore_flow` — full lifecycle: create → list excludes → delete → list excludes → admin sees with `include_deleted=true` → non-admin 403 on `include_deleted` → restore
  - `test_restore_csm_forbidden` — only admins
  - `test_audit_log_captures_contact_changes` — insert produces one `client_contacts/insert` activity row scoped to the account

## Configuration
No new env vars. Uses the same `DATABASE_URL` and `SUPABASE_JWT_SECRET` as the rest of the API.

## Security notes
- **Auth required:** yes (every endpoint).
- **RBAC:** matrix-aligned per-function helpers in `core/rbac.py`. Frontend gates UI; FastAPI re-checks server-side; RLS is the third wall.
- **Email validation:** server-side via Pydantic `EmailStr`; rejects malformed input before any DB write.
- **Soft delete:** `deleted_at` is set, never the row removed. Restore window enforced server-side (30 days), not just by UI hiding the button.
- **Audit:** every change captured automatically (no route-level `audit_writer` calls — the listener handles it).
- **Rate limit:** inherits the global FastAPI middleware (1000 req/min per IP).

## Known limitations & TODOs
- No bulk import yet — contacts must be added one at a time. (Bulk CSV upload is a v1.1 candidate.)
- No m:n linking to documents yet (`document_links` table exists in schema but not populated). Lands in M7.
- No "favorite" / "primary contact" beyond `is_spoc`/`is_sponsor`.
- Hard-delete of stale soft-deletes (>30 days) is not yet wired — needs an admin tooling sprint job.
