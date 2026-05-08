# AK01 — Account List — Technical

## Files touched

| File | Purpose |
|---|---|
| `supabase/migrations/0004_seed_demo_accounts.sql` | 4 demo accounts (Siemens, Mondelēz, Sanofi, Novo Nordisk) + `account_assignments` |
| `apps/api/app/models/account.py` | `Account` ORM (mirrors `public.accounts`) |
| `apps/api/app/schemas/account.py` | `AccountListItem`, `AccountListResponse`, `AccountListFilters` |
| `apps/api/app/routes/accounts.py` | `GET /api/v1/accounts` + `require_account_access` factory |
| `apps/api/app/main.py` | Route registered |
| `apps/api/app/core/rbac.py` | `can_view_account`, `can_edit_account` helpers |
| `apps/api/app/db/session.py` | Engine `connect_args` set for pgbouncer (statement cache disabled) |
| `apps/api/.env` | DATABASE_URL switched to pooler (IPv4-friendly) |
| `apps/api/tests/test_accounts.py` | 14 tests covering scope, search, filter, sort, pagination, is_editable |
| `apps/web/src/types/account.ts` | TS types mirroring Pydantic schemas |
| `apps/web/src/lib/format.ts` | `formatACV`, `formatRenewalDays`, `formatRelativeDate`, `healthBucket`, `initials` |
| `apps/web/src/components/AppShell.tsx` | Sidebar + brand chrome wrapping authenticated pages |
| `apps/web/src/routes/accounts/AccountListPage.tsx` | Main page: search, filters, sort, pagination, table |
| `apps/web/src/App.tsx` | `/` redirects to `/accounts`; `/accounts` mounted under `RequireAuth` |

## Data model

Reads from existing tables (M2). No new tables.

- `accounts` — primary
- `users` — joined twice (csm, co) for full names
- `account_assignments` — used for is_editable (CSM-flavored roles only)

`is_editable` is computed per row using `can_edit_account(role, is_assigned)`:
- `is_assigned = (account.csm_user_id == user.id) || (account.co_user_id == user.id)`
- Multi-role assignments via `account_assignments` table are honored at the RLS layer; M3 only checks the direct columns for performance.

## API contracts

### `GET /api/v1/accounts`

**Auth:** Bearer token (Supabase JWT) required.

**Query params:**

| Param | Type | Default | Notes |
|---|---|---|---|
| `q` | string | — | LIKE-search across name, country, industry (case-insensitive) |
| `csm_user_id` | UUID | — | Filter by assigned CSM |
| `industry` | string | — | Exact match |
| `tier` | string | — | Exact match (T1/T2/etc.) |
| `category` | string | — | Exact match |
| `region` | string | — | Exact match |
| `page` | int ≥ 1 | 1 | |
| `page_size` | int 1..200 | 50 | |
| `sort` | enum | `name` | `name` / `renewal_date` / `current_acv` / `health_score` / `last_activity_at`. Unknown values fall back to `name` (no 400). |
| `sort_dir` | enum | `asc` | `asc` / `desc` |

**Response 200:**

```json
{
  "items": [
    {
      "id": "11111111-...",
      "name": "Siemens Energy AG",
      "slug": "siemens-energy",
      "industry": "Power & Electrical Equipment",
      "country": "Germany",
      "region": "Europe",
      "csm_user_id": "576ceb5f-...",
      "co_user_id": "3bbefe03-...",
      "csm_full_name": "Harish S",
      "co_full_name": "Santosh Peshkar",
      "category": "Energy",
      "tier": "T1",
      "account_type": "Hyper Growth",
      "segment": "Segment C",
      "current_acv": "420000.00",
      "target_acv": "630000.00",
      "renewal_date": "2026-06-30",
      "days_to_renewal": 53,
      "health_score": 78,
      "last_activity_at": "2026-05-06T...",
      "is_editable": true
    }
  ],
  "total": 4,
  "page": 1,
  "page_size": 50
}
```

**Errors:**
- `401 Not authenticated` — missing/bad Bearer token
- `403 User not provisioned` — token valid but user not in `public.users`

### `require_account_access(write=...)` (factory; used in M4+)

```python
@router.get("/{account_id}", dependencies=[Depends(require_account_access())])
@router.patch("/{account_id}", dependencies=[Depends(require_account_access(write=True))])
```

Returns the resolved `Account` and short-circuits with `404 Account not found` or `403 Forbidden on this account` based on role + assignment.

## Role scope (server-side)

Implemented inline in `list_accounts` (the placeholder helper was removed):

| Role | Visible scope |
|---|---|
| `admin`, `cs_director`, `vp_csm`, `vp_sales` | all (global admin) |
| `vp_solutioning`, `vp_inside_sales` | all (global reader, read-only) |
| `solutioning_manager`, `inside_sales_manager` | all (read scope) |
| `commercial_owner` | all (read scope; write narrowed at sub-resource level) |
| `csm`, `cs_team_manager` | rows where `csm_user_id == auth.uid()` OR `co_user_id == auth.uid()` |
| anything unrecognised | empty (`where false`) |

