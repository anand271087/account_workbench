# Deploying the Account Workbench inside Beroe's AWS

This is the handoff doc for Beroe DevOps. Account Workbench is currently
running on Render + Vercel against `ued_reader` on the Beroe Redshift
cluster. To move it into Beroe's AWS, three things change:

1. The **SSM tunnel goes away** — the container will sit in a VPC that
   reaches Redshift directly.
2. The **runtime swaps** Render → ECS Fargate (or App Runner / EKS).
3. The **frontend moves** Vercel → S3 + CloudFront (or your existing
   web hosting).

Everything else (code, schema, env vars, secrets pattern) is the same.

---

## Architecture (target state)

```
┌────────────────────────────────────────────────────────────────────────┐
│  Beroe AWS Account                                                     │
│                                                                        │
│   ┌─────────────────┐       ┌────────────────────┐                     │
│   │ CloudFront +    │ HTTPS │ ECS Fargate / ALB  │ direct TCP 5439    │
│   │ S3 (frontend)   │──────▶│ FastAPI + workers  │──────▶ Redshift     │
│   └─────────────────┘       └────────────────────┘       cluster      │
│         │                          │                                   │
│         │                          ├──▶ ElastiCache (Redis)            │
│         │                          ├──▶ Supabase (Auth + Postgres)     │
│         │                          └──▶ Bifrost AI gateway (Bedrock)   │
└────────────────────────────────────────────────────────────────────────┘
```

The FastAPI container runs in a subnet that has a route to the Redshift
cluster's security group. No SSM tunnel needed.

---

## What you'll deploy

| Component | Source | Target |
|---|---|---|
| FastAPI web service | `apps/api/Dockerfile` | **ECS Fargate** task behind an ALB (preferred) or App Runner |
| Celery worker | same Dockerfile, different CMD | ECS Fargate task with no public ingress |
| Redis | n/a | **ElastiCache (Redis)** — broker + cache. Small `cache.t4g.micro` is enough |
| Database | n/a | Stay on **Supabase** (already set up). Optional later: migrate Postgres to RDS. |
| Frontend SPA | `apps/web/dist/` (built via `pnpm build`) | **S3** static hosting + **CloudFront** with the SPA fallback rewrite |

---

## Step 1 — VPC & network

Place the Fargate service in the **same VPC as the Redshift cluster** OR
in a peered VPC with a route to it. The simpler path is "same VPC,
private subnet."

**Security group rules:**

