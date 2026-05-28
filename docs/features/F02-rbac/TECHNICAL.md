# F02 — Roles & Access Control — Technical

> **Source of truth:** `Roles_Access_Matrix_Reviewed_05072026.xlsx`. All role groups + per-function helpers in `apps/api/app/core/rbac.py` mirror the matrix verbatim. The full grid lives in `FUNCTIONAL.md`; this document covers the implementation.

## Three walls of enforcement

```
1. Frontend role gating (UX only)        2. FastAPI dependencies          3. Postgres RLS
   — RequireAuth + useHasRole               — require_role(*roles)            — policies on every table
   — Hide buttons, filter lists             — require_admin()                 — current_user_role() helper
                                            — get_current_user                — user_assigned_to_account()
```

A bug in one layer is caught by the next. Tests assert each layer independently.

## Files touched

| File | Layer | Purpose |
|---|---|---|
| `apps/api/app/core/rbac.py` | Backend | Role groups, capability helpers, `require_role` factory |
| `apps/api/app/core/deps.py` | Backend | `get_current_user` dependency (returns user with `role` attached) |
| `apps/api/app/schemas/user.py` | Backend | `Permissions` schema returned by `/api/v1/me` |
| `apps/api/tests/test_auth.py` | Backend | Permissions matrix test — exhaustive 11-role assertion |
| `supabase/migrations/0002_rls_policies.sql` | DB | RLS policies + helper functions |
| `apps/web/src/types/auth.ts` | Frontend | `RoleKey` union + `ROLE_LABELS` map |
| `apps/web/src/components/AuthProvider.tsx` | Frontend | `useHasRole(...roles)` hook |
| `apps/web/src/components/RequireAuth.tsx` | Frontend | Route guard — `roles` prop gates by role |

## Role groups (source of truth — matrix-aligned)

Defined in `apps/api/app/core/rbac.py`:

```python
GLOBAL_ADMIN_ROLES   = {"admin", "cs_director", "vp_csm"}              # F-on-most
GLOBAL_READER_ROLES  = {"vp_sales", "vp_solutioning", "vp_inside_sales"}  # V-on-most
SOLUTIONING_ROLES    = {"solutioning_manager", "vp_solutioning"}
INSIDE_SALES_ROLES   = {"inside_sales_manager", "vp_inside_sales"}
CSM_ROLES            = {"csm", "cs_team_manager"}
AUDIT_VIEWER_ROLES   = {"admin", "cs_director", "vp_csm",
                        "vp_sales", "vp_solutioning", "vp_inside_sales"}
```

**M3 realign (2026-05-08):** `vp_sales` moved from `GLOBAL_ADMIN_ROLES` to `GLOBAL_READER_ROLES` per matrix. The matrix overrides the BRD §3.2 narrative.

Per-function write predicates (each takes `role`, `is_assigned`, `is_team`, sometimes `kind`):
- `can_write_engagement(role, *, is_assigned, is_team)` — rejects `solutioning_manager` per Q3
- `can_write_contacts(...)` — `solutioning_manager` allowed (matrix)
- `can_write_documents(..., kind)` — VPDs writable only by globals + `solutioning_manager`; MOMs by all CS-flavored roles within scope
- `can_view_account(...)` / `can_edit_account(...)` — account-level
- `can_view_audit_log(role)` — VPs + CS Director + Admin
- `can_bulk_import(role)` — CS Director / VP — CSM / Admin only
- `can_reassign_account_owner(role)` — admin only

## /me capability snapshot (post-realign)

These are the high-level booleans returned by `GET /api/v1/me` — the frontend uses them to hide top-level UI sections. Per-function write decisions are NOT here; those go through the API on every action.