Postgres RLS provides a third wall — even if the FastAPI filter were bypassed, the DB would refuse to return forbidden rows.

## Sorting whitelist

`apps/api/app/routes/accounts.py` keeps a `_SORT_COLUMNS` dict mapping the public string keys to SQLA columns. Anything not in the dict silently falls back to `Account.name` — prevents enumeration / accidental SQL exposure.

## Frontend state

### Component tree
```
<RequireAuth>
  <AppShell>
    <AccountListPage>
      <Search input>
      <Select x 3 (industry, tier, region)>
      <Table>
        <Th sortable />
        <Row x N>
      </Table>
      <Pagination>
    </AccountListPage>
  </AppShell>
</RequireAuth>
```

### URL state
All filters live in the query string so the page is bookmarkable and shareable: `/accounts?q=pharma&tier=T2&sort=current_acv&sort_dir=desc&page=2`.

### TanStack Query keys
- `["accounts", { q, industry, tier, region, sort, sortDir, page }]`

`placeholderData: keepPreviousData` keeps the table on screen during refetch — no flash to skeleton on every keystroke.

### Search debounce
250ms (`useMemoizedDebounce`). Avoids one request per keystroke.

## Sequence — load + search + filter

```
Browser              FastAPI                Postgres (RLS aware)
   |--GET /accounts------>|                       |
   |   ?q=pharma          |                       |
   |   ?tier=T2           |--scope filter (role)->|
   |   Bearer <jwt>       |--SELECT joined users->|
   |                      |<--rows returned-------|
   |<--{items, total}-----|                       |
```

## Validation

- Pydantic-validates every query param.
- `sort_dir` is loose (any non-"desc" treated as "asc") rather than 400 — friendly UX.
- `page_size` clamped to 1..200.
- UUIDs strictly parsed.

## Tests

`apps/api/tests/test_accounts.py` — 14 tests covering:
- Auth: `test_accounts_unauth_401`
- Role scope: admin/vp_sales/solutioning sees all; csm sees own
- Search: by name, country, industry
- Filters: tier, industry
- Sort + pagination: `sort=current_acv&sort_dir=desc`, `page=1&page_size=2`
- Invalid sort → falls back gracefully
- `is_editable` per role (admin all-true, csm assigned, vp_solutioning all-false when applicable)
- `days_to_renewal` computed

End-to-end (run from repo root via test harness):
- 7/7 pass — admin/csm/solutioning login + correct row counts + correct `is_editable` distribution.

## Configuration

### Pooler URL gotcha (M3 discovery)

Supabase's direct DB host (`db.<ref>.supabase.co`) is **IPv6-only** for new projects. Most networks (including CI runners) can't resolve it. We switched to the **transaction-mode pooler**:

```
postgresql+asyncpg://postgres.<ref>:<password>@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres
```

Required for asyncpg + pgbouncer compatibility:
```python
connect_args={"statement_cache_size": 0, "prepared_statement_cache_size": 0}
```

Codified in `apps/api/app/db/session.py`. The pooler is also the right choice for Render (production) since Render IPv6 support is inconsistent.

## Security notes

- **Auth required:** yes
- **RBAC layer:** server-side scope filter + RLS at DB
- **Search input:** parameterized via SQLAlchemy `func.lower(...).like(...)` — no injection vector
- **`is_editable` is advisory** — the real edit gate is on the PATCH/DELETE routes (M5+) using `require_account_access(write=True)`
- **Input limits:** `page_size <= 200` to prevent expensive queries
- **No raw SQL anywhere**

## Performance

- `accounts` indexed on `csm_user_id`, `co_user_id`, `renewal_date` (M2 migration).
- Joins are `LEFT JOIN users` x2 (csm, co) — small, indexed by PK.
- `LIMIT/OFFSET` pagination on a sorted result set; secondary sort by `name` ensures stable ordering across pages.
- Pooler latency from local dev to ap-northeast-1: ~120ms per query. Production will run from Render which can be co-located.
- Lighthouse target (BRD): <1.5s for 600 accounts. With current schema and pagination, expected p50 well under that.

## Known limitations & TODOs

- `account_assignments` row check is not yet exercised (no users assigned via that table; only direct `csm_user_id`/`co_user_id`). Will matter when CS Team Manager scope ships.
- "CSM" filter dropdown should populate from `users` table (admins/etc. can filter by any CSM); currently it accepts a UUID only via URL.
- "Last activity" is currently the seeded value; will be wired to `audit_log` derivation in M5+.
- No facet aggregation endpoint yet — frontend derives industry/tier/region options from the current page only. Acceptable for ≤ 600 accounts; revisit if scale grows.
- Sort by `health_score` works but the score itself is computed in Sprint 6.
