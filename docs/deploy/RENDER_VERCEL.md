# Deploying Beroe AWB — Render + Vercel

Order matters: **Render first** (so the API URL exists), **Vercel second**.

Total time: ~30 minutes if you already have Render + Vercel accounts linked to GitHub.

---

## Prerequisites

- Repo on GitHub: `anand271087/account_workbench` (✅ done).
- Supabase project `Account_workbench` already provisioned with all 16 migrations applied (✅ done).
- These secrets ready (you already have them in your local `apps/api/.env`):
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `SUPABASE_JWT_SECRET`
  - `DATABASE_URL` (the session-mode pooler one — port 5432)
  - `ANTHROPIC_API_KEY`

---

## Part 1 — Render (backend + worker + Redis)

The repo includes `render.yaml` so Render creates everything for you.

### 1a. Create the Blueprint

1. Open https://dashboard.render.com → **Blueprints** → **New Blueprint Instance**.
2. Connect your GitHub account if you haven't already.
3. Select the `account_workbench` repo, branch `main`.
4. Render reads `render.yaml` and proposes:
   - `beroe-awb-api` (web service, free)
   - `beroe-awb-worker` (background worker, **starter $7/mo** — workers don't have a free tier)
   - `beroe-awb-redis` (free 25 MB Redis)
5. Click **Apply**.

### 1b. Fill the secrets

After the services are created, Render shows a list of `sync: false` env vars per service. Fill them once on the **API service** (Render copies them to the worker via the same form):

| Env var | Value |
|---|---|
| `SUPABASE_URL` | `https://fclkazponiwvmvzgvwei.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | (Supabase Dashboard → Project Settings → API → service_role key) |
| `SUPABASE_JWT_SECRET` | (same page → JWT Secret) |
| `DATABASE_URL` | the session-mode pooler URL exactly as in your local `.env` (`postgresql+asyncpg://postgres.<ref>:<pwd>@aws-1-…pooler.supabase.com:5432/postgres`) |
| `ANTHROPIC_API_KEY` | your Anthropic key |

Repeat the same five vars on the **worker service**. (Auto-wired ones — `REDIS_URL`, `CORS_ORIGINS`, etc. — leave alone.)

Click **Save changes**. Each service triggers a fresh deploy. Watch the build logs — first build is ~3 min.

### 1c. Verify

- API: open `https://beroe-awb-api.onrender.com/health` → should return `{"status":"ok",...}`.
- Worker: in Render dashboard → `beroe-awb-worker` → Logs → look for `celery@... ready.`.

**Copy the API service's URL** — you need it for Vercel.

---

## Part 2 — Vercel (frontend)

### 2a. Create the project

1. Open https://vercel.com/new.
2. Import the same GitHub repo (`account_workbench`).
3. **Framework preset** → Vercel will guess "Vite" (correct).
4. **Root Directory** → set to `apps/web`. (Critical — this is a monorepo; Vercel needs to know which app to build.)
5. **Build & Output**:
   - Build command: `pnpm install --frozen-lockfile && pnpm --filter @beroe/web build`
   - Output directory: `dist`
   - Install command: leave default (Vercel handles pnpm via `packageManager` in package.json)

### 2b. Environment variables

In the Vercel project page → **Settings** → **Environment Variables**, add (Production scope):

| Name | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://fclkazponiwvmvzgvwei.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | (Supabase Dashboard → API → anon/public key) |
| `VITE_API_BASE_URL` | the Render API URL from 1c (e.g. `https://beroe-awb-api.onrender.com`) |

Click **Deploy**. First build is ~2 min.

### 2c. Verify

Open the Vercel URL Vercel hands you (looks like `https://account-workbench.vercel.app`). You should see the login screen.

---

## Part 3 — Wire CORS + Supabase Auth

The API now needs to allow requests from your real Vercel URL, and Supabase Auth needs to redirect there after password resets.

### 3a. Update Render `CORS_ORIGINS`

1. Render dashboard → `beroe-awb-api` → **Environment**.
2. Edit `CORS_ORIGINS`:

   ```
   https://account-workbench.vercel.app,https://account-workbench-*.vercel.app
   ```

   The `*` pattern matches Vercel's preview URLs from PR branches. (Save → service redeploys ~1 min.)

3. If you also have a custom domain (e.g. `awb.beroe-inc.com`), add it to the list comma-separated.

### 3b. Update Supabase Auth allowed redirects

1. Supabase Dashboard → **Authentication** → **URL Configuration**.
2. **Site URL:** `https://account-workbench.vercel.app`
3. **Redirect URLs** (one per line):

   ```
   https://account-workbench.vercel.app/**
   https://account-workbench-*.vercel.app/**
   http://localhost:5173/**
   ```

4. **Save**. Required for the password-reset email link (`/reset-password`) to work.

---

## Part 4 — Smoke test the deployed app

1. Open `https://account-workbench.vercel.app` → log in as `anand@beroe-inc.com`.
2. Sidebar shows up navy + active accounts highlight.
3. Open Siemens Energy → walk **Overview / Pre-Sales / Solutioning / Contacts / Documents** tabs. All endpoints should return 200 within ~250-400ms (Render has cold starts on the free tier — see notes).
4. Pre-Sales → propose a category → switch to admin user → /admin/categories → approve → switch back → see it un-pending.
5. Documents tab → upload the sample VPD from `sample_uploads/` → watch status pill flip Queued → Processing → Ready (~50 s with real Anthropic). Solutioning tab auto-populates.
6. AK01 → click the star on any account → it appears in the sidebar **Pinned** section, persists across logout/login.

---

## Notes

### Cold starts (free tier)
Render's free web tier spins down after 15 min of inactivity. First request after that is a 30 s cold start. Two ways to deal:
- **Upgrade the web service to Starter** ($7/mo) — no spin-down. Workers are already on Starter.
- **Or: a 5-min cron-job pinger** hitting `/health` keeps it warm (`https://cron-job.org` works, free).

### Worker scaling
The blueprint sets `--concurrency=2` on the worker. AI tasks are I/O-heavy (waiting on Anthropic), so you can safely raise this to 4-8 if doc-throughput becomes a bottleneck. Don't raise web-service concurrency — Render's free tier has 512 MB RAM and SQLAlchemy / asyncpg eat that fast.

### Auto-deploys
Both Render and Vercel auto-build on every push to `main`. PR branches → Vercel previews automatically; Render previews need to be enabled per service (Settings → Preview Environments).

### Supabase storage RLS reminder
The buckets `meeting_records`, `vpd`, `contracts` are private. Only the **service role key** (running on the Render API + worker) can write to them. Users get short-lived signed URLs from `GET /api/v1/documents/:id/download-url`. Confirm `SUPABASE_SERVICE_ROLE_KEY` is set on **both** Render services or document uploads will 502.

### Custom domain (later)
- **Vercel:** Settings → Domains → add `awb.beroe-inc.com` → follow DNS instructions.
- **Render:** API service → Settings → Custom Domains → add `api.awb.beroe-inc.com`.
- **Supabase:** add the new domain to redirect URLs.
- **Render `CORS_ORIGINS`:** add the new frontend domain.

---

## Roll-back plan

If a deploy goes bad:

- **Render:** dashboard → service → Deploys → find the last green deploy → **Rollback**.
- **Vercel:** dashboard → project → Deployments → find the last green → **Promote to Production**.
- **DB:** migrations are forward-only. To undo a schema change, write a new migration (`0017_revert_X.sql`) and apply via Supabase Management API or dashboard SQL.

---

## Costs (rough)

| | Plan | Cost |
|---|---|---|
| Render web (API) | Free | $0 — 30s cold starts after 15 min idle |
| Render worker | Starter | $7/mo — required for Celery |
| Render Redis | Free | $0 — 25 MB |
| Vercel | Hobby | $0 |
| Supabase | Free | $0 — under 500 MB DB and 1 GB storage |
| Anthropic | pay-as-you-go | ~$0.03 per VPD/MOM via Sonnet 4.5 |

**Sprint 1 production: ~$7/mo + Anthropic usage.**
