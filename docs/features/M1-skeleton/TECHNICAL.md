# M1 — Repo Skeleton & Dev Loop — Technical

## Files touched

| File | Purpose |
|---|---|
| `package.json` | Workspace root — pnpm + turbo orchestration |
| `turbo.json` | Pipeline definitions (dev, build, lint, test, type-check) |
| `.gitignore` | Excludes `.env*` (except example), `node_modules`, `.venv`, build artifacts |
| `.env.example` | Root — Supabase MCP token + project ref |
| `CLAUDE.md` | Living build log; updated every milestone |
| `README.md` | First-time setup instructions |
| `.pre-commit-config.yaml` | gitleaks + standard hooks (trailing whitespace, EOF, large files, private keys) |
| `docker-compose.yml` | Local Postgres + Redis + api + worker |
| `.github/workflows/web-ci.yml` | Lint/test/build/audit for `apps/web` |
| `.github/workflows/api-ci.yml` | Lint/test/audit for `apps/api` |
| `.github/workflows/security.yml` | gitleaks + block-tracked-`.env` |
| `apps/web/package.json` | React 18 + Vite + TS + Tailwind + shadcn deps |
| `apps/web/vite.config.ts` | `@/` alias, port 5173 |
| `apps/web/tsconfig.json` | Strict TS |
| `apps/web/tailwind.config.ts` | Beroe color tokens (lifted from prototype `:root`) |
| `apps/web/postcss.config.js` | Tailwind + autoprefixer |
| `apps/web/components.json` | shadcn/ui config (default style, slate base, CSS vars) |
| `apps/web/index.html` | Entry HTML; loads DM Sans + DM Mono |
| `apps/web/src/main.tsx` | React + Router + TanStack Query bootstrap |
| `apps/web/src/App.tsx` | M1 placeholder route |
| `apps/web/src/index.css` | Tailwind directives + CSS variables for shadcn theming |
| `apps/web/src/lib/utils.ts` | `cn()` helper for shadcn |
| `apps/web/src/lib/supabase.ts` | Browser Supabase client (auth only, no business data) |
| `apps/web/src/lib/auth.ts` | `AuthProvider` interface — abstraction for SSO swap |
| `apps/web/src/lib/auth-supabase.ts` | Phase 1 implementation (email/password) |
| `apps/web/src/vite-env.d.ts` | Typed `import.meta.env` |
| `apps/web/.env.example` | `VITE_*` keys |
| `apps/web/.eslintrc.cjs` | TS + react-hooks |
| `apps/api/pyproject.toml` | uv-managed deps; ruff + mypy + pytest config |
| `apps/api/Dockerfile` | Multi-stage; runs api or worker via CMD override |
| `apps/api/.dockerignore` | Excludes `.env`, `.venv`, tests |
| `apps/api/.env.example` | Server secrets |
| `apps/api/app/__init__.py` | Package marker, version |
| `apps/api/app/main.py` | FastAPI app factory + CORS + `/health` |
| `apps/api/app/core/config.py` | pydantic-settings — fails loudly if required env var missing |
| `apps/api/tests/test_health.py` | Smoke test — `/health` returns 200 |
| `supabase/config.toml` | Supabase CLI config (8h JWT expiry, no signup) |
| `supabase/migrations/.gitkeep` | Reserves migrations folder |
| `supabase/seed.sql` | Placeholder for M2/M8 seed data |
| `docs/architecture/overview.md` | System diagram + data flows |
| `docs/architecture/data-model.md` | Table-by-table schema |
| `docs/architecture/auth-and-rbac.md` | JWT flow + SSO swap path |
| `docs/security/secrets-policy.md` | Where keys live + rotation |
| `docs/security/owasp-checklist.md` | Per-PR checklist |
| `docs/security/threat-model.md` | STRIDE per boundary |
| `docs/features/README.md` | Feature index |

## Data model

None this milestone. The data model is **defined** in `docs/architecture/data-model.md` but **realized** in M2 onward via Alembic migrations and Supabase MCP.

## API contracts

| Method | Path | Response | Auth |
|---|---|---|---|
| GET | `/health` | `{ status: "ok", env: string, version: string }` | None |

That's it for M1. Real endpoints land in M2.

## Frontend state

- Single placeholder route `/` rendering a "skeleton ready" card.
- TanStack Query provider wired (no queries yet).
- React Router wired (single route).
- Auth provider abstraction in place but not yet exercised.

## Sequence diagrams

None this milestone.

## Validation rules

- `apps/api/app/core/config.py` validates env vars via Pydantic at boot. Missing `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `DATABASE_URL`, `ANTHROPIC_API_KEY` → fail to start with a clear traceback.
- `apps/web/src/lib/supabase.ts` throws at import if `VITE_SUPABASE_URL` or `VITE_SUPABASE_ANON_KEY` is missing.

## Background jobs

Celery worker runs but has no registered tasks yet. Real tasks (`process_document`, `generate_summary`) land in M7.

## Tests

- `apps/api/tests/test_health.py::test_health` — boots app with placeholder env, hits `/health`, asserts 200 with `status=ok`.
- Frontend has no tests this milestone (no logic to test).

## Configuration

See `apps/api/.env.example` and `apps/web/.env.example`. Every env var is documented inline.

## Security notes

- All `.env` files gitignored (verified by `security.yml` workflow).
- Pre-commit `gitleaks` scans for AWS keys, Supabase keys, Anthropic `sk-ant-*` patterns, JWT-shaped strings.
- Service role key never imported in `apps/web/`.
- API docs (`/docs`, `/redoc`) disabled when `ENV=production`.
- CORS allowlist via `CORS_ORIGINS` — no `*`.
- Auth required: nothing yet (M2).

## Known limitations & TODOs

- mypy is `continue-on-error: true` in `api-ci.yml` for M1. Tighten to fail-on-error in M2 once we have real code paths.
- Sentry not yet wired (env var stub only). Wire in M2 with auth.
- Frontend has no tests yet — add Vitest + React Testing Library setup in M2.
- AV scanning (ClamAV) for uploads is deferred — added in M7 or v1.1.
- Audio/video transcription deferred to v1.1 per BRD scoping.