| Role | global_admin | global_reader | view_solutioning | view_inside_sales | admin_panel | manage_users |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| csm | | | ✓ | | | |
| cs_team_manager | | | ✓ | | | |
| cs_director | ✓ | | ✓ | ✓ | | |
| vp_csm | ✓ | | ✓ | ✓ | | |
| commercial_owner | | | ✓ | | | |
| **vp_sales** | | **✓** | ✓ | ✓ | | |
| solutioning_manager | | | ✓ | | | |
| vp_solutioning | | ✓ | ✓ | ✓ | | |
| inside_sales_manager | | | ✓ | ✓ | | |
| vp_inside_sales | | ✓ | ✓ | ✓ | | |
| admin | ✓ | | ✓ | ✓ | ✓ | ✓ |

The full per-function matrix lives in `FUNCTIONAL.md`. This is the **summary**, not the source of truth.

Tests: `test_permissions_matrix` + `test_audit_viewer_roles` + `test_bulk_import_roles` + `test_reassign_admin_only` in `apps/api/tests/test_auth.py`.

## Postgres RLS — design

Every table has RLS enabled. Policies use SECURITY DEFINER helper functions to look up the current user's role from `public.users`:

```sql
create function current_user_role() returns role_key
  language sql stable security definer set search_path = public as
$$ select role from public.users where id = auth.uid() and deleted_at is null $$;

create function user_assigned_to_account(p_account uuid) returns boolean
  language sql stable security definer set search_path = public as
$$ select exists (
    select 1 from public.account_assignments
    where account_id = p_account and user_id = auth.uid()
  ) or exists (
    select 1 from public.accounts a
    where a.id = p_account
      and (a.csm_user_id = auth.uid() or a.co_user_id = auth.uid())
      and a.deleted_at is null
  ) $$;

create function role_is_global_admin() returns boolean
  language sql stable as
$$ select current_user_role() in ('admin','cs_director','vp_csm','vp_sales') $$;

create function role_is_global_reader() returns boolean
  language sql stable as
$$ select current_user_role() in ('vp_solutioning','vp_inside_sales') $$;
```

### Key policies

| Table | SELECT scope | WRITE scope |
|---|---|---|
| `users` | self + global_admin/reader | admin only |
| `accounts` | global_admin/reader, csm/co/assigned, solutioning/inside_sales/co (read) | csm own row, global_admin all |
| `account_engagement` | global_admin/reader, solutioning, assigned | global_admin, solutioning_manager, assigned |
| `client_contacts` | global_admin/reader, solutioning, assigned | global_admin, solutioning_manager, assigned |
| `documents` | global_admin/reader, solutioning, assigned | global_admin, assigned, solutioning_manager (kind='vpd' only) |
| `account_discovery_summary` | same as account | service_role only (worker writes) |
| `audit_log` | global_admin, own actions | service_role only |
| `lookup_*` | any authed user | admin only |

Service role key bypasses RLS — used by Celery worker and for `audit_log` writes. Browser code never has it.

## API contracts

### `require_role(*roles)` — usage example

```python
from fastapi import APIRouter, Depends
from app.core.rbac import require_role, require_admin

router = APIRouter(prefix="/api/v1")

@router.post("/admin/users", dependencies=[Depends(require_admin())])
async def create_user(...): ...

@router.get(
    "/leadership/portfolio",
    dependencies=[Depends(require_role("vp_sales", "vp_csm", "cs_director", "admin"))],
)
async def leadership_view(...): ...
```

A `require_role` call with an unknown role string raises `ValueError` at app boot (caught by `test_require_role_unknown_raises`).

## Frontend gating example

```tsx
import { useHasRole, useAuth } from "@/components/AuthProvider";

export function AdminMenu() {
  const { me } = useAuth();
  if (!me?.permissions.can_view_admin_panel) return null;   // hidden, not greyed out
  return <NavLink to="/admin">Admin</NavLink>;
}

// Or by route:
<Route path="/admin/*" element={
  <RequireAuth roles={["admin"]}>
    <AdminLayout />
  </RequireAuth>
} />
```

## Sequence — protected request

