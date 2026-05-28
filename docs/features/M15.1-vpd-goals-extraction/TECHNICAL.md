# M15.1 — VPD Goals Extraction — Technical Spec

**Commit:** `9c4ee13`
**Shipped:** 2026-05-12

## Migration

`0034_documents_cs_goals_extracted.sql`:

```sql
alter table documents
  add column if not exists cs_goals_extracted     jsonb,
  add column if not exists cs_goals_extracted_at  timestamptz;

alter table documents
  add constraint chk_documents_cs_goals_extracted_object
  check (cs_goals_extracted is null or jsonb_typeof(cs_goals_extracted) = 'object');
```

Same shape as M16's `mom_extracted_fields` / `mom_extracted_at`.

## Schema

`apps/api/app/schemas/cs_goals_extraction.py`:

```py
class ExtractedInitiative(BaseModel):
    name: str
    description: str | None = ...
    stage: InitiativeStage | None = None
    levers: list[str] = Field(default_factory=list)

class ExtractedGoal(BaseModel):
    title: str
    category: CSGoalCategory = "other"
    target_value: str | None = ...
    target_date: date | None = None
    owner: str | None = ...
    initiatives: list[ExtractedInitiative] = Field(default_factory=list)
    confidence: Literal["high", "medium", "low"] | None = None
    rationale: str | None = ...

class CsGoalsExtractionResult(BaseModel):
    document_id: UUID | None = None
    goals: list[ExtractedGoal] = Field(default_factory=list)
    is_stub: bool = False
```

`extra="allow"` everywhere — same per-category-extras pattern as M15 cs_goals.

## Service — `app/services/claude.py`

Three new functions:

```py
def _classify_goal_category(blob: str) -> str:
    # Keyword bag — "cost|savings|save|reduction" → cost_savings, etc.

def _stub_cs_goals_extract(text: str) -> dict:
    # Deterministic — splits on bullets, filters lines with outcome verbs
    # (save/reduce/improve/...), classifies, caps at 6.

def _real_cs_goals_extract(text: str) -> dict:
    # One Anthropic call. JSON-only schema in the system prompt.
    # max_tokens=2000. Falls back to stub on JSON-parse failure.
```

Public entry point:

```py
def extract_cs_goals_from_vpd(text: str) -> dict:
    # Routes to stub when key isn't real; otherwise 24h cache lookup,
    # one Claude call, one retry on transient errors, then stub fallback.
    digest = hashlib.sha256(f"vpd-goals|{model}|{text}".encode()).hexdigest()
```

Cache shared with `_doc_cache` (same TTL `_REAL_CACHE_TTL_SECONDS`).

## Worker hookup

`apps/api/app/workers/tasks.py::process_document`:

```py
if doc.kind == "vpd":
    try:
        vpd_extracted = extract_vpd_fields(text)
        doc.vpd_extracted_fields = vpd_extracted
        doc.vpd_extracted_at = datetime.now(timezone.utc)
        await db.commit()
    except Exception:
        logger.exception("VPD field extraction failed (non-fatal)")

    # M15.1 — also pull candidate Goals.
    try:
        goals_extracted = extract_cs_goals_from_vpd(text)
        doc.cs_goals_extracted = goals_extracted
        doc.cs_goals_extracted_at = datetime.now(timezone.utc)
        await db.commit()
    except Exception:
        logger.exception("VPD candidate-goals extraction failed (non-fatal)")
```

Both extraction steps are wrapped in `try/except` — a failure logs but doesn't fail the parent AI summary job. Same pattern as the M16 MoM extraction.

## Endpoint (manual trigger)

```
POST /api/v1/documents/:id/extract-goals → CsGoalsExtractionResult
```

- View-gated (`can_view_account`)
- VPD-kind-only (returns 422 otherwise)
- Billed against `ai_quota` with label `vpd_goals_extract`
- Idempotent — 24h cache means repeated calls don't re-bill

The worker auto-run is the primary path; this endpoint exists for re-extraction without re-uploading.

## Frontend

`apps/web/src/types/cs_goals_extraction.ts` — type mirror, `CATEGORY_LABELS` / `CATEGORY_TONES` / `CONFIDENCE_TONES` constants.

`apps/web/src/components/VpdGoalsExtractionReview.tsx` — review modal:

- Per-row checkbox state in component-local React state (`RowState extends ExtractedGoal`)
- `Promise.allSettled` fan-out so one failing row doesn't roll back the others
- 409 → recorded as **skipped** (matches M16 contact-create semantics)
- Mutations invalidate `["cs-goals", accountId]` so Contract & Goals tab refreshes on close

Trigger lives in `KindUploadCard.tsx::DocumentRow`:

