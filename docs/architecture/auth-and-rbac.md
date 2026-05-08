# Auth & RBAC

## Phase 1 — Supabase Auth (email + password)

**Flow**
1. User enters email/password on `/login`.
2. Frontend calls `supabase.auth.signInWithPassword(...)` (via the `authProvider` abstraction).
3. Supabase returns access JWT + refresh token; Supabase JS persists in `localStorage`.
4. Subsequent API calls attach `Authorization: Bearer <jwt>`.
5. FastAPI `Depends(get_current_user)` verifies signature using `SUPABASE_JWT_SECRET` and looks up `users.role`.

**Failure handling per BRD F01**
- Invalid creds → 401 with "Invalid email or password" inline.
- 5 consecutive failures → Supabase locks for 15 min.
- Forgot password → magic-link email valid 30 min.
- Idle 8h → JWT expiry forces re-login.

## Phase 2 — Beroe SSO (drop-in)

The frontend imports a single `authProvider` from `apps/web/src/lib/auth.ts`. Switching providers is one line.

### Option A — Supabase OAuth/SAML provider (preferred)

Beroe IT registers OIDC or SAML metadata in Supabase Dashboard → Auth → Providers. Frontend then calls:

```ts
await supabase.auth.signInWithOAuth({ provider: "beroe-sso" });
```

**Backend changes:** zero. Supabase still issues the JWT; FastAPI verification is identical.

### Option B — Token exchange

If we cannot register Beroe SSO with Supabase (e.g. on free tier or for IT policy reasons), Bala's OAuth integration code returns a Beroe JWT. We add `/api/v1/auth/sso/exchange`:
1. Validate the Beroe JWT (against Beroe's JWKS).
2. Look up or create a corresponding `users` row.
3. Mint a Supabase session via `supabase.auth.admin.generateLink(...)` or `auth.admin.createUser(...)` flow.
4. Return Supabase JWT to the frontend.

The frontend swaps `auth-supabase.ts` for `auth-sso.ts` which calls this endpoint instead of `signInWithPassword`.

## RBAC — 11 roles × 13 functions

Source of truth: `Roles_Access_Matrix_v1.xlsx` (Beroe to share). Until then we encode BRD §3.2 narrative:

| Role | Scope |
|---|---|
| CSM | Own assigned accounts (read-write) |
| CS Team Manager | Their team's accounts (read-write); others read-only |
| CS Director | All accounts (read-write) |
| VP — CSM | All accounts (read-write) |
| Commercial Owner | Own portfolio (read-write commercial fields); all read-only |
| VP — Sales | All accounts (read-write); leadership view (full) |
| Solutioning Manager | All accounts (read-write solutioning sections); other sections read-only |
| VP — Solutioning | All accounts (read-only); leadership view (full) |
| Inside Sales Manager | All accounts (read-write inside sales sections) |
| VP — Inside Sales | All accounts (read-only); leadership view (full) |
| Admin | All accounts; user management; role assignment; audit log |

### Two-layer enforcement

1. **FastAPI middleware** — `require_role(*allowed)` and `require_account_access(account_id)` decorators run on every protected route. 403 immediately on mismatch.
2. **Postgres Row Level Security** — every table has a policy keyed off `auth.uid()` and the `users.role`. Even with a leaked service role key (we don't expose it to begin with), or a FastAPI bug, the database refuses to return rows.

### UI behavior
- If the user lacks permission to a function: **hide the action button** (do not show greyed-out — BRD requirement).
- If the user lacks permission to a record: **filter it out of lists** (do not show a placeholder).
- If a forbidden action is attempted by URL: redirect to `/access-denied`.

## JWT verification — fast path

```python
# apps/api/app/core/deps.py (lands M2)
from jose import jwt
from app.core.config import get_settings

def verify_jwt(token: str) -> dict:
    settings = get_settings()
    return jwt.decode(
        token,
        settings.supabase_jwt_secret.get_secret_value(),
        algorithms=["HS256"],
        audience="authenticated",
    )
```

No DB hop on the hot path. The `users.role` lookup happens once per request inside a session-scoped cache.