| From | To | Port | Why |
|---|---|---|---|
| ALB SG | API task SG | 8000 / 10000 | ALB → FastAPI |
| API task SG | Redshift SG | 5439 | direct Redshift queries |
| API task SG | ElastiCache SG | 6379 | Celery broker + cache |
| API task SG | 0.0.0.0/0 | 443 | Supabase + Bifrost calls (via NAT GW if private subnet) |
| Worker task SG | same as above (Redshift line optional — worker doesn't query it) |

**Redshift database user:** keep the `ued_reader` Beroe DBA already
provisioned. Open the [DBA grants ask](DBA-ACCESS-REQUEST.md) — same 5
tables we requested for the Render deploy.

---

## Step 2 — Build the Docker image

The Dockerfile in `apps/api/Dockerfile` already works. **For Beroe's
AWS deploy, you can drop the AWS CLI + SSM plugin layers** — they add
~80 MB and aren't used when the container reaches Redshift directly.

Two options:

### Option A — keep the layers (zero code change)
The image works as-is. Just set `REDSHIFT_AUTOSTART_TUNNEL=false` in
env vars and the tunnel never tries to start. Cost: +80 MB image.

### Option B — strip the SSM layers for a lighter image
Edit `apps/api/Dockerfile` and delete these two `RUN` blocks:
- The `# AWS CLI v2 (multi-arch detect)` block (~15 lines)
- The `# session-manager-plugin` block (~10 lines)

Save ~80 MB on every container pull.

**Build + push to ECR:**

```bash
aws ecr create-repository --repository-name beroe-awb-api --region <region>
aws ecr get-login-password --region <region> \
  | docker login --username AWS --password-stdin <acct>.dkr.ecr.<region>.amazonaws.com

docker build -t beroe-awb-api -f apps/api/Dockerfile apps/api
docker tag beroe-awb-api:latest <acct>.dkr.ecr.<region>.amazonaws.com/beroe-awb-api:latest
docker push <acct>.dkr.ecr.<region>.amazonaws.com/beroe-awb-api:latest
```

CI alternative: wire CodeBuild or GitHub Actions to do this on every
push to `main`.

---

## Step 3 — ECS Fargate task definitions

Two tasks share the same image, differ only in CMD.

### Web task (`beroe-awb-api`)

| Setting | Value |
|---|---|
| CPU / memory | 0.5 vCPU / 1 GB (scale up if traffic grows) |
| Container image | the ECR URI |
| Container port | `8000` (Dockerfile CMD honors `$PORT`, set the env var if you want a different one) |
| Command override | (none — uses Dockerfile CMD) |
| Health check | `CMD-SHELL curl -fsS http://localhost:8000/health \|\| exit 1` |
| Network mode | `awsvpc`, private subnet, security group above |
| Desired count | 2 (for HA across AZs) |
| Behind ALB | Target group on port 8000, healthcheck path `/health`, listener on 443 with ACM cert |

### Worker task (`beroe-awb-worker`)

| Setting | Value |
|---|---|
| CPU / memory | 0.5 vCPU / 1 GB |
| Container image | same ECR URI |
| Command override | `sh -c ".venv/bin/celery -A app.workers.celery_app.celery_app worker --loglevel=INFO --concurrency=2"` |
| Network mode | `awsvpc`, private subnet, no ALB |
| Desired count | 1 (scale to 2-3 if doc upload volume grows) |

---

## Step 4 — Environment variables

Set these on **both** task definitions (web + worker, unless noted as
"web only").

### Always
| Key | Value |
|---|---|
| `ENV` | `production` |
| `PYTHON_VERSION` | `3.11.10` |
| `DATABASE_URL` | Supabase pooler URL (or RDS later) |
| `SUPABASE_URL` | from Supabase project settings |
| `SUPABASE_SERVICE_ROLE_KEY` | from Supabase project settings (use Secrets Manager) |
| `SUPABASE_JWT_SECRET` | from Supabase project settings (Secrets Manager) |
| `REDIS_URL` | ElastiCache primary endpoint (`redis://elasticache.../0`) |
| `CELERY_BROKER_URL` | same as REDIS_URL |
| `CELERY_RESULT_BACKEND` | same as REDIS_URL |
| `AI_GATEWAY_URL` | Bifrost gateway URL (in-VPC) |
| `AI_GATEWAY_API_KEY` | x-bf-ak header (Secrets Manager) |
| `AI_GATEWAY_MODEL` | `bedrock/eu.anthropic.claude-sonnet-4-7-20251101-v1:0` |
| `CORS_ORIGINS` | comma-separated list of frontend domains (e.g. `https://workbench.beroe.com`) |

### Redshift (web only — worker doesn't query Redshift)
| Key | Value |
|---|---|
| `REDSHIFT_AUTOSTART_TUNNEL` | **`false`** (tunnel not needed in-VPC) |
| `REDSHIFT_HOST` | the actual Redshift endpoint, e.g. `redshift-cluster-analytics.c9j4dqrlq4xq.eu-west-1.redshift.amazonaws.com` |
| `REDSHIFT_PORT` | `5439` |
| `REDSHIFT_DB` | `dev` |
| `REDSHIFT_USER` | `ued_reader` |
| `REDSHIFT_PASSWORD` | Secrets Manager reference |
| `REDSHIFT_SSLMODE` | `require` |

### Skip these entirely
`AWS_ACCESS_KEY_ID` · `AWS_SECRET_ACCESS_KEY` · `REDSHIFT_SSM_*`
— not used when `REDSHIFT_AUTOSTART_TUNNEL=false`. The task role's
IAM identity is used for any AWS calls (S3, etc) instead.

### Secrets management
Put `SUPABASE_*`, `REDSHIFT_PASSWORD`, `AI_GATEWAY_API_KEY` in **AWS
Secrets Manager** and reference them in the task definition's
`secrets:` array. Never put them in plain env vars.

---

## Step 5 — Database

Two migration sets need to run against the production Supabase (or
RDS if migrated):

### One-time setup
```bash
cd supabase/migrations
# Run in order. They're idempotent.
psql "$DATABASE_URL" -f 0001_init_schema.sql
psql "$DATABASE_URL" -f 0002_rls_policies.sql
# … through 0066_intel_offline_staging.sql
```

All 66 migrations should already be applied (they were run during the
Render deploy). On a fresh Beroe Supabase, run them all in numeric
order. None of them are destructive on re-run.

### Per-account configuration
Each account needs `redshift_company_name` set so the Intel endpoints
can scope by the canonical Redshift companyname:

```sql
update accounts set redshift_company_name = 'Mondelez International' where slug = 'mondelez';
update accounts set redshift_company_name = 'Siemens Energy AG' where slug = 'siemens-energy';
-- repeat per account
```

The CSM creating the account can also enter this via the admin UI
(if you expose the field) or via a one-time DBA query.

---

## Step 6 — Frontend (S3 + CloudFront)

```bash
cd apps/web

# Build with the prod API URL
VITE_API_BASE_URL=https://api.workbench.beroe.com pnpm build

# Sync to S3
aws s3 sync dist/ s3://workbench-beroe-com --delete

# Invalidate CloudFront
aws cloudfront create-invalidation \
  --distribution-id ENGGYNDSXXXXX --paths '/*'
```

**CloudFront SPA fallback** — add a behavior that rewrites 404 → `index.html`
so `/accounts/<id>/intel-reports/analytics` deep links work. The
existing `apps/web/vercel.json` rewrite rule is the same idea; CloudFront
calls it a Lambda@Edge function or a CloudFront Function:

```js
function handler(event) {
  var req = event.request;
  var hasExt = req.uri.indexOf('.') !== -1;
  if (!hasExt && req.uri !== '/') req.uri = '/index.html';
  return req;
}
```

ACM cert for `workbench.beroe.com` → CloudFront distribution.

---

## Step 7 — DNS

| Hostname | Points to |
|---|---|
| `workbench.beroe.com` (or whatever) | CloudFront distribution |
| `api.workbench.beroe.com` | ALB in front of the ECS web task |

`CORS_ORIGINS` on the API includes the frontend domain.

---

## Step 8 — Offline CSV loaders (Phase 3)

The five loader scripts (`scripts/intel_loaders/load_*.py`) can run
from anywhere with a Postgres connection. Two options:

### Option A — run on demand from a bastion / dev machine
```bash
export DATABASE_URL=...   # Supabase pooler URL
uv run python scripts/intel_loaders/load_nnamu.py /path/to/nnamu.xlsx
```

### Option B — wire into a scheduled job
Drop the CSV into an S3 bucket on a schedule, then trigger a Lambda
(or Step Function) that calls the loader. The loaders accept a local
file path; wrap with an S3 download step.

Tables loaded: `intel_nnamu_savings`, `intel_upply_tracking`,
`intel_cirtuo_projects`, `intel_training_attendance`, `intel_nps_scores`.

---

## Step 9 — Smoke test

After the first deploy:

```bash
# 1. API health
curl https://api.workbench.beroe.com/health

# 2. Authenticated intel call (Mondelez)
TOKEN="$(supabase-cli login token)"
curl -H "Authorization: Bearer $TOKEN" \
  "https://api.workbench.beroe.com/api/v1/accounts/$MONDELEZ_ID/intel/account-subscribers?window=all"

# Expected: 200 OK, total_subscribers: 364, total_logins: 1522
```

Then in the browser, open the frontend → log in → open Mondelez →
Intel & Reports → Analytics. The 16 sub-tabs should populate within
5-25s per tab cold, then instant on revisit.

---

## What's different from Render

| | Render (today) | Beroe AWS |
|---|---|---|
| Tunnel to Redshift | SSM port-forward via bastion EC2 | Direct (same VPC) |
| Container | Render free / Starter | ECS Fargate |
| Frontend | Vercel | S3 + CloudFront |
| Redis | Render managed (free, 25 MB) | ElastiCache |
| Cold start | ~30-40s (free tier sleeps) | ~5s (Fargate task on warm provisioned capacity) |
| Secrets | Render env vars | AWS Secrets Manager |
| Cost | Free / $7-14/mo | Higher but predictable (~$60-100/mo on baseline) |

---

## What stays the same

- All 17 `/api/v1/accounts/:id/intel/*` endpoints
- All 16 sheet bundles + Phase 3 staging tables + loaders
- The Supabase Auth flow (Phase 2 SSO swap to Beroe AD is a separate task)
- The frontend code — just rebuild with the new `VITE_API_BASE_URL`
- The Phase 1 + Phase 3 migrations (idempotent — run them on fresh DB)
- Self-heal + InfraBanner — works the same whether tunneled or direct;
  detects Connection-refused on any Redshift call and retries once

---

## Open questions for Beroe DevOps

Things I couldn't decide from outside Beroe's network:

1. **Which VPC / subnet group hosts Redshift?** — defines where the
   Fargate tasks need to live.
2. **Is Bifrost gateway reachable from the Fargate task SG?** — sets
   the value of `AI_GATEWAY_URL`. If not reachable, fall back to direct
   Anthropic SDK via `ANTHROPIC_API_KEY` (set the secret, leave gateway
   blank).
3. **Do you want to keep Supabase, or migrate to RDS?** — both work.
   Migration is non-trivial (need to port RLS policies + auth schema)
   but doable.
4. **CI/CD preference** — CodeBuild + CodePipeline, GitHub Actions
   with OIDC, or Buildkite? Affects how the image gets to ECR.

When you have answers to these, the deploy is mostly mechanical.