```ts
{doc.kind === "vpd" && (() => {
  const extracted = doc.cs_goals_extracted as CsGoalsExtractionResult | null;
  const goalCount = extracted?.goals?.length ?? 0;
  if (goalCount === 0) return null;
  return <button onClick={() => setGoalsModalOpen(true)}>
    Review {goalCount} candidate goals →
  </button>;
})()}
```

## Tests

`apps/api/tests/test_cs_goals_extraction.py` — 10 cases:

| Test | Asserts |
|------|---------|
| `test_classify_goal_category_cost_savings` | "Save $2M annually..." → `cost_savings` |
| `test_classify_goal_category_base_rationalization` | Supplier consolidation → `base_rationalization` |
| `test_classify_goal_category_risk_mitigation` | Single-source risk → `risk_mitigation` |
| `test_classify_goal_category_adoption` | "Drive adoption..." → `adoption` |
| `test_classify_goal_category_other_fallback` | Generic activity → `other` |
| `test_stub_extract_returns_goals_from_bullets` | Bullet list yields 4 outcome goals, filters filler |
| `test_stub_extract_caps_at_six` | 20-bullet input → exactly 6 goals |
| `test_stub_extract_classifies_each_goal` | One bullet per category → all 4 categories present |
| `test_stub_extract_empty_input_returns_empty_list` | Empty string → empty goals list |
| `test_extract_cs_goals_falls_back_to_stub_without_real_key` | No-key path returns `is_stub: true` |

**All green.**

---

## VPD Success-Metrics Extraction (27-May Row 81)

Shipped as commit `574c248` (27-May 2026). Mirrors the goals-extraction shape exactly so the route + frontend share the same Promise.allSettled fan-out pattern.

### Files added

| File | Purpose |
|---|---|
| `apps/api/app/schemas/vpd_metrics_extraction.py` | `ExtractedMetric` + `VpdMetricsExtractionResult` schemas |
| `apps/api/app/services/claude.py` (functions added) | `_stub_vpd_metrics_extract`, `_real_vpd_metrics_extract`, `extract_metrics_from_vpd` |
| `apps/api/app/routes/documents.py::extract_metrics` | New endpoint `POST /documents/:id/extract-metrics` |
| `apps/web/src/types/vpd_metrics_extraction.ts` | TS mirror of the Python schema |
| `apps/web/src/components/VpdMetricsExtractionReview.tsx` | Review modal with per-row checkbox + edit |
| `apps/web/src/routes/accounts/tabs/SolutioningTab.tsx` (`VpdMetricsAutofillButton`) | One-click trigger on the Solutioning tab |

### Endpoint

```
POST /api/v1/documents/:id/extract-metrics
```

- **RBAC:** view-gated (`can_view_account`). Apply step uses existing `POST /accounts/:id/metrics` which has per-row write RBAC.
- **422** if `doc.kind != 'vpd'`.
- **Billed** against the per-user/day `ai_quota` (label `vpd_metrics_extract`).
- Returns `VpdMetricsExtractionResult { document_id, metrics: [...], is_stub }`.

### Stub heuristic (no-key path)

Lines that include a TARGET token (`$2M`, `80%`, `12 months`, `Q4`) are kept. Quantitative if the target carries digits/`%`/`$`; qualitative otherwise. Cap at 8.

### Real Claude prompt

Strict JSON output:
```json
{"metrics": [
  {"name": "≤180 char metric label",
   "metric_type": "quantitative|qualitative",
   "target_value": "'$2M' | '80%' | '12 months' | 'High' | null",
   "owner": "name or null",
   "confidence": "high|medium|low",
   "rationale": "≤2 sentences"}
]}
```

Rules baked into the prompt:
- A success metric is **measurable signal of delivery** (savings $, adoption %, supplier-count cuts, NPS, time-to-value)
- `quantitative` = numeric/%/$/units; `qualitative` = ordinal (High/Med/Low)
- Skip activity-level items ("we will hold weekly calls")
- Cap at 8

### Apply flow (review modal)

Same fan-out pattern as goals:

```js
await Promise.allSettled(targets.map(async ({ r, i }) => {
  try {
    await api.post(`/api/v1/accounts/${accountId}/metrics`, {
      name: r.name, metric_type: r.metric_type,
      target_value: r.target_value, owner: r.owner,
    });
    updateRow(i, { _status: "done" });
  } catch (e) {
    // 409 → "skipped" (idempotent re-apply), other → "failed"
    const status = (e instanceof ApiError && e.status === 409) ? "skipped" : "failed";
    updateRow(i, { _status: status, _message: e.message });
  }
}));
qc.invalidateQueries({ queryKey: ["metrics", accountId] });
```

Default per-row `_selected` = `(confidence ?? "low") !== "low"` — auto-checks medium/high rows.

### Cache

Same 24h `_doc_cache` shared across all VPD extracts, keyed on:
```
sha256("vpd-metrics|" + llm.backend_label() + "|" + text)
```
