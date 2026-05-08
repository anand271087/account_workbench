# OWASP Top 10 Checklist

> Checked off in every PR description before merge. M1 sets up tooling; later milestones tick boxes per feature.

## A01 — Broken Access Control
- [x] FastAPI route requires `require_role(...)` decorator (M2 — `apps/api/app/core/rbac.py`)
- [ ] FastAPI route requires `require_account_access(...)` for account-scoped routes (M3)
- [x] Postgres RLS policy in place for every Sprint-1 table (M2 — `0002_rls_policies.sql`)
- [x] Tested: 11-role permission matrix exhaustive in `test_permissions_matrix` (M2)
- [ ] Tested: row-level RLS in `tests/test_rls.py` (M3 once accounts exist)
- [x] UI hides action buttons when permission missing — `useHasRole` + conditional render
- [ ] UI filters records out of lists when permission missing — applies once lists exist (M3)

## A02 — Cryptographic Failures
- [x] All HTTPS in production (Vercel + Render auto)
- [x] JWT signed HS256 (Supabase default)
- [x] Passwords stored by Supabase Auth (bcrypt) — never our problem
- [x] No sensitive data in URLs (only in headers/body)

## A03 — Injection
- [x] All SQL via SQLAlchemy parameterized queries — zero raw strings
- [x] All inputs validated by Pydantic
- [x] React auto-escapes JSX; `dangerouslySetInnerHTML` not used
- [ ] File uploads validated by MIME (not extension alone) (M7)

## A04 — Insecure Design
- [x] Threat model written before each feature (`docs/security/threat-model.md`)
- [x] Defense-in-depth: RBAC + RLS (two layers)
- [x] Auth provider abstraction so SSO swap doesn't require rewrite

## A05 — Security Misconfiguration
- [x] CORS allowlist via `CORS_ORIGINS` env (no `*`)
- [ ] CSP header set on web responses (`default-src 'self'; ...`) (Vercel `vercel.json`)
- [ ] HSTS header (Vercel default)
- [ ] X-Frame-Options DENY (Vercel + FastAPI middleware)
- [ ] X-Content-Type-Options nosniff
- [x] Docs disabled in production (`/docs` returns 404 when env=production)

## A06 — Vulnerable & Outdated Components
- [x] Dependabot enabled (weekly)
- [x] `pip-audit` in api-ci.yml — fails on high/critical
- [x] `pnpm audit` in web-ci.yml — fails on high/critical
- [x] All deps version-pinned in lockfiles

## A07 — Identification & Authentication Failures
- [x] Lockout: 5 fails / 15 min (Supabase Auth)
- [x] Session timeout: 8h (Supabase JWT expiry per BRD F01)
- [x] Refresh-token rotation (Supabase default)
- [x] Forgot password: 30-min link (Supabase default)
- [x] Strong JWT verification — ES256 via JWKS (with kid rotation handling) + HS256 fallback; `iss` + `aud` + `sub` claims all checked (M2)
- [x] App role lives in DB, not JWT claims — JWT tampering cannot elevate role
- [ ] SameSite=Lax cookies for any cookie-based session (n/a — JWT in Authorization header)

## A08 — Software & Data Integrity
- [x] All deps pinned in `uv.lock` and `pnpm-lock.yaml`
- [ ] Docker images by SHA256 digest (not tag) in production (M8)
- [ ] CI uses `pnpm install --frozen-lockfile` (✅ in web-ci.yml)
- [x] Pre-commit blocks large files (>1MB) and private keys

## A09 — Security Logging & Monitoring
- [x] Audit log on every UPDATE/DELETE (auto via SQLAlchemy listeners — M2)
- [x] All auth events logged (Supabase Auth)
- [ ] Sentry on web + api (M2)
- [ ] Request ID propagated end-to-end (M2)
- [ ] 4xx/5xx logged with context

## A10 — SSRF
- [x] No user-supplied URLs fetched server-side
- [x] Anthropic calls only to `api.anthropic.com` (hardcoded in SDK)
- [x] Supabase calls only to `*.supabase.co` (env-pinned)

## File upload hardening (AK03.c, M7)
- [ ] MIME validation via `python-magic` (not extension alone)
- [ ] File size capped at `MAX_UPLOAD_SIZE_MB`
- [ ] Hash dedup per account
- [ ] Files stored in Supabase Storage (outside web root)
- [ ] Signed URLs only, short TTL
- [ ] AV scan via ClamAV in worker before parsing (Phase 1: skip; Phase 2 add)

## Secrets
- [x] `gitleaks` pre-commit
- [x] GitHub Secret Scanning
- [x] `.env` gitignored
- [x] Service role key isolated to server env
- [x] No secrets in chat, docs, or code comments

## Rate limits
- [ ] `slowapi` on FastAPI: 100 req/min for auth, 1000/min default (M2)

## Storage & retention
- [ ] Soft delete with 30-day restore window (M2 onward)
- [ ] Hard delete script (admin only) for true GDPR delete requests (M8)
