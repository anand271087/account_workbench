# Beroe AWB — Deployment Runbook

> Self-contained Docker deploy of the Beroe Account Workbench. Targets a
> single VM or any container orchestrator (Docker Swarm, Kubernetes,
> ECS, AKS, GKE). Five services: **web · api · worker · redis** in
> containers, **Postgres on Supabase** (managed) externally.

---

## 1. Architecture at a glance

```
                      ┌─────────────────────────────────────┐
                      │     End users (browser)             │
                      └────────────┬────────────────────────┘
                                   │  https
                                   ▼
                   ┌───────────────────────────────┐
                   │  web (nginx + Vite SPA)       │  ← apps/web/Dockerfile
                   │  static bundle + SPA fallback │
                   └────────────┬──────────────────┘
                                │ VITE_API_BASE_URL
                                ▼  https
                   ┌───────────────────────────────┐
                   │  api (FastAPI + uvicorn)      │  ← apps/api/Dockerfile
                   │  business logic, RBAC, JWT    │
                   └─┬───────────────────────────┬─┘
                     │                           │
            ┌────────▼─────────┐         ┌──────▼─────────┐
            │  redis (broker)  │◄────────┤  worker        │  ← same image as api,
            │                  │         │  (Celery)      │     different CMD
            └──────────────────┘         └────────────────┘
                                                 │
                                                 ▼
                                         ┌──────────────────────┐
                                         │  Supabase            │
                                         │  - Postgres (data)   │
                                         │  - Auth (JWT)        │
                                         │  - Storage (docs)    │
                                         └──────────────────────┘
                                                 │
                                                 ▼
                                         ┌──────────────────────┐
                                         │  Beroe Bifrost       │
                                         │  AI gateway →        │
                                         │  Bedrock / Claude    │
                                         └──────────────────────┘
```

**Single-host deploy:** point every service at `redis` by container name;
api/worker talk to Supabase + Bifrost over the public network.

**Multi-host / k8s:** push the two images to your registry, treat the
compose file as a deployment manifest reference. Redis can move to a
managed cache (ElastiCache / Memorystore) — set REDIS_URL accordingly.

---

## 2. Prerequisites

- **Docker Engine ≥ 24** + **Docker Compose v2** on the deploy host.
- **Supabase project** for Beroe — Postgres + Auth + Storage.
  - Note the project URL, anon key, service-role key, JWT secret,
    DATABASE_URL (use the transaction-mode pooler on port 6543).
- **AI access** — one of:
  - Beroe's Bifrost gateway (preferred): URL + API key.
  - OR Anthropic API key directly.
- **DNS** — two records typically: `awb.beroe.internal` → web, and
  `awb-api.beroe.internal` → api. Single-host is fine too; just front
  both via the same nginx with path-based routing if desired.

---

## 3. One-time setup

