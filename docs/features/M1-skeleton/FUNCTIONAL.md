# M1 — Repo Skeleton & Dev Loop

## What it does

Sets up the foundation that every subsequent feature stands on. After M1 the team can:
- Pull the repo, run two commands, and have a working local environment
- Open a pull request that automatically runs lint, tests, type-checks, secret scans, and dependency audits
- Trust that no secret can be accidentally committed to git
- Trust that Claude Code (via the Supabase MCP server) can apply database changes directly

This milestone ships **no user-facing features** by design — it is the safety harness for the next 7 milestones.

## Who uses it

Engineers and Claude Code (during development). Stakeholders see the result indirectly: faster, safer feature delivery and a clean preview URL for each feature.

## How it works

### For an engineer joining the project
1. Clone the repo.
2. Copy `.env.example` files at root, `apps/web/`, and `apps/api/`. Fill in the keys (README walks through each one).
3. `pnpm install` (frontend deps) + `cd apps/api && uv sync` (backend deps).
4. `pre-commit install` (so secrets can never be committed).
5. `pnpm docker:up` (Postgres + Redis come up).
6. `pnpm dev` (web + api + worker run in parallel).
7. Open http://localhost:5173 — see the placeholder home page confirming everything boots.

### For a code change
1. Push a branch.
2. GitHub Actions runs:
   - `web-ci` — lint, type-check, test, build, dependency audit
   - `api-ci` — ruff lint/format, mypy type check, pytest, pip-audit
   - `security` — gitleaks (secret scan), block any committed `.env`
3. Vercel posts a preview URL on the PR.
4. Reviewers see green checks before merging.

## Business rules

- **No secret may be committed.** The pre-commit hook blocks it; CI rejects it; GitHub Secret Scanning catches it as a final safety net.
- **Every dependency is pinned and audited weekly** (Dependabot + `pnpm audit` + `pip-audit`).
- **The frontend never sees server-only secrets.** Only `VITE_*`-prefixed env vars are bundled.
- **The Supabase service role key (which bypasses RLS) lives only on the server**, never in browser code, never in git.
- **Supabase MCP is the preferred way to apply schema changes** — Claude Code talks to the database directly when the access token is in `/.env`. Manual SQL via the dashboard is the fallback.

## What it stores

Nothing yet — M1 is infrastructure. Database tables ship in M2 and onward.

## What gets logged

Nothing user-visible. Internal logs:
- Local dev: `docker compose logs -f`
- CI: GitHub Actions tab on each PR

## Edge cases

| Scenario | What happens |
|---|---|
| Engineer forgets to copy `.env.example` to `.env` | App fails loudly at startup with a clear error pointing at the missing file |
| Engineer commits a `.env` by mistake | Pre-commit hook blocks the commit. If somehow pushed, the `security` workflow fails the PR |
| Engineer pastes a Supabase service role key into code | Pre-commit `gitleaks` rejects the commit |
| Supabase access token in root `.env` is missing | MCP server cannot manage Supabase from Claude Code; fallback to manual `psql` or dashboard SQL editor |
| `pnpm install` fails on different Node version | Engines field in `package.json` rejects Node <20 |

## Status

🚧 In progress

## Demo

Once M1 lands, the demo is: clone the repo, run two commands, see the app boot and the placeholder render in the browser. There is no UI to demo — that's M2 onwards.