```
Browser            FastAPI                Postgres
   |                  |                       |
   |--GET /resource-->|                       |
   |   Bearer <jwt>   |                       |
   |                  |--get_current_user---->|
   |                  |    SELECT user        |
   |                  |<--User(role=csm)------|
   |                  |                       |
   |                  |--require_role check   |
   |                  |   pass ok / 403       |
   |                  |                       |
   |                  |--SELECT ... ---------->|
   |                  |   (RLS applies on top) |
   |                  |<---rows visible to user|
   |<--JSON response--|                       |
```

## Tests

- `test_permissions_matrix` — every role × every capability flag.
- `test_require_role_unknown_raises` — typo guard.
- `test_me_*` (5 tests) — round-trip with real JWTs for each test role.
- RLS row-level testing lands in M3 once `accounts` rows exist to filter.

## Configuration

No new env vars over F01.

## Security notes

- **Defense in depth**: even if `require_role` is forgotten on a route, RLS rejects the underlying query. Even if RLS has a hole, `require_role` rejects the request.
- **Role lookup happens once per request** — cached on the `User` ORM instance returned by `get_current_user`.
- **Roles in JWTs are ignored.** The JWT carries `role: authenticated` (the Postgres role) — our application role comes from `public.users.role`, not the JWT. This means a stolen JWT can't elevate role by tampering with claims.
- **Auth required:** yes (every protected route).
- **Rate limit:** 403s also get rate-limited (M3) to prevent role-enumeration scanning.

## Known limitations & TODOs

- Multi-role per user is deferred (BRD note).
- `Roles_Access_Matrix_v1.xlsx` not yet shared by Beroe — when received, regenerate `rbac.py` constants and re-run tests.
- RLS tests at row-level land in M3 (need real account data to test against).
- Account-scoped RBAC (`require_account_access(account_id)`) lands in M3 with the account list.
- Admin user-management UI lands in Sprint 5.

---

## Calculation Reference (single source of truth — RBAC predicate map)

Every RBAC check across the codebase calls one of these predicates from [`apps/api/app/core/rbac.py`](../../../apps/api/app/core/rbac.py). The frontend mirrors them via `data.is_editable` / `data.can_view_*` flags returned on entity GETs.

### Global predicates (no account scope)

| Predicate | Returns True for |
|---|---|
| `is_global_admin(role)` | `admin · cs_director · vp_csm` |
| `is_global_reader(role)` | `vp_sales · vp_solutioning · vp_inside_sales` |
| `can_view_solutioning(role)` | global admin + global reader + solutioning_manager |
| `can_view_inside_sales(role)` | global admin + global reader + commercial_owner + inside_sales_manager |
| `can_view_admin_panel(role)` | global admin |
| `can_manage_users(role)` | global admin |
| `can_view_audit_log(role)` | global admin + global reader (matrix Q6: "All") |
| `can_view_leadership(role)` | global admin + VP roles |
| `can_bulk_import(role)` | global admin (matrix Q8) |
| `can_reassign_account_owner(role)` | `admin · cs_director · vp_csm · vp_sales` (widened 26-May Row 50) |
| `can_create_account(role)` | global admin |
| `can_manage_users_role(role)` | global admin |

### Account-scoped predicates

`is_assigned` = caller is `account.csm_user_id` OR `account.co_user_id`.
`is_team` = `account.csm_user_id ∈ caller's team` (only meaningful for `cs_team_manager`).

