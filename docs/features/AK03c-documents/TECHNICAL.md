# AK03.c — Documents — Technical

## Files touched

| File | Purpose |
|---|---|
| `apps/api/app/models/document.py` | `Document`, `Job`, `AccountDiscoverySummary` ORMs |
| `apps/api/app/models/__init__.py` | Re-exports the three models |
| `apps/api/app/schemas/document.py` | `DocumentOut`, `DocumentListResponse`, `DocumentUploadResponse`, `JobOut`, `DiscoverySummaryOut` |
| `apps/api/app/services/files.py` | Supabase Storage helpers (upload, download, signed URL, hash, sanitised path) |
| `apps/api/app/services/extract.py` | Text extraction for `.docx` / `.pdf` / `.txt` / `.vtt` with audio/video stub |
| `apps/api/app/services/claude.py` | `summarise_document(text, kind)` + `aggregate_account_summary(summaries)` — both with stub fallback + retry + 24h cache |
| `apps/api/app/workers/celery_app.py` | Celery app factory (broker + result backend = Redis) |
| `apps/api/app/workers/tasks.py` | `process_document` task — extract → summarise → regen aggregate |
| `apps/api/app/routes/documents.py` | 7 endpoints across 3 routers (account-scoped + id-scoped + jobs) |
| `apps/api/app/main.py` | Wires the three new routers |
| `supabase/migrations/0010_storage_buckets.sql` | Creates `meeting_records`, `vpd`, `contracts` buckets + RLS policies (service role + admin only) |
| `apps/api/tests/test_documents.py` | 17 pytest cases (extract + RBAC + dedup + soft delete + rerun + jobs) |
| `apps/web/src/types/document.ts` | TS mirror of Pydantic schemas + label maps |
| `apps/web/src/routes/accounts/tabs/DocumentsTab.tsx` | Upload + list + rerun + soft delete + 2s job polling + summary expand + entity chips |
| `apps/web/src/App.tsx` | `/accounts/:id/documents` → `DocumentsTab` (replaces placeholder) |
| `apps/web/src/routes/accounts/tabs/PlaceholderTab.tsx` | Removed `DocumentsPlaceholder` (replaced by real tab) |

## Data model

### `documents` table (created in 0001)
```sql
documents (
  id                 uuid PK,
  account_id         uuid NOT NULL FK accounts(id) ON DELETE CASCADE,
  kind               doc_kind NOT NULL,                          -- mom|vpd|recording|transcript|email|other
  filename           text NOT NULL,
  file_hash          text NOT NULL,
  storage_path       text NOT NULL,                              -- "<bucket>/<account_id>/<doc_id>__<sanitised>"
  mime_type          text,
  size_bytes         bigint,
  meeting_date       date,
  uploaded_by        uuid FK users(id) ON DELETE SET NULL,
  uploaded_at        timestamptz NOT NULL default now(),
  ai_status          ai_status NOT NULL default 'pending',       -- pending|processing|complete|failed
  ai_summary_text    text,
  extracted_entities jsonb,                                       -- {people, decisions, action_items, dates, is_stub}
  job_id             uuid FK jobs(id) ON DELETE SET NULL,
  deleted_at         timestamptz,
  unique (account_id, file_hash)                                  -- per-account dedup
)
```

### `jobs` table
```sql
jobs (
  id, kind, account_id, document_id, status, progress, error,
  payload jsonb, result jsonb,
  started_at, finished_at, created_at
)
```

### `account_discovery_summary` (1:1 with `accounts`)
```sql
account_discovery_summary (
  account_id           uuid PK FK accounts(id) ON DELETE CASCADE,
  summary_text         text,
  source_document_ids  uuid[] NOT NULL default '{}',
  generated_at         timestamptz,
  generated_by_job_id  uuid
)
```

### Storage buckets (0010)
| Bucket | What goes in | Visibility |
|---|---|---|
| `meeting_records` | MOMs, transcripts, emails, recordings, other | private |
| `vpd` | Value Prop Decks | private |
| `contracts` | Future: contracts | private |

