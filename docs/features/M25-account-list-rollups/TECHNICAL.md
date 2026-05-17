# M25 — AccountList Rollups — Technical Spec

**Commit:** `0764eba`
**Shipped:** 2026-05-17

## Schema additions

`apps/api/app/schemas/account.py::AccountListItem` — 7 new fields:

```py
alignment_status: str | None = None           # green / amber / red / None
goal_count: int = 0
next_checkpoint_type: str | None = None
next_checkpoint_date: date | None = None
next_checkpoint_days_until: int | None = None
overdue_checkpoint_count: int = 0
dr_outcome: str | None = None                 # M23 outcome if set
```

No new columns on `accounts` — `dr_outcome` already exists from M23; the rest derive from cs_goals + checkpoints tables.

## Performance

Naive per-row fetches would be N+1 against `cs_goals` and `checkpoints`. The list route batch-fetches:

```py
account_ids = [r[0].id for r in rows]
rollups = await _attach_rollups(db, account_ids, today) if account_ids else {}
```

`_attach_rollups` runs **two queries** regardless of page size:

1. **Goal counts per account:**
```py
select(
  CSGoal.account_id,
  func.count(CSGoal.id).label("total"),
  func.count(CSGoal.id).filter(CSGoal.alignment_status == "aligned").label("aligned"),
  func.count(CSGoal.id).filter(CSGoal.alignment_status == "partial").label("partial"),
).where(CSGoal.account_id.in_(account_ids))
 .where(CSGoal.deleted_at.is_(None))
 .group_by(CSGoal.account_id)
```

2. **All non-signed-off checkpoints for the page:**
```py
select(Checkpoint)
  .where(Checkpoint.account_id.in_(account_ids))
  .where(Checkpoint.status != "signed_off")
```

Each account has ≤4 active checkpoints in practice; the per-account next/overdue derivation happens in Python. Acceptable because the list endpoint already returns at most `page_size=200` accounts.

## Alignment rollup logic

```py
if total == 0:                   status_dot = None
elif aligned == total:           status_dot = "green"
elif aligned > 0 or partial > 0: status_dot = "amber"
else:                            status_dot = "red"
```

The `aligned == 0 and partial == 0 → red` branch fires when all goals are `not_started` — the rollup treats "no progress on any goal" as a worse signal than "some progress everywhere".

## Frontend

`apps/web/src/routes/accounts/AccountListPage.tsx`:

- **Type sync** — `types/account.ts::AccountListItem` mirrors the new fields.
- **`RollupBadges`** component renders the dot + chip + outcome pill stacked below the renewal pill in the same cell. No layout shift on rows without rollup data.
- **`RenewalAlertsBanner`** filters `days_to_renewal ∈ [0, 60]`, sorts ascending, slices to first 10, navigates to `/accounts/:id/overview` on chip click.

## Tests

`apps/api/tests/test_account_rollups.py` — 5 cases:

| Test | Asserts |
|------|---------|
| `test_list_returns_rollup_fields` | All 7 new fields present on every row |
| `test_alignment_status_amber_when_partial` | Creating a partial goal flips the dot to amber |
| `test_next_checkpoint_picks_earliest_upcoming` | With MBR at +10d and QBR at +60d, next = MBR |
| `test_overdue_count_increments` | Past-dated checkpoint → `overdue_checkpoint_count = 1` |
| `test_dr_outcome_appears_on_row` | Setting M23 outcome surfaces it in the list row |

All tests use slug-targeted lookups (`_row(items, "siemens-energy")`) instead of count-based assertions, to avoid the cross-test pollution that flakes `test_accounts.py`.
