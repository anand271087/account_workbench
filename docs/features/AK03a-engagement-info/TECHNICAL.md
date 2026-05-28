# AK03.a — Engagement Info — Technical

## Files touched

| File | Purpose |
|---|---|
| `apps/api/app/models/engagement.py` | `AccountEngagement` ORM (mirrors `account_engagement`) |
| `apps/api/app/models/__init__.py` | Export the new model |
| `apps/api/app/schemas/engagement.py` | `EngagementOut`, `EngagementUpdate`, `QualityCheckRequest`, `QualityCheckResponse` |
| `apps/api/app/schemas/lookup.py` | `CategoryOut`, `CategoryProposeRequest`, `GeographyOut` |
| `apps/api/app/services/audit_writer.py` | **SQLAlchemy event listener** — auto-writes `audit_log` rows on insert/update/delete |
| `apps/api/app/services/claude.py` | Anthropic wrapper with stub fallback + LRU cache |
| `apps/api/app/routes/engagement.py` | `GET /api/v1/accounts/:id/engagement` · `PATCH /api/v1/accounts/:id/engagement` · `POST /api/v1/ai/quality-check` |
| `apps/api/app/routes/lookups.py` | `GET/POST /api/v1/lookups/categories` · `POST /api/v1/lookups/categories/:id/approve` (admin) · `GET /api/v1/lookups/geographies` |
| `apps/api/app/routes/accounts.py` | Search now also matches `slug` |
| `apps/api/app/core/deps.py` | Sets `current_user_id_var` so the audit listener can attribute writes |
| `apps/api/app/main.py` | Registers new routers + imports `audit_writer` to install the listener |
| `apps/api/tests/test_engagement.py` | 18 new tests (58 total) |
| `supabase/migrations/0008_seed_engagement_demo.sql` | Engagement rows for the 4 demo accounts |
| `apps/web/src/types/engagement.ts` | TS types for `Engagement`, `EngagementUpdate`, `QualityCheckResponse` |
| `apps/web/src/types/lookup.ts` | TS types for `Category`, `Geography` |
| `apps/web/src/routes/accounts/tabs/PreSalesTab.tsx` | The form (replaces the M4 placeholder) |
| `apps/web/src/App.tsx` | Wires `/accounts/:id/pre-sales` to `<PreSalesTab>` |

## Data model

`account_engagement` already exists from `0001_init_schema.sql`. M5 adds no new tables.

The `User` model now also includes `team_id` (already in DB) — the engagement route uses it via `_team_member_ids()` to decide if a CS Team Manager has scope on a given account.

## API contracts

### `GET /api/v1/accounts/:account_id/engagement`

Returns `EngagementOut` (200) or 404. View access via `can_view_account()`. If no `account_engagement` row exists yet, returns a blank record so the form can render.

### `PATCH /api/v1/accounts/:account_id/engagement`

Body: `EngagementUpdate` — every field optional. Arrays REPLACE (not merge) — multi-select semantics.

Edit access via `can_write_engagement(role, is_assigned, is_team)`. Returns 403 if the role can't edit on this scope.

When `engagement_objective` text changes, `ai_quality_dismissed` is reset to false and `ai_quality_score` is cleared (the previous AI verdict is stale).

### `POST /api/v1/ai/quality-check`

Body: `{ "text": "..." }`. Returns:
```json
{ "score": 1..5, "comment": "...", "word_count": N, "is_stub": false }
```

`is_stub: true` means the API key is a placeholder and the score came from the deterministic heuristic. The UI shows a small `[stub]` badge in that case.

### Lookups

- `GET /api/v1/lookups/categories?include_pending=true` — every authed user; returns approved + pending
- `POST /api/v1/lookups/categories` — propose new (any authed user). 409 on case-insensitive dup. Lands as `approved=false`
- `POST /api/v1/lookups/categories/:id/approve` — admin only
- `GET /api/v1/lookups/geographies` — every authed user

## Audit-log writer (the heart of M5)

`apps/api/app/services/audit_writer.py` registers a SQLAlchemy `Session.before_flush` listener. For every INSERT / UPDATE / DELETE on the `AUDITED_MODELS` set, it adds appropriate `AuditLog` rows to the same session — so audit writes are **transactional** with the data change.

Key design:
- **One audit_log row per changed field on UPDATE** (matches BRD: "every field change creates an entry … with old → new").
- **`new_value` / `old_value` JSONB always carries the parent `account_id`** so the AK02 activity-feed JSONB containment query (`new_value @> {"account_id": ":id"}`) picks up child-row changes automatically.
- **`changed_by_user_id` is read from a `ContextVar`** (`current_user_id_var`). The auth dep in `core/deps.py` sets it after JWT verification.
- For INSERTS, one row with the full snapshot in `new_value`.
- For DELETES, one tombstone row with the full snapshot in `old_value`.