| Predicate | Write set |
|---|---|
| `can_write_engagement(role, ...)` | global admin + csm (own) + cs_team_manager (team) + commercial_owner (own) + inside_sales_manager (own). Solutioning Manager: **V only** (matrix Q3) |
| `can_write_contacts(role, ...)` | same as engagement |
| `can_write_solutioning(role, ...)` | global admin + solutioning_manager (all) + commercial_owner (own) + inside_sales_manager (own) |
| `can_write_cs_onboarding(role, ...)` | global admin + csm (own) + cs_team_manager (team) |
| `can_write_sales_handoff(role, ...)` | global admin + vp_sales + vp_inside_sales + commercial_owner (own) + inside_sales_manager (own) + solutioning_manager (post-lock only) |
| `can_sign_account(role, ...)` | global admin + vp_sales + vp_inside_sales + commercial_owner (own) + inside_sales_manager (own). CSM + Solutioning **cannot** sign. |
| `can_unlock_signing(role)` | global admin **only** (asymmetric — every unlock lands under a director-grade user) |
| `can_view_account(role, ...)` | global admin + global reader + csm + cs_team_manager + solutioning + commercial_owner (own only) |
| `can_edit_account(role, ...)` | global admin OR (csm + own) OR (cs_team_manager + team) |

### `can_write_documents` per-kind branches

| Kind | Write set |
|---|---|
| `mom` (Meeting Records) | global admin + solutioning_manager + csm (own) + cs_team_manager (team) + inside_sales_manager (own) |
| `vpd` (Value Proposition Deck) | global admin + solutioning_manager **only** |
| `contract` (27-May Row 50 + 59) | global admin + vp_sales + vp_inside_sales + commercial_owner (own) + inside_sales_manager (own) + **csm (own)** + **cs_team_manager (team)** (widened so CSMs receiving handoff can upload) |
| `recording / transcript / email / other` | Same as `mom` |

### Asymmetric escape hatches (lock/unlock asymmetry)

This pattern recurs across M13/M19/M21/M22/M23. Forward action is broad; reverse is admin-only so audit trail attributes every undo to a director-grade user.

| Lock / Action | Anyone with write capability | Reverse (admin-only) |
|---|---|---|
| M13 Signing | sign | unlock signing |
| M19 Success Contract lock | lock | unlock |
| M21 Checkpoint sign-off | sign off (permanent) | admin re-open (deletes snapshot) |
| M22 VDD lock | lock (after 4-section check) | unlock |
| M23 D&R outcome stamp | renewed / at_risk / not_renewed | re-open + clear |
| M27 SoftSignal resolve | resolve (≥5 char note) | reopen |
| Goals soft-delete | delete (with reason ≥5 chars) | admin restore (within 30 days) |

### Frontend gating contract

Frontend NEVER computes RBAC — just reads capability flags returned on entity GETs:

| Field | Source predicate |
|---|---|
| `account.is_editable` | `can_edit_account` |
| `account.can_view_*` | the matching predicates |
| Engagement `is_editable` | `can_write_engagement` |
| Documents `is_editable` | `can_write_documents(kind=<from query>)` — **kind-aware** (Row 50 fix) |
| Solutioning `is_editable` | `can_write_solutioning AND not locked` |
| SigningGate `can_sign / can_unlock` | matching predicates |

### 403 → /access-denied redirect

[`apps/web/src/lib/api.ts`](../../../apps/web/src/lib/api.ts) catches every 403 response and pushes the user to `/access-denied?from=<path>&detail=<server msg>`. Prevents silent "click does nothing" failure mode.

### Server-side defense-in-depth

Predicates run at TWO layers per request:
1. **Endpoint guard** (`require_role(...)` or per-route `can_*` check) → 403 before handler runs
2. **RLS** at DB level → policy on every table uses `current_user_role()` + `user_assigned_to_account()` helper SQL functions

Both must pass. Bypassing FastAPI (e.g. raw asyncpg) still hits RLS.

### Where to change these values

| To change | Edit |
|---|---|
| Any predicate's role set | [`apps/api/app/core/rbac.py`](../../../apps/api/app/core/rbac.py) |
| RLS policy | [`supabase/migrations/0002_rls_policies.sql`](../../../supabase/migrations/0002_rls_policies.sql) + add a follow-up migration |
| Contract-kind RBAC widening | `can_write_documents` (kind=="contract" branch) |
| Frontend gating | Don't — read from the API's capability flags |
