# Beroe Account Workbench (AWB)

Monorepo for the Beroe Account Workbench — a per-account workbench for Customer Success, Sales, and Solutioning teams.

**Status:** Sprint 1 in development. See [`CLAUDE.md`](./CLAUDE.md) for the live build state.

## Tech stack

- **Frontend:** React 18 + Vite + TypeScript + Tailwind + shadcn/ui (Vercel)
- **Backend:** FastAPI + Python 3.11 + SQLAlchemy + Pydantic v2 (Render)
- **Database:** Supabase Postgres + Row Level Security
- **Auth:** Supabase Auth (email/password Phase 1; SSO Phase 2)
- **AI:** Anthropic Claude (backend-only)
- **Jobs:** Celery + Redis
- **Files:** Supabase Storage

## Repo layout

```
apps/
  web/     React frontend
  api/     FastAPI backend + Celery worker
packages/
  shared/  Generated TS types from FastAPI OpenAPI
supabase/  Migrations + seed
docs/
  features/      One folder per feature (FUNCTIONAL.md + TECHNICAL.md)
  architecture/  System diagrams, data model
  security/      OWASP checklist, threat model, secrets policy
.github/
  workflows/     CI: lint, test, secret scan, dep audit
```

## First-time setup

### 1. Install prerequisites

```bash
# Required: Node 20+, pnpm 9+, Python 3.11, Docker, uv (Python pkg mgr)
brew install node pnpm python@3.11 docker uv gitleaks
```

### 2. Clone and install

```bash
pnpm install
cd apps/api && uv sync && cd ../..
```

### 3. Populate `.env` files

Each app has a `.env.example` documenting every required key. Copy and fill:

```bash
cp .env.example .env
cp apps/web/.env.example apps/web/.env
cp apps/api/.env.example apps/api/.env
```

**Where keys come from** (see `docs/security/secrets-policy.md` for the full table):

| File | Key | Source |
|---|---|---|
| `/.env` | `SUPABASE_ACCESS_TOKEN` | Supabase dashboard → Account → Access Tokens |
| `/.env` | `SUPABASE_PROJECT_REF` | Supabase dashboard → Project URL |
| `apps/web/.env` | `VITE_SUPABASE_URL` | Project Settings → API |
| `apps/web/.env` | `VITE_SUPABASE_ANON_KEY` | Project Settings → API → `anon public` |
| `apps/api/.env` | `SUPABASE_URL` | Same as above |
| `apps/api/.env` | `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API → `service_role` ⚠️ keep secret |
| `apps/api/.env` | `SUPABASE_JWT_SECRET` | Project Settings → API → JWT Secret |
| `apps/api/.env` | `ANTHROPIC_API_KEY` | https://console.anthropic.com → API Keys |
| `apps/api/.env` | `DATABASE_URL` | Supabase → Connect → URI |

### 4. Connect Supabase MCP (one-time)

After populating root `.env` with `SUPABASE_ACCESS_TOKEN`, restart Claude Code. The Supabase MCP server will auto-register and Claude can apply migrations directly.

### 5. Install pre-commit hook

```bash
brew install pre-commit
pre-commit install
```

This blocks commits containing secrets via `gitleaks`.

### 6. Start local dev

```bash
pnpm docker:up    # Postgres + Redis
pnpm dev          # web + api + worker
```

- Frontend: http://localhost:5173
- API: http://localhost:8000
- API docs: http://localhost:8000/docs

## Per-feature documentation

Every shipped feature has two docs:

- `docs/features/<id>/FUNCTIONAL.md` — for stakeholders (no jargon, user flow, business rules)
- `docs/features/<id>/TECHNICAL.md` — for engineers (file paths, schema, contracts, tests)

## Security

- All secrets in `.env` files (never committed) — see `docs/security/secrets-policy.md`
- OWASP Top 10 checklist enforced per PR — see `docs/security/owasp-checklist.md`
- Threat model — see `docs/security/threat-model.md`
- RBAC tested via `pytest apps/api/tests/test_rls.py`

## Roadmap

See [`CLAUDE.md`](./CLAUDE.md) for current state and the build plan in `.planning/`.

## License

Proprietary — Beroe Inc.
