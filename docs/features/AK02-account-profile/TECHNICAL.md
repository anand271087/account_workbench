# AK02 — Account Profile (Overview tab + sub-nav shell) — Technical

## Files touched

| File | Purpose |
|---|---|
| `apps/api/app/models/audit.py` | `AuditLog` ORM (mirrors `audit_log`) |
| `apps/api/app/schemas/account_detail.py` | `AccountDetail`, `ActivityItem`, `ActivityFeedResponse` |
| `apps/api/app/routes/accounts.py` | `GET /api/v1/accounts/:id` + `GET /api/v1/accounts/:id/activity` |
| `apps/api/tests/test_account_detail.py` | 8 tests covering both endpoints |
| `supabase/migrations/0007_seed_audit_demo.sql` | 5 demo audit entries |
| `apps/web/src/types/account.ts` | `AccountDetail`, `ActivityItem`, `ActivityFeedResponse` TS types |
| `apps/web/src/routes/accounts/AccountProfileLayout.tsx` | Shell — breadcrumb + header + sub-nav + outlet |
| `apps/web/src/routes/accounts/tabs/OverviewTab.tsx` | Overview content (metrics + context + activity feed) |
| `apps/web/src/routes/accounts/tabs/PlaceholderTab.tsx` | Generic placeholder used by Pre-Sales / Contacts / Documents |
| `apps/web/src/App.tsx` | Nested routes for `/accounts/:accountId/{overview,pre-sales,contacts,documents}` |
| `apps/web/src/routes/accounts/AccountListPage.tsx` | Row click navigates to `/accounts/<id>` |

## API contracts

### `GET /api/v1/accounts/:account_id`

Returns full account detail + capability flags for the frontend.

**Auth:** Bearer JWT (verified via `get_current_user`).
**RBAC:** `can_view_account(role, is_assigned, is_team)` — 403 if denied. RLS at DB is the second wall.

**Response 200:**
```json
{
  "id": "uuid",
  "name": "Siemens Energy AG",
  "slug": "siemens-energy",
  "industry": "Power & Electrical Equipment",
  "region": "Europe",
  "country": "Germany",
  "csm_user_id": "uuid",
  "co_user_id": "uuid",
  "csm_full_name": "Harish S",
  "co_full_name": "Santosh Peshkar",
  "category": "Energy",
  "tier": "T1",
  "account_type": "Hyper Growth",
  "segment": "Segment C",
  "current_acv": "420000.00",
  "target_acv": "630000.00",
  "contract_start": "2023-07-01",
  "contract_end": "2026-06-30",
  "renewal_date": "2026-06-30",
  "days_to_renewal": 53,
  "health_score": 78,
  "last_activity_at": "...",
  "created_at": "...",
  "updated_at": "...",
  "is_editable": true,
  "can_view_pre_sales": true,
  "can_view_contacts": true,
  "can_view_documents": true
}
```

**Errors:** `404 Account not found` · `403 Forbidden on this account` · `401 Not authenticated`

### `GET /api/v1/accounts/:account_id/activity`

Paged activity feed scoped to the account. Sorted by `changed_at DESC`.

**Query params:** `page` (≥1, default 1), `page_size` (1..100, default 20)

**What's included:** any `audit_log` row where:
- `table_name = 'accounts'` AND `row_id = :account_id` (direct edits to the account row), **OR**
- `table_name IN ('account_engagement','client_contacts','documents','account_assignments')` AND `new_value @> {"account_id": ":account_id"}` (child-row edits)

The JSONB containment filter assumes M5+ audit writers populate `new_value` (and `old_value`) with at least the `account_id` key for child tables. M4 demo seed does this manually.

**Response 200:**
```json
{
  "items": [
    {
      "id": "uuid",
      "table_name": "accounts",
      "row_id": "uuid",
      "action": "update",
      "changed_by_user_id": "uuid",
      "changed_by_full_name": "Anand",
      "changed_at": "...",
      "field_name": "csm_user_id",
      "old_value": { "csm_user_id": "uuid" },
      "new_value": { "csm_user_id": "uuid" }
    }
  ],
  "total": 5,
  "page": 1,
  "page_size": 20
}
```

## Data model

No new tables. Uses `audit_log` (created in 0001_init_schema.sql).

## Frontend state

