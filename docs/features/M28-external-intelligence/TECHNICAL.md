# M28 — External Intelligence — Technical

**Commit:** `273e66f`
**Shipped:** 2026-05-17

## Migration 0038

```sql
-- intel_news_category enum (10 values matching prototype filter strip)
-- intel_signal_relevance enum (high / medium / low)
-- intel_news_items table:
--   id, account_id (FK accounts), category, headline, summary,
--   source, source_url, news_date, signal_relevance,
--   is_new, signal_created, signal_id (FK soft_signals on delete set null),
--   ai_generated, hidden, added_by (FK users), created_at, updated_at
-- Indexes:
--   ix_intel_news_account (account_id) WHERE hidden = false
--   ix_intel_news_account_category (account_id, category) WHERE hidden = false
```

## Model — `app/models/intel_news.py`

`IntelNewsItem` with declarative columns. ENUM types created with `create_type=False` because the migration owns enum lifecycle.

## Schemas — `app/schemas/intel_news.py`

- `IntelNewsOut` / `IntelNewsListResponse`
- `IntelNewsCreate` / `IntelNewsUpdate`
- `IntelRefreshResponse` (returns `{ created: int, is_stub: bool }`)
- `PushAsSignalBody` (empty — body shape reserved for future overrides)

## Service — `app/services/intel_news.py`

Three layers, mirroring the pattern from M16 MoM extraction:

```py
def stub_generate(*, account_name, industry, today) -> list[dict]:
    """Deterministic 6-item set. Seed = sha256(account_name).
    Rotates the 10-category list by seed % 10, picks first 6. Each item
    uses a per-category template populated with {name} and {industry}."""

def _real_generate(*, account_name, industry, today) -> list[dict]:
    """One Claude call. JSON-only schema. Falls back to stub on parse fail."""

def generate_intel_news(*, account_name, industry, today) -> tuple[list, bool]:
    """Public entry. Returns (items, is_stub)."""
```

24h cache keyed on `sha256(intel|model|name|industry)`, sharing the `_doc_cache` dict from `services/claude.py`. One retry on transient errors.

## Routes — `app/routes/intel_news.py`

```
GET    /accounts/:id/intel-news               → list (non-hidden, sorted by news_date desc)
POST   /accounts/:id/intel-news                → manual add
POST   /accounts/:id/intel-news/refresh        → AI gen, dedup on headline
PATCH  /intel-news/:id                         → update / hide / mark-read
POST   /intel-news/:id/push-as-signal          → create SoftSignal + back-link (idempotent)
DELETE /intel-news/:id                         → admin-only hard delete
```

### Push-as-signal logic
```py
# Idempotent:
if item.signal_created and item.signal_id is not None:
    return IntelNewsOut.model_validate(item)

sig_type = _CATEGORY_TO_SIGNAL_TYPE.get(item.category, "neutral")
impact = _RELEVANCE_TO_IMPACT.get(item.signal_relevance, "medium")
signal = SoftSignal(account_id=item.account_id, type=sig_type, ...)
db.add(signal); await db.flush()  # populate signal.id

item.signal_created = True
item.signal_id = signal.id
```

### Refresh dedup
Refresh fetches existing headlines for the account (lowercased), skips any new item whose headline already exists. Re-runs are no-ops once the corpus is established.

### Date coercion
The Claude/stub generator returns `news_date` as an ISO string; the route coerces to `date.fromisoformat()` before insert so asyncpg can bind to the DATE column.

## Frontend

```
apps/web/src/types/intel_news.ts                 # type mirror + CATEGORY_LABELS + CATEGORY_COLOR + RELEVANCE_LABELS
apps/web/src/routes/accounts/tabs/gp/ExternalIntelTab.tsx  # main view (~450 lines)
```

Push-as-signal mutation invalidates three caches so the M26 Appetite banner reflects the shift immediately:
```ts
qc.invalidateQueries({ queryKey: ["intel-news", accountId] });
qc.invalidateQueries({ queryKey: ["signals", accountId] });
qc.invalidateQueries({ queryKey: ["appetite", accountId] });
```

## Tests — `apps/api/tests/test_intel_news.py`

6 cases (all green):

| Test | Asserts |
|---|---|
| `test_stub_generate_is_deterministic_and_diverse` | Same seed → same items; spans ≥4 categories |
| `test_refresh_creates_then_dedups_on_second_call` | `created` count drops to 0 on re-run |
| `test_manual_create_then_patch_hides` | Hidden items excluded from list |
| `test_push_as_signal_creates_signal_then_is_idempotent` | Type / impact mapping verified; second call returns same `signal_id` |
| `test_solutioning_manager_cannot_refresh` | 403 — sol_mgr is view-only on cs_onboarding |
| `test_csm_on_own_account_can_refresh_and_push` | CSM-on-own happy path |