Object naming: `<account_id>/<doc_id>__<sanitised_filename>`. RLS on `storage.objects` allows the **service role** (FastAPI server) and admins only — regular users never get direct bucket access; they receive 5-minute signed URLs.

## API contracts

### `GET /api/v1/accounts/:id/documents?include_deleted&kind`
- Auth required. Scope: caller can `view_account`.
- Returns `{ items: DocumentOut[], total, is_editable }` where `is_editable` is MOM-level (the most permissive flavour) — the UI re-checks per-row when needed.

### `POST /api/v1/accounts/:id/documents` (multipart)
- Form fields: `file` (binary), `kind` (`mom|vpd|...`), optional `meeting_date` (ISO YYYY-MM-DD).
- Validates extension, rejects audio/video with v1.1 message, enforces 100 MB cap.
- Hashes bytes; if hash already exists for the account, returns 202 with `duplicate=true` and the original row.
- Uploads to Supabase Storage (service role) → inserts `Document` row → inserts `Job` row → enqueues `process_document.delay(job_id)`.
- Returns 202 + `{ document, job_id, duplicate }`.

### `GET /api/v1/documents/:id`
Returns the full document row. Auth + scope required.

### `GET /api/v1/documents/:id/download-url`
Returns `{ url }` — a 5-minute signed download URL.

### `POST /api/v1/documents/:id/rerun-ai`
RBAC re-checked per kind. Resets `ai_status='pending'`, clears summary + entities, mints a new Job, enqueues `process_document.delay(...)`. Returns the Job.

### `DELETE /api/v1/documents/:id`
Soft-delete (sets `deleted_at`). 204.

### `GET /api/v1/accounts/:id/discovery-summary`
Returns the account-level rollup or a blank object if none exists.

### `GET /api/v1/jobs/:id`
Returns the Job. Account-scoped — caller must be able to view the parent account.

## Background pipeline

`apps/api/app/workers/tasks.py::process_document(job_id)` (Celery task, `bind=True`, `max_retries=2`):

```
1. Load Job + Document
2. Mark job 'running', doc.ai_status='processing'
3. Download bytes from Supabase Storage
4. extract_text(filename, mime_type, bytes)         # docx → python-docx, pdf → pypdf, vtt → strip cues, txt → utf-8
5. summarise_document(text, kind)                   # Claude or stub
6. Persist doc.ai_summary_text + extracted_entities
7. _regenerate_aggregate(account_id)                # query all complete docs → aggregate_account_summary → upsert
8. Mark job 'complete', progress=100
```

Errors are caught at the outermost boundary and recorded as `job.status='failed'` + `doc.ai_status='failed'`. The task **does not raise** — Celery retries would otherwise rack up bills against the Anthropic API.

