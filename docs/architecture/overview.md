# Architecture Overview

## High-level diagram

```
┌──────────────┐         ┌──────────────────┐         ┌────────────────┐
│   Browser    │ ──HTTPS─▶│  Vercel (web)   │ ──API──▶│ Render (api)   │
│ (React app)  │ ◀───────│  apps/web       │ ◀──JSON──│ FastAPI         │
└──────────────┘         └──────────────────┘         └────────┬───────┘
       │                                                       │
       │  Supabase JS                                          │
       │  (auth, storage signed URLs)                          │
       ▼                                                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          Supabase                                    │
│  Postgres (RLS) · Auth · Storage · Realtime                          │
└─────────────────────────────────────────────────────────────────────┘
                                                                ▲
                                                                │
                                              ┌─────────────────┴─────────────┐
                                              │  Render (worker)              │
                                              │  Celery — AI summarization    │
                                              └──────────────┬────────────────┘
                                                             │
                                                             ▼
                                                ┌──────────────────────┐
                                                │ Anthropic Claude API │
                                                └──────────────────────┘
```

## Data flow examples

**A user logs in:**
1. Browser → Supabase Auth (`signInWithPassword`)
2. Supabase returns JWT
3. Browser stores JWT (Supabase JS handles refresh)
4. Browser → FastAPI with `Authorization: Bearer <jwt>`
5. FastAPI verifies JWT signature using `SUPABASE_JWT_SECRET` (no DB hop)
6. FastAPI extracts user_id, role; applies RBAC

**A user uploads a MOM:**
1. Browser → FastAPI `POST /api/v1/accounts/:id/documents` (multipart)
2. FastAPI validates MIME type, size, computes hash (rejects duplicates)
3. FastAPI uploads to Supabase Storage `/accounts/:id/meeting_records/`
4. FastAPI inserts `documents` row with `ai_status=pending`
5. FastAPI dispatches Celery task; returns `202 + {job_id}`
6. Worker pulls task → text extract → Claude summary → Claude entity extraction → aggregate regen
7. Worker updates `documents.ai_status=complete` and `account_discovery_summary`
8. Browser polls `GET /api/v1/jobs/:id` → sees status flip → re-fetches summary

## Boundaries

- **Frontend never calls Supabase directly for business data** — only auth + signed Storage URLs.
- **Anthropic API key never touches the browser** — all Claude calls server-side.
- **Service role key (RLS bypass) never touches the browser** — server-only.
- **Row Level Security is the second wall** — even if FastAPI authorization had a bug, the DB rejects forbidden queries.

## Why this shape

- **Vercel + Render split:** Frontend benefits from Vercel's CDN/edge; backend benefits from a long-running Python process with Celery workers.
- **Supabase as DB+Auth+Storage:** Single managed service for all three concerns; RLS gives us a defense-in-depth layer the BRD's RBAC requirement leans on.
- **Celery for AI:** Document processing can take 30–120s; sync HTTP would time out. Frontend polls.
- **JWT signature verification (no DB hop):** Auth check is on the hot path of every request — verifying signature locally keeps p99 latency low.

## See also
- `data-model.md` — table-by-table schema and RLS policies
- `auth-and-rbac.md` — role matrix, JWT flow, SSO swap path