```
Route:
  /accounts/:accountId            → <AccountProfileLayout>
    /                             → <Navigate to="overview" />
    /overview                     → <OverviewTab>
    /pre-sales                    → <PreSalesPlaceholder>     (M5)
    /contacts                     → <ContactsPlaceholder>     (M6)
    /documents                    → <DocumentsPlaceholder>    (M7)
```

`AccountProfileLayout` fetches `/api/v1/accounts/:id` once and shares the result with all sub-tabs via React Router's `Outlet context` (`useAccountFromLayout()`).

Each sub-tab fetches its own additional data:
- `OverviewTab` → `/api/v1/accounts/:id/activity?page=1&page_size=5`
- `PreSalesPlaceholder` / others → none in M4

### TanStack Query keys
- `["account", accountId]` — account detail
- `["activity", accountId, page]` — activity feed page

### Hide tabs by capability

`AccountDetail.can_view_pre_sales` / `can_view_contacts` / `can_view_documents` — currently all `true` because matrix says "Account Profile (Overview)" is V for everyone. When M5+ adds per-tab restrictions, the backend simply flips these booleans and the sub-nav updates automatically.

## Sequence — load profile + activity

```
Browser                                 FastAPI                                Postgres
   |--GET /accounts/:id--->|                                                       |
   |   Bearer <jwt>        |--get_current_user (verify JWT, lookup user)---------->|
   |                       |--SELECT account + JOIN users (csm, co)---------------->|
   |                       |<--row-----------------------------------------------|
   |                       |--check can_view_account()                              |
   |<--{detail with caps}--|                                                       |
   |                                                                                |
   |--GET /accounts/:id/activity?page=1&page_size=5--->|                           |
   |                       |--re-check view scope                                  |
   |                       |--SELECT audit_log WHERE row_id=:id OR new_value@>... -|
   |                       |<--rows---------------------------------------------|
   |<--{activity feed}-----|                                                       |
```

## Validation

- `:account_id` parsed as UUID by Pydantic. Bad value → 422.
- `page` ≥1, `page_size` 1..100.
- `is_editable`/`can_view_*` are advisory for the frontend — the backend re-checks on every action.

## Tests

`apps/api/tests/test_account_detail.py` — 8 tests:
- 401 on unauthenticated
- 200 detail for admin (with full editable rights)
- CSM sees other CSM's account read-only (Sanofi case)
- 404 on non-existent account
- Activity feed returns seeded entries
- Activity feed resolves `changed_by_full_name`
- Activity feed pagination
- Activity feed 404 on non-existent account

Full suite: 40 tests, 75% coverage.

## Configuration

No new env vars.

## Security notes

- **Auth required:** yes — `get_current_user` on every endpoint
- **RBAC:** `can_view_account(role, is_assigned, is_team)` (M3 helper) on both endpoints
- **RLS:** policies from `0002`/`0005` apply at the DB layer — third wall
- **Input sanitization:** Pydantic UUID validation, query param bounds
- **Output:** React auto-escapes JSX; activity feed treats `field_name`/`old_value`/`new_value` as data
- **No raw SQL** for the JSONB filter — built via `cast(literal(json.dumps({...})), JSONB)` so the parameter is properly bound
- **Audit log filter is by `account_id` only** — users won't see rows from other accounts even via the JSONB containment check, because every row is constrained to the account they have view access on

## Performance

- `/accounts/:id` — one query (Account + 2 LEFT JOIN users). Indexed on PK.
- `/accounts/:id/activity` — one COUNT + one SELECT with LIMIT/OFFSET. Indexed on `audit_log(table_name, row_id)`. JSONB containment uses GIN if needed at scale (not added yet — fine at <10K rows).
- Activity feed page size capped at 100.

## Known limitations & TODOs

- The `can_view_pre_sales`/`can_view_contacts`/`can_view_documents` booleans always return `true` in M4 — they become role-aware once M5/M6/M7 add per-tab scoping (e.g., should an Inside Sales Manager actually see the Solutioning Documents tab? Per matrix: V — yes).
- Activity feed for **child rows** depends on M5+ audit writers populating `new_value.account_id`. Demo seed fakes this manually for the `accounts` table; M5+ will use SQLAlchemy event listeners that automatically include `account_id` in the JSONB payload.
- No deep-link shareable URL scheme yet for individual activity entries.
- "Recent activity" is fixed at 5 on the Overview; a paged "All activity" sub-tab can come later if requested.