The task is sync (Celery's natural mode) and uses `asyncio.run()` to drive the existing async SQLAlchemy + Supabase Python clients.

## AI surface

`app.services.claude.summarise_document(text, kind)` returns:
```python
{
  "summary": str,        # ≤200 words
  "people": [str],
  "decisions": [str],
  "action_items": [str],
  "dates": [str],
  "is_stub": bool,
}
```
- 24h TTL cache keyed on `sha256(model + kind + text)` so reruns are free.
- One retry on transient Anthropic errors (`OverloadedError`, `RateLimitError`, etc.) with 800 ms backoff.
- On persistent failure, falls back to the stub summary with a clear `AI service unavailable (...)` prefix.

`app.services.claude.aggregate_account_summary(per_doc_summaries)` returns a plain-text ≤300-word rollup. Same cache + retry + fallback policy.

## Frontend

### Component tree
```
DocumentsTab
  ├─ DiscoverySummary card (top — generated_at + summary_text)
  ├─ Upload card (kind picker + file input)  [hidden when not editable]
  └─ Documents list
       └─ DocumentRow
            ├─ filename + KindPill + StatusPill (+ stub-AI tag)
            ├─ "Show summary" toggle
            └─ EntityChips on expand
```

### Job polling
- After every upload (non-duplicate) and every rerun, the new `job_id` is added to `activeJobIds`.
- A `setInterval` (2s) polls `/api/v1/jobs/:id` for each active job. When a job hits `complete` or `failed`, it's dropped from the active list and the `documents` + `discovery-summary` queries are invalidated. Polling stops when the active list is empty.
- This is intentionally simple — production-grade WebSockets / SSE land later.

### TanStack Query keys
- `["documents", accountId]` — list query.
- `["discovery-summary", accountId]` — aggregate.
- `["activity", accountId]` — invalidated after every mutation so the Overview feed refreshes.

## Tests

`apps/api/tests/test_documents.py` — 17 cases, all green:

**Unit (no DB / no network):**
- `test_extract_txt_returns_text`
- `test_extract_vtt_strips_timestamps`
- `test_extract_audio_raises_v1_1_message`
- `test_summarise_document_stub_shape`

**Routes (live DB, monkeypatched storage + Celery):**
- `test_documents_unauth_401`
- `test_list_documents_admin_empty_initially`
- `test_list_documents_csm_other_account_readonly`
- `test_upload_document_admin_mom`
- `test_upload_document_dedup_returns_existing`
- `test_upload_document_unsupported_extension_415`
- `test_upload_document_audio_415_with_v11_message`
- `test_upload_vpd_csm_forbidden` — matrix: CSM = V on VPD
- `test_upload_vpd_solutioning_allowed` — matrix Q3: solutioning F (all)
- `test_soft_delete_document`
- `test_rerun_ai_admin`
- `test_jobs_unauth_401`
- `test_discovery_summary_empty_returns_blank`

`pytest` autouse fixture replaces `files.upload_object`, `files.download_bytes`, `files.signed_url`, and `process_document.delay` so tests don't hit Supabase Storage or Redis.

Full backend suite: **87/87 green** after M7 (was 70 before).

## Configuration

| Env var | Purpose | Default |
|---|---|---|
| `REDIS_URL` | Redis (cache) | `redis://localhost:6379/0` |
| `CELERY_BROKER_URL` | Celery broker | `redis://localhost:6379/1` |
| `CELERY_RESULT_BACKEND` | Celery results | `redis://localhost:6379/2` |
| `MAX_UPLOAD_SIZE_MB` | Upload size cap | 100 |
| `ALLOWED_DOC_EXTENSIONS` | Comma-separated allow-list | `.docx,.pdf,.txt,.vtt` |
| `SUPABASE_SERVICE_ROLE_KEY` | Used by storage helper to upload + sign URLs | required |

## Running the worker locally

```bash
cd apps/api
.venv/bin/celery -A app.workers.celery_app.celery_app worker --loglevel=INFO
```

Or via docker-compose: `pnpm docker:up` brings Redis + worker up alongside the API.

## Security notes

- **Auth required:** every endpoint.
- **RBAC:** matrix-aligned, kind-aware (`can_write_documents(role, ..., kind=)`). Frontend gates UI; FastAPI re-checks; RLS is the third wall.
- **Storage buckets:** private. RLS allows only `service_role` + admin direct access. Users get 5-minute signed URLs from the API.
- **File hash dedup:** prevents accidental duplicate billing on AI summarisation.
- **Path sanitisation:** filenames stripped of path separators and non-`A-Za-z0-9._-` chars before becoming a Storage key.
- **Audit:** every insert/update/delete on `documents` recorded by the SQLAlchemy listener.
- **Celery task error handling:** `try/except` at the outer boundary writes failure to `jobs.error` and never re-raises, preventing retry loops that would burn the Anthropic budget.
- **AI cost cap:** 24h TTL cache + Anthropic retries capped at 1 + stub fallback prevents runaway bills.

## Known limitations & TODOs

- Soft-deleted Storage objects are not yet hard-removed — needs an admin sprint job (30-day window).
- No m:n linking from documents to client contacts yet (`document_links` table exists, unused).
- Aggregate regeneration runs on every doc completion. For accounts with many docs, this may need to be debounced.
- Audio/video transcription deferred to v1.1.
- No streaming progress for the worker — UI shows discrete `pending` / `processing` / `complete` only.