> **Short path — reusing the existing Supabase project that the dev
> instance already runs against**
>
> If the deploy points at the same Supabase project Anand has been using
> during development, then **everything in 3c → 3f is already done**:
> 63 migrations applied, the 3 storage buckets exist, seed users are in
> `public.users`, demo accounts (Mondelez / Siemens / Test1 / Sanofi /
> Novo Nordisk) are seeded.
>
> In that case the deploy collapses to: **clone → fill .env.prod →
> build → run**. Steps 3c, 3d, 3e, 3f below can be skipped. Lift the
> Supabase secrets straight out of the existing `apps/api/.env` and
> `apps/web/.env` files on the dev machine.
>
> If you DO want a separate prod-isolated Supabase project (recommended
> long-term so prod data isn't mixed with dev experimentation), follow
> 3c → 3f against the new project before launch.

### 3a. Clone the repo

```bash
git clone <beroe-repo-url> beroe-awb
cd beroe-awb
```

### 3b. Create the env file

```bash
cp .env.prod.example .env.prod
$EDITOR .env.prod
```

Required values (all SECRETS; never commit `.env.prod`):

| Variable | Source |
|---|---|
| `VITE_API_BASE_URL` | The public URL the browser uses to reach the API |
| `VITE_SUPABASE_URL` | Supabase Project Settings → API |
| `VITE_SUPABASE_ANON_KEY` | Supabase Project Settings → API → anon (public) |
| `DATABASE_URL` | Supabase Project Settings → Database → Connection pooler (transaction mode, port 6543) — prefix with `postgresql+asyncpg://` |
| `SUPABASE_URL` | same as `VITE_SUPABASE_URL` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Project Settings → API → service_role (secret) |
| `SUPABASE_JWT_SECRET` | Supabase Project Settings → API → JWT secret |
| `AI_GATEWAY_URL` + `AI_GATEWAY_API_KEY` + `AI_GATEWAY_MODEL` | Bifrost team (Karthick / Beroe DevOps) — model defaults to `bedrock/eu.anthropic.claude-sonnet-4-7-20251101-v1:0` |
| `ANTHROPIC_API_KEY` | Only if Bifrost isn't reachable from the deploy host |

### 3c. Apply database migrations to Supabase

The repo's `supabase/migrations/` directory holds **63 idempotent SQL
files** that build the full schema. Apply them in order against
the Beroe Supabase project (one-time on first deploy + whenever new
migrations land):

**Option A — Supabase CLI (recommended):**

```bash
supabase link --project-ref <beroe-project-ref>
supabase db push       # applies any migration not yet present in the DB
```

**Option B — Manual via psql:**

```bash
export DATABASE_URL="postgresql://postgres.<project>:<pwd>@aws-...pooler.supabase.com:6543/postgres"
for f in supabase/migrations/*.sql; do
  echo "Applying $f..."
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
done
```

Each migration is wrapped in `do $$ begin ... exception when duplicate_object then null; end $$;` so re-running on a partially-migrated DB is safe.

### 3d. Seed the demo data (optional — only for non-prod)

```bash
psql "$DATABASE_URL" -f supabase/migrations/0004_seed_demo_accounts.sql
psql "$DATABASE_URL" -f supabase/migrations/0008_seed_engagement_demo.sql
psql "$DATABASE_URL" -f supabase/migrations/0009_seed_contacts_demo.sql
```

Skip this on a production tenancy.

### 3e. Create the 3 storage buckets

The API expects three private Supabase Storage buckets:
`meeting_records`, `vpd`, `contracts`. Migration `0010_storage_buckets.sql`
provisions them with the correct mime restrictions + RLS — confirm in the
Supabase dashboard after running migrations.

### 3f. Seed initial users

```bash
# from the repo root (uses scripts/seed_users.mjs):
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed_users.mjs
```

This invites the 7 seed users (1 admin / 1 VP Sales / 1 CS Director /
2 CSMs / 1 Solutioning / 1 CS Team Manager). They land in `public.users`
with `status='pending'`; their first Supabase login flips them to
`status='active'`. Edit the script for the actual Beroe staff list, or
add them via the Admin → Users page once the first admin is in.

---

## 4. Build the images

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod build
```

Two images are produced:

- `beroe-awb-api:latest`  (~250 MB — Python 3.11 + FastAPI + Celery + libmagic)
- `beroe-awb-web:latest`  (~25 MB — nginx + the compiled Vite bundle)

The `web` build bakes `VITE_API_BASE_URL`, `VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY` into the JS bundle from the env file — they
**cannot be changed at runtime** without rebuilding the web image.

### Push to a registry (for multi-host / k8s)

```bash
# Tag for your registry
docker tag beroe-awb-api:latest registry.beroe.internal/awb/api:v1.0.0
docker tag beroe-awb-web:latest registry.beroe.internal/awb/web:v1.0.0
docker push registry.beroe.internal/awb/api:v1.0.0
docker push registry.beroe.internal/awb/web:v1.0.0
```

---

## 5. Run the stack

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

Verify all four containers are healthy:

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f api worker web
```

Health checks:

```bash
curl -fsS http://localhost/healthz       # web → 200 ok
curl -fsS http://localhost:8000/health   # api → 200
```

---

## 6. Day-2 operations

### Upgrade to a new release

```bash
git pull origin main
docker compose -f docker-compose.prod.yml --env-file .env.prod build
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
# Apply any new migrations:
supabase db push   # or psql loop from step 3c
```

Zero-downtime: api + worker recreate one at a time when `up -d` runs.
For true zero-downtime on web, front it with a separate load-balancer
and roll the container.

### View logs

```bash
docker compose -f docker-compose.prod.yml logs -f api          # FastAPI
docker compose -f docker-compose.prod.yml logs -f worker       # Celery
docker compose -f docker-compose.prod.yml logs -f web          # nginx
docker compose -f docker-compose.prod.yml logs -f redis
```

### Database migration

```bash
# When a new migration ships in supabase/migrations/
git pull origin main
supabase db push
# Restart api + worker so the SQLAlchemy model + scope cache reload:
docker compose -f docker-compose.prod.yml --env-file .env.prod restart api worker
```

### Scale workers

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --scale worker=3
```

Each worker handles ~2 concurrent AI extraction jobs (Celery
`concurrency=2`). Scale based on upload volume.

### Backup

Postgres lives on Supabase — use their PITR / daily snapshots. No
local volume to back up except `redis_data` (which is just a cache;
losing it costs in-flight Celery jobs but no permanent data).

### Rollback

```bash
git checkout <previous-tag>
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
# Reverting migrations is manual — write a down-migration SQL.
```

---

## 7. Beroe-specific things to verify before go-live

| Check | How to verify | Why |
|---|---|---|
| Bifrost reachable from the deploy host | `curl -H "x-bf-ak: $AI_GATEWAY_API_KEY" $AI_GATEWAY_URL/health` | If unreachable, AI features fall back to deterministic stubs (no Claude calls). Switch to ANTHROPIC_API_KEY direct as a workaround. |
| Supabase pooler reachable | API `/health` returns 200 + check `docker logs api` for asyncpg errors | DATABASE_URL on port 6543 (txn pooler) needs `statement_cache_size=0` which the app already sets; port 5432 (session) caps at 15 clients on Free tier. |
| RLS policies active | Query `select count(*) from pg_policies` in Supabase SQL — should be ≥ 60 across all tables | Defense-in-depth — even a leaked anon key can't bypass row-level access. |
| Storage buckets are PRIVATE | Supabase dashboard → Storage — bucket visibility "Private" | The API mints 5-minute signed URLs; public buckets would expose docs. |
| HTTPS for the SPA + API | TLS terminator (nginx / cloudfront / ALB) in front | Supabase auth tokens travel in `Authorization: Bearer ...`; never serve over plain http in prod. |
| Email allow-list | `_validate_beroe_email` in `apps/api/app/schemas/engagement.py` forces `@beroe-inc.com` for internal leads | If Beroe's domain differs (e.g. `@beroe.com`), update the constant or remove the check. |

---

## 8. Common issues

**`docker compose build` runs out of memory on the web image**
→ Vite's TypeScript pass is the heavy step. Bump the host RAM to ≥ 4 GB
during build, or build the web image on a separate CI runner and pull
the pre-built image at deploy time.

**API logs show `EMAXCONNSESSION`**
→ You're on the session-mode pooler (port 5432) with the 15-client cap.
Switch DATABASE_URL to the transaction-mode pooler (port 6543).

**Frontend loads but every API call 401s**
→ `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` mismatch with the API's
`SUPABASE_URL` / `SUPABASE_JWT_SECRET`. Both apps must point at the
**same** Supabase project. Rebuild the web image after fixing.

**Celery worker boots then stops**
→ Check `REDIS_URL` — when running in compose, must be
`redis://redis:6379/0` (the container name), NOT `localhost`.

**Document uploads 413 / 415**
→ 413 means MAX_UPLOAD_SIZE_MB is too low (default 100 MB).
415 means the file's mime type isn't in the bucket allowlist —
see migration `0055_contracts_bucket_mimes.sql` for the contracts bucket
+ `0010_storage_buckets.sql` for the other two.

---

## 9. Files of interest

| File | What it does |
|---|---|
| `apps/api/Dockerfile` | API + worker image (single image, two CMDs) |
| `apps/web/Dockerfile` | Frontend multi-stage build → nginx |
| `apps/web/nginx.conf` | SPA fallback, asset caching, gzip, /healthz |
| `docker-compose.prod.yml` | Production-shape compose (web / api / worker / redis) |
| `.env.prod.example` | Env template — copy + fill secrets |
| `supabase/migrations/*.sql` | 63 idempotent migrations — apply in order |
| `scripts/seed_users.mjs` | Bootstrap initial Supabase users via service-role key |
| `render.yaml` | Reference deployment for Render's managed platform (alternative to self-host) |

---

## 10. Contact

Code questions: Anand Kaliappan (anand.ak@beroe-inc.com)
DevOps go-live coordination: Beroe IT / DevOps team
