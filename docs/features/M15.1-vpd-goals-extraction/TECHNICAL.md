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