To audit a new model, append it to `AUDITED_MODELS` and (if it's a child table) ensure the row has an `account_id` attribute.

## Stubbable Claude service

`apps/api/app/services/claude.py`:
- `_key_looks_real(key)` — returns true only if it starts with `sk-ant-` AND doesn't contain "stub" AND is long enough.
- `_stub_score(text)` — deterministic heuristic that scores on word count + presence of metric/value language. Used in tests + when `ANTHROPIC_API_KEY` is a stub.
- `_cached_real_score(prompt_hash, text)` — `@lru_cache(maxsize=512)` wrapper around the real Anthropic SDK call. Cache key is `sha256(model + "|" + text)` so repeat calls for the same input never re-bill. M7 will swap the in-process cache for Redis.
- The Anthropic SDK is **lazy-imported** so the rest of the API boots even when the key is a stub.

The stub fallback means we can demo M5 today without a real Anthropic key; production behavior unlocks the moment the key is set.

## Frontend state

```
<PreSalesTab>
  ├── useQuery ["engagement", accountId]    — server load
  ├── local form state (mirror of server, mutated freely)
  ├── useMutation patch                     — Save button
  └── useMutation aiQualityCheck            — AI button
       └── populates aiResult; dismissal handled via PATCH ai_quality_dismissed=true
```

Dirty detection: deep-compare the form against the last saved server state (excluding `updated_at`, `is_editable`, etc.).

PATCH body is the **diff** — only fields whose value changed go on the wire.

### TanStack Query keys
- `["engagement", accountId]`
- `["activity", accountId]` — invalidated on save so the Overview feed refreshes
- `["categories"]`
- `["geographies"]`

## Sequence — Save with audit log + activity feed update

```
Browser                FastAPI                          Postgres
   |--PATCH ...-------->|                                   |
   |    (diff body)     |--get_current_user (sets ctx)----->|
   |                    |--SELECT account / engagement----->|
   |                    |--check can_write_engagement       |
   |                    |--mutate model fields              |
   |                    |--commit                           |
   |                    |   before_flush listener emits N    |
   |                    |   AuditLog rows + the engagement   |
   |                    |   UPDATE in one transaction        |
   |                    |--BEGIN/UPDATE/INSERT…/COMMIT----->|
   |<--EngagementOut----|                                   |
   |                                                         |
   |--invalidate ["activity", accountId]                     |
   |--GET /accounts/:id/activity (refetch)------>|           |
   |<--items: new audit entries surface----------|           |
```

## Tests

`tests/test_engagement.py` — 18 tests across:
- GET: 401 unauth · admin sees full · CSM read-only on others · solutioning view-only · 404
- PATCH: admin succeeds + audits multiple fields · csm cannot edit non-own · solutioning forbidden (Q3) · csm own succeeds · objective change resets dismissal
- AI quality check: short → low score · strong → high score · empty 400 · unauth 401
- Lookups: list categories · propose creates pending · 409 duplicate · admin approve · csm cannot approve · list geographies

Full suite: 58 tests, 75% coverage.

## Configuration

No new env vars beyond what M2 specified. `ANTHROPIC_API_KEY` becomes meaningful in M5 — when it's a stub, AI returns deterministic scores.

## Security notes

- **Auth required:** yes (every endpoint).
- **RBAC:** `can_view_account` + `can_write_engagement` on the engagement endpoints; `require_admin` on category approve.
- **RLS:** `0005_realign_rls_per_matrix.sql` already covers `account_engagement` — Solutioning Manager has SELECT but no UPDATE per Q3.
- **Audit log immutability:** no API endpoint writes to `audit_log` directly. Only the SQLAlchemy listener (server side, transactional with data change). No way for a user to forge an entry.
- **Claude prompt scope:** prompts only contain the engagement-objective text — never customer-data from other accounts.
- **Cost control:** LRU cache for repeat calls; M7 will add Redis cache + per-user daily limits (matrix Q5).

## Performance

- `/engagement` GET: one indexed lookup on PK.
- `/engagement` PATCH: one UPDATE + N INSERTS into audit_log, all in one transaction.
- AI quality check: ~600ms p50 against Claude when configured; <1ms with stub.

## Known limitations & TODOs

- Per-user daily AI rate limit (Q5) lands in M7 with the Redis-backed cache.
- Admin UI for approving pending categories ships in Sprint 5; today an admin must hit `POST /api/v1/lookups/categories/:id/approve` directly.
- The audit writer doesn't yet capture the request_id end-to-end. Auth dep can set `request_id_var` from a request middleware in M6.
- BRD edge case "Two users edit Engagement Info simultaneously" — currently last-write-wins. The "this was edited by X 2 min ago" toast is a UX polish task for M6 onwards.

---

## Calculation Reference (single source of truth)

### Quality-check 1-5 score (Claude or stub)

`POST /api/v1/ai/quality-check` scores engagement objectives across 3 dimensions:

| Dimension | What's checked |
|---|---|
| **Specificity** | Named outcome / category / target |
| **Measurability** | Concrete metric / number / timeframe |
| **Value statement** | Business impact (savings, risk, growth) |

#### Score bands

| Score | Meaning | Stub heuristic |
|---|---|---|
| 1 | Too short / placeholder | `wc < 20` |
| 2 | Generic / missing measurable outcomes | `wc < 50 AND not (has_metric AND has_value)` OR neither signal present |
| 3 | Acceptable, but quantify the value | `has_metric OR has_value` (not both) |
| 4 | Strong shape, could expand | `has_metric AND has_value AND wc < 100` |
| 5 | Specific, measurable, value-anchored | `has_metric AND has_value AND wc >= 100` |

#### Stub regex signals

```py
has_metric = re.search(r"\b(\d+\s*%|\$\d|€\d|\d+m|\d+k|increase|reduce|improve|by\s+\d+)\b", text, re.I)
has_value  = re.search(r"\b(value|outcome|saving|risk|growth|efficienc|customer|cost|measur|target|"
                       r"deliver|impact|ROI|benchmark|negotiat|sourcing|adoption|renewal)\b", text, re.I)
wc = len(re.split(r"\s+", text.strip()))
```

Real Claude path: one Sonnet 4.5 call, `max_tokens=300`, strict JSON output `{score, comment}`. JSON-fence-stripping wrapper handles markdown-wrapped responses gracefully. Falls back to stub on any transient error or parse failure. (post-c66ab9e: stub no longer prepends "AI service unavailable" — see [M16 stub safety](../M16-mom-extraction/TECHNICAL.md)).

### Word count threshold (BRD AC)

UI shows amber warning when `wc < 120` words. The save isn't blocked — just a warning + auto-dismissable badge. `MIN_OBJECTIVE_WORDS = 120` constant in `PreSalesTab.tsx`.

`ai_quality_dismissed` flag on `account_engagement`: when a CSM clicks "Dismiss this warning" after scoring, this flag is set so the warning doesn't re-appear after saves. Cleared when the objective text changes.

### Category propose flow

`POST /api/v1/lookups/categories` accepts any authenticated user. Behaviour:

| Input | Outcome |
|---|---|
| Name `len ≥ 2 AND len ≤ 100` (trimmed) | Inserted with `approved=false` |
| Case-insensitive match to existing | 409 with the existing row's approval status in the error message |
| Anything else | 422 |

Pending categories appear in the picker with an amber `(pending)` suffix; they're selectable but visually distinct.

### CategoryPicker UX (post-migration 0050)

After migration 0050 grew the canonical list to 2,879 categories across 22 domains, the picker switched from a dump-list to a search-first interface:

- **🔍 Search** input (case-insensitive substring across all 2,879 names)
- **Domain dropdown** narrows to one of 22 domains
- **Render cap** at 30 matches; "Show all N" link expands
- **Scrollable** `max-h-64` container
- **Tooltip** on each chip shows `<domain>` or `<domain> · pipeline`

Frontend [`PreSalesTab.tsx::CategoryPicker`](../../../apps/web/src/routes/accounts/tabs/PreSalesTab.tsx) — purely client-side over the cached lookup list (60s stale-while-revalidate).

### Audit-log auto-writer

`AUDITED_MODELS` set in `services/audit_writer.py`. SQLA `before_flush` listener inspects each dirty instance and writes one `audit_log` row per CHANGED field. JSONB `old_value` / `new_value` always carry the parent `account_id` so account-level activity feeds catch child-row edits via JSONB containment:

```sql
WHERE new_value @> '{"account_id": "<id>"}'
   OR old_value @> '{"account_id": "<id>"}'
```

User attribution: `current_user_id_var` is a `ContextVar` set by `get_current_user` dep on every request. Listener reads it at flush time. If unset (e.g. seed script), audit row gets `user_id = NULL`.

### Where to change these values

| To change | Edit |
|---|---|
| Quality-check word thresholds (20/50/100) | `_stub_score` in [`apps/api/app/services/claude.py`](../../../apps/api/app/services/claude.py) |
| Quality-check signal regexes (has_metric/has_value) | same function |
| MIN_OBJECTIVE_WORDS UI warning (120) | constant in `PreSalesTab.tsx` |
| Category name length (2-100) | `CategoryProposeRequest` in [`apps/api/app/schemas/lookup.py`](../../../apps/api/app/schemas/lookup.py) |
| CategoryPicker render cap (30) | `RENDER_CAP` in `PreSalesTab.tsx::CategoryPicker` |
| Audited models list | `AUDITED_MODELS` in [`services/audit_writer.py`](../../../apps/api/app/services/audit_writer.py) |
