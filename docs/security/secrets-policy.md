# Secrets Policy

## Hard rules

1. **Every secret lives in a `.env` file or hosting-provider secret store.** Nothing secret in code, in git, in CLAUDE.md, in docs, in chat.
2. **`.env` files are never committed.** Only `.env.example` files (with placeholder values) are tracked.
3. **The service role key never reaches the browser.** It lives only in `apps/api/.env` (locally) and Render env vars (production).
4. **No secret is shared in plaintext over chat or email.** Use 1Password / a secret store. Rotate any key that leaks immediately.

## Where each secret lives

| Secret | Local file | Production location | Rotation cadence |
|---|---|---|---|
| `SUPABASE_ACCESS_TOKEN` (MCP) | `/.env` | not used in prod | If revoked / quarterly |
| `SUPABASE_PROJECT_REF` | `/.env` | n/a (not secret) | n/a |
| `VITE_SUPABASE_URL` | `apps/web/.env` | Vercel env var (public) | n/a |
| `VITE_SUPABASE_ANON_KEY` | `apps/web/.env` | Vercel env var (public) | If compromised |
| `SUPABASE_URL` | `apps/api/.env` | Render env var | n/a |
| `SUPABASE_SERVICE_ROLE_KEY` | `apps/api/.env` | Render env var ⚠️ secret | Quarterly + on incident |
| `SUPABASE_JWT_SECRET` | `apps/api/.env` | Render env var ⚠️ secret | Quarterly + on incident |
| `DATABASE_URL` | `apps/api/.env` | Render env var ⚠️ secret | When DB password rotated |
| `ANTHROPIC_API_KEY` | `apps/api/.env` | Render env var ⚠️ secret | Quarterly |
| `SENTRY_DSN` | `apps/api/.env` | Render env var | n/a (not secret per Sentry docs) |

## Enforcement

- **`.gitignore`** excludes `.env`, `.env.*` (except `.env.example`), `**/secrets/**`.
- **Pre-commit hook** (gitleaks) scans staged files for secret patterns. Blocks commit on match.
- **GitHub Action `security.yml`** runs gitleaks on every PR; rejects any tracked `.env` file.
- **GitHub Secret Scanning** enabled at repo level (built-in to GitHub).
- **Dependabot** alerts on dependency CVEs; weekly update PRs.

## What to do if a key leaks

1. **Rotate immediately** — Supabase dashboard for `service_role` and `jwt_secret`; Anthropic console for API key.
2. **Update the secret in Render** (production) — restart the service.
3. **Audit what could have used it** — check Supabase logs (Auth + DB) for the leaked key for the past 30 days.
4. **Document in `docs/security/incidents/<date>.md`** — what leaked, how, what we did, what we changed.
5. **Update CLAUDE.md decisions log.**

## Local dev

For local dev only, the Postgres password in `docker-compose.yml` is hardcoded as `awb_dev_only` because it never leaves the developer's machine. Local Postgres is **not** Supabase — it's a sandbox. Any actual Supabase access requires the real keys in `apps/api/.env`.
