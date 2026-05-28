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

**REWRITTEN 2026-05-27:** the original 3-path (GDELT → Claude synth → stub) shipped first but stakeholder asked for **real-only news**. Stub fallback REMOVED; synthesised Claude path REMOVED; migration 0049 wiped stub-seeded rows from the DB. Only GDELT remains.

### GDELT integration (production path)

[`apps/api/app/services/intel_news.py`](../../../apps/api/app/services/intel_news.py) calls the **GDELT DOC 2.0 ArtList API** — public, free, no auth required. Source: `https://api.gdeltproject.org/api/v2/doc/doc`.

**Request params:**
```
query     = "<account_name>" sourcelang:eng    # exact phrase + ISO-639-3 English code
mode      = ArtList
format    = json
maxrecords= 25
timespan  = 30d
sort      = DateDesc
```

**Required header:** `User-Agent: Mozilla/5.0 (compatible; BeroeAWB/1.0; ...)`. GDELT silently times out on the default `python-httpx/x.y.z` UA.

**Rate-limit floor:** 6.5 seconds between successive hits (in-process). GDELT's documented limit is "1 request / 5 seconds".

**Defensive parsing:**
- Non-200 status → `[]`
- non-JSON Content-Type → `[]`
- Throttle banner ("Please limit requests…") → caught at JSON parse → `[]`
- Network timeout / HTTPError → `[]`

**Dedup:** title prefix (lowercase first 80 chars).

### Three-step pipeline

```python
def generate_intel_news(*, account_name, industry, today=None, force_refresh=False
) -> tuple[list[dict], bool]:
    # Returns (items, is_stub). is_stub is ALWAYS False — kept for backwards
    # compat with the route response shape; stubs no longer exist.

    if not llm.is_configured():
        return [], False                # empty state, never invent news

    cache_hit (unless force_refresh)   → return cached

    1. _fetch_gdelt_articles(account_name)
         → real headlines (or [] if nothing/error)
    2. _classify_gdelt_with_llm(articles, account, industry)
         → Claude batched call: classify each into 10 categories +
           write procurement-context summary + assign relevance
         → drops items Claude flags as NOT procurement-relevant
    3. cache 24h, return (items, False)
```

### Claude classifier prompt

Batches up to 15 raw headlines + URLs + dates per call. System prompt asks Claude to:
- **KEEP** items with clear procurement implications (financial, supply-chain, supplier-strategy, regulatory, ESG, digital, geopolitical, M&A, capex, innovation)
- **REJECT** marketing / HR / sports / exec-bio / general-business stories
- For each KEEP: classify into ONE category, rewrite summary in procurement context, assign `signal_relevance ∈ {high, medium, low}`
- Use `input_index` so we can map enriched items back to their source articles (URL + domain + seendate preserved)

Output schema (strict JSON):
```json
{"items": [{"input_index": 3, "category": "supply_chain",
  "summary": "≤300 chars procurement-anglised", "signal_relevance": "high"}]}
```

Failure modes:
- JSON parse fail → `[]`
- Claude HTTP error → caught + `[]`
- Empty result → `[]`

### Force refresh (Refresh button)

`generate_intel_news(force_refresh=True)` skips the 24h cache lookup. Caller is `/intel-news/refresh` route (Row in 2026-05-27 batch).

### Cache key

```
sha256("intel|" + llm.backend_label() + "|" + account_name + "|" + (industry or ""))
```

Shared with `_doc_cache` dict in `services/claude.py`. 24h TTL.

### Stub removed

Migration `0049_purge_synthetic_intel_news.sql` wiped all rows where `source_url IS NULL` (synthetic items, by definition). Going forward only real GDELT articles can land in the table.

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
