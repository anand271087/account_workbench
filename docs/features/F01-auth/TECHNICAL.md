# F01 — Login & Authentication — Technical

## Files touched

| File | Purpose |
|---|---|
| `apps/web/src/lib/auth.ts` | `AuthProvider` interface — abstraction so SSO drop-in is one import swap |
| `apps/web/src/lib/auth-supabase.ts` | Phase 1 implementation wrapping `@supabase/supabase-js` |
| `apps/web/src/lib/supabase.ts` | Browser Supabase client — fails loudly if `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` are missing |
| `apps/web/src/lib/api.ts` | Typed fetch client; auto-attaches the Supabase JWT to every request |
| `apps/web/src/components/AuthProvider.tsx` | React context — exposes `authUser`, `me`, `signIn`, `signOut`, `useHasRole` |
| `apps/web/src/components/RequireAuth.tsx` | Route guard HOC — redirects to `/login`, blocks if `me` 403, gates by role |
| `apps/web/src/routes/_auth/login.tsx` | Login screen UI (Beroe brand styling from prototype) |
| `apps/web/src/routes/home.tsx` | Post-login landing page — placeholder until M3 |
| `apps/web/src/types/auth.ts` | TS types mirroring the FastAPI Pydantic schemas |
| `apps/api/app/core/deps.py` | JWT verification + `get_current_user` dependency |
| `apps/api/app/db/session.py` | Async SQLAlchemy session factory |
| `apps/api/app/models/user.py` | `User` ORM model |
| `apps/api/app/schemas/user.py` | `UserOut`, `Permissions`, `MeResponse` Pydantic schemas |
| `apps/api/app/routes/auth.py` | `GET /api/v1/me` endpoint |
| `apps/api/tests/conftest.py` | Pytest fixtures: env loading, JWT minting, seeded user lookup |
| `apps/api/tests/test_auth.py` | Auth + permissions tests (10 tests) |
| `supabase/migrations/0001_init_schema.sql` | `users` table (FK to `auth.users`) |
| `scripts/seed_users.mjs` | Idempotent seed of 5 placeholder users via Auth Admin API + PostgREST |

## Data model

### `public.users` (M2)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | FK to `auth.users.id` (cascade delete) |
| `email` | text unique | matches the Supabase Auth identity |
| `full_name` | text |  |
| `role` | role_key enum | one of 11 BRD roles |
| `team_id` | uuid FK → teams |  |
| `created_at`, `updated_at` | timestamptz |  |
| `deleted_at` | timestamptz | soft delete |

Indexes: `idx_users_role` (filtered `where deleted_at is null`), `idx_users_team`.

## API contracts

### `GET /api/v1/me`

**Auth:** required (Bearer token in `Authorization` header).

**Response 200:**
```json
{
  "user": {
    "id": "e4e0cdd5-dc18-443b-b8e1-3da47da926b0",
    "email": "anand@beroe-inc.com",
    "full_name": "Anand",
    "role": "admin"
  },
  "permissions": {
    "is_global_admin": true,
    "is_global_reader": false,
    "can_view_solutioning": true,
    "can_view_inside_sales": true,
    "can_view_admin_panel": true,
    "can_manage_users": true
  }
}
```

**Errors:**
- `401 Not authenticated` — missing/invalid Bearer token, expired, signature mismatch
- `403 User not provisioned in this workspace` — valid Supabase JWT but no row in `public.users`

## JWT verification — dispatch on `alg`

Supabase signs user JWTs with **ES256** (asymmetric ECDSA, key rotated via JWKS) on new projects. Test JWTs minted in pytest use **HS256** with `SUPABASE_JWT_SECRET`. The verifier handles both:

| Header `alg` | Path | Key source |
|---|---|---|
| `ES256` | `_decode_supabase_jwt` → JWKS lookup by `kid` | `${SUPABASE_URL}/auth/v1/.well-known/jwks.json` (cached 1h) |
| `HS256` | `_decode_supabase_jwt` → secret comparison | `SUPABASE_JWT_SECRET` env var |

Issuer is checked for ES256 (must equal `${SUPABASE_URL}/auth/v1`). Audience must be `authenticated` for both.

## Frontend state

### Component tree
```
<QueryClientProvider>
  <BrowserRouter>
    <AuthProvider>
      <App>
        <Routes>
          /login            → <LoginPage>
          /access-denied    → <AccessDenied>
          /                 → <RequireAuth><HomePage></RequireAuth>
          *                 → <Navigate to="/" />
        </Routes>
      </App>
    </AuthProvider>
  </BrowserRouter>
</QueryClientProvider>
```

### State managed
- `AuthProvider` keeps the current Supabase auth user (`authUser`) and refreshes via `supabase.auth.onAuthStateChange`.
- `me` is fetched via TanStack Query keyed `["me", authUser.id]`, stale 60s.
- `RequireAuth` reads both, decides redirect/render.

### TanStack Query keys
- `["me", <authUserId>]` — `MeResponse` cache (refetched on auth change).

## Sequence — sign-in

```
Browser              Supabase Auth         FastAPI            DB
   |                       |                  |                |
   |--signIn(email,pwd)--->|                  |                |
   |<--{access_token}------|                  |                |
   |                       |                  |                |
   |--GET /me {Bearer}---------------------->|                |
   |                       |                  |--SELECT user-->|
   |                       |                  |<---User--------|
   |<------------- {user, permissions} ------|                |
```

## Validation rules

- Frontend: HTML5 validation (`type="email"`, `required`).
- Backend: Pydantic `EmailStr` on response shape; UUID validated for `sub` claim.

## Background jobs

None. Auth is synchronous.

## Tests

`apps/api/tests/test_auth.py` — 10 tests, 8.86s, 80% coverage:
1. `test_me_no_token_401`
2. `test_me_bad_signature_401`
3. `test_me_unknown_user_403`
4. `test_me_admin`
5. `test_me_csm`
6. `test_me_solutioning_manager`
7. `test_me_vp_sales`
8. `test_me_cs_director`
9. `test_permissions_matrix` — exhaustive role × capability assertion
10. `test_require_role_unknown_raises`

End-to-end (manual, run from repo root):
```js
// scripts/smoke_e2e.mjs (one-off; lives in commit history)
// Logs in 5 seeded users via Supabase Auth, hits FastAPI /me, asserts role + perms.
// 6/6 pass with real ES256 tokens.
```

## Configuration

| Env var | App | Required | Purpose |
|---|---|---|---|
| `VITE_SUPABASE_URL` | web | yes | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | web | yes | Public anon key for browser client |
| `VITE_API_BASE_URL` | web | yes | FastAPI base URL |
| `SUPABASE_URL` | api | yes | Project URL (for JWKS lookup) |
| `SUPABASE_JWT_SECRET` | api | yes | HS256 secret (legacy + test path) |
| `SUPABASE_SERVICE_ROLE_KEY` | api | yes | RLS bypass — server only |
| `DATABASE_URL` | api | yes | Postgres for `users` lookup |

## Security notes

- **Auth required:** yes (every protected route).
- **RBAC:** F02 layer — `require_role` decorator in `apps/api/app/core/rbac.py`.
- **Input sanitization:** Pydantic validates request bodies; UUIDs strictly parsed.
- **Output escaping:** React auto-escapes JSX; no `dangerouslySetInnerHTML`.
- **Rate limit:** TODO — `slowapi` middleware (100 req/min on auth routes) lands with M3.
- **JWT:** signed by Supabase; never minted by our backend in production. Verified locally on every request — no DB hop for verification itself.
- **Service role key:** server only. Never imported in `apps/web/`.
- **Logout:** invalidates the Supabase session server-side (Supabase Auth handles it).
- **JWKS cache:** 1h TTL with self-healing rotation handling (refresh-on-miss).

## Known limitations & TODOs

- Forgot-password UI wires Supabase's default flow but the email template + branding need a Beroe touch — left as a Sprint 5 polish item.
- Rate limit middleware lands in M3.
- Beroe SSO swap path documented in `docs/architecture/auth-and-rbac.md`; concrete `auth-sso.ts` lands when Beroe IT shares the OIDC/SAML metadata.
