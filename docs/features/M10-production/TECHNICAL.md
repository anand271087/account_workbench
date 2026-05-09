# M10 — Production polish + deploy — Technical

## Files touched

### New files

| File | Purpose |
|---|---|
| `apps/web/src/lib/use-unsaved-changes.ts` | `useUnsavedChangesGuard` — `beforeunload` + click-capture intercept + `Cmd/Ctrl+S` |
| `apps/web/src/components/UnsavedChangesDialog.tsx` | Save & continue / Discard / Stay modal with prettified destination labels |
| `apps/web/src/lib/use-favorites.ts` | `useFavoriteAccounts` — DB-backed via `/api/v1/me/favorites`; auto-migrates Phase-1 localStorage entries on first load |
| `apps/web/src/components/StarButton.tsx` | Pin/unpin toggle (filled gold star vs outline) |
| `apps/web/src/routes/admin/CategoriesPage.tsx` | `/admin/categories` two-column page + reject-with-reason modal |
| `apps/api/app/models/user_favorite.py` | `UserFavorite` ORM (composite PK `user_id, account_id`) |
| `apps/api/app/routes/favorites.py` | `GET / POST / DELETE /api/v1/me/favorites/{account_id}` (per-user, RLS-protected) |
| `supabase/migrations/0016_user_favorites.sql` | `user_favorites` table + RLS (`user_id = auth.uid()`) |
| `apps/web/eslint.config.js` | ESLint v9 flat config (replaces deleted `.eslintrc.cjs`) |
| `apps/web/vercel.json` | SPA catch-all rewrite — every unmatched path → `/index.html` |
| `render.yaml` | Render Blueprint: web + worker + redis with env wiring via `fromService` |
| `docs/deploy/RENDER_VERCEL.md` | Step-by-step deploy guide |
| `docs/features/M10-production/FUNCTIONAL.md` + `TECHNICAL.md` | This doc set |
| `apps/api/uv.lock` | 142-package lockfile committed for `uv sync --frozen` on Render |

### Modified files

| File | What changed |
|---|---|
| `apps/web/tailwind.config.ts` | New tokens: `card-border` (#e4eaf6), `navy-4` (#001e52), `rounded-card` (14px), `rounded-ctl` (10px), `shadow.subtab` |
| `apps/web/src/components/AppShell.tsx` | 224 px sidebar to prototype `.sb-btn` spec; brightened text contrast; new `Pinned` + `My portfolio` sections; rewrote logout glyph as a real icon-button |
| `apps/web/src/routes/accounts/AccountListPage.tsx` | Star button per row; uses `useFavoriteAccounts` hook |
| `apps/web/src/routes/accounts/AccountProfileLayout.tsx` | Sub-nav switched from pills → `.tab-b` underline (12px font-medium, 2.5px transparent border that fills on active); KPI strip → uniform mini-cards with red alert tone for danger; star button next to account title |
| `apps/web/src/routes/accounts/tabs/OverviewTab.tsx` | Full redesign — 4 cards (engagement snapshot / 3-up status / lifecycle / discovery preview) + activity feed |
| `apps/web/src/routes/accounts/tabs/PreSalesTab.tsx` + `SolutioningTab.tsx` | Sticky save bar pulses on dirty; `useUnsavedChangesGuard` + `UnsavedChangesDialog` |
| `apps/web/src/routes/accounts/tabs/ContactsTab.tsx` | Sortable column headers (server-side `?sort_by=…&sort_dir=…`) |
| `apps/web/src/routes/accounts/tabs/DocumentsTab.tsx` | Drag-drop multi-file; AI-tag pill (AI-generated / AI-assisted); summary inline edit; rerun-confirm dialog; rerun-button stuck-state recovery (>90 s old → enabled) |
| `apps/web/src/routes/admin/UsersPage.tsx` | Cards/borders harmonized to `beroe-card-border` |
| `apps/api/app/db/session.py` | Auto-detects `:5432` (session-mode, stmt cache=200, pool 3+7=10) vs `:6543` (transaction-mode, stmt cache=0, pool 10+20=30) from `DATABASE_URL` |
| `apps/api/app/routes/lookups.py` | New `DELETE /lookups/categories/:id` (admin only); writes `audit_log` row with `new_value.reason` before deleting |
| `apps/api/app/main.py` | Wires `favorite_routes.router` |
| `apps/web/package.json` + `pnpm-lock.yaml` | Add `@eslint/js`, `globals`, `typescript-eslint` (v9 flat config) |
| `.github/workflows/web-ci.yml` | Drop `version: 9` from `pnpm/action-setup` (conflicted with `packageManager`) |

## Data model

### `user_favorites`
```sql
create table user_favorites (
  user_id    uuid not null references users(id) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade,
  pinned_at  timestamptz not null default now(),
  primary key (user_id, account_id)
);
create index idx_user_favorites_user_pinned on user_favorites (user_id, pinned_at desc);

alter table user_favorites enable row level security;
create policy user_favorites_self on user_favorites
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
```

Composite PK = idempotent inserts. RLS at the DB layer + per-user scope at the API = users can never see each other's pins.

### `audit_log` for rejected categories
Row written by `routes/lookups.py::reject_category` directly (categories aren't in `AUDITED_MODELS`):
```python
AuditLog(
  table_name="lookup_categories",
  row_id=category_id,
  action="delete",
  changed_by_user_id=user.id,
  old_value={"name": ..., "approved": False},
  new_value={"rejected": True, "name": ..., "reason": "≤500 chars"},
)
```

## API contracts

### Favourites
- `GET /api/v1/me/favorites` → `[{id, name, slug, pinned_at}]` (newest first, ≤ 10 rows)
- `POST /api/v1/me/favorites/{account_id}` → returns the full updated list. Idempotent. Server enforces cap (drops oldest pin if exceeded).
- `DELETE /api/v1/me/favorites/{account_id}` → returns the full updated list.

### Categories
- `DELETE /api/v1/lookups/categories/{id}?reason=…` (admin only). 400 if approved (engagement rows reference). Logs to `audit_log` before delete.

## Frontend — guard hook design

`useUnsavedChangesGuard({ dirty, isSaving, onSaveShortcut })` returns `{ pendingHref, proceed, stay }`. Strategy:

1. **`beforeunload` event** — browser-level, catches refresh/close/external nav.
2. **Capture-phase click handler on document** — intercepts `<a href>` clicks that would change `pathname`. If dirty, prevents the default + sets `pendingHref`. Page renders the dialog conditionally.
3. **`keydown` for Cmd/Ctrl+S** — calls the page's save callback.

**Why not React Router's `useBlocker`:** That requires the data router (`createBrowserRouter` + `RouterProvider`). We're on `<BrowserRouter>` (declarative). Click-capture works without migrating.

## Performance

### Categories load
- Unified query key `["categories"]` shared by Pre-Sales picker + admin Categories page → one fetch, two consumers.
- `staleTime: 30_000` so re-entering the page is instant.
- Skeleton rows during cold loads instead of "Loading…" text — feels < 1 s even when it's actually 800 ms.

### DB pooler
| Mode | Port | Stmt cache | Pool | Cap | Latency |
|---|---|---|---|---|---|
| Session (Free tier) | 5432 | 200 | 3+7 | **15** | ~110 ms / query |
| Transaction (Free tier) | 6543 | 0 | 10+20 | **~200** | ~220 ms / query |

We auto-detect from the URL's port. Production runs on 6543 to escape the 15-client cap. Code path is single — just flip `DATABASE_URL` on the host to switch.

## Tests

`pnpm lint` + `pnpm tsc --noEmit` clean. Backend `pytest` suite at 97/97 (no test count change in this batch — the work was fixes + UX, not new behaviour requiring new test coverage). The contacts test was made re-run-safe in the M-prime audit pass (per-run suffix on engagement_objective string).

## Configuration

No new env vars. Render Blueprint (`render.yaml`) declares the existing ones with `sync: false` so secrets stay out of git.

## Security notes

- **Vercel SPA fallback** — only matches paths that don't resolve to real assets. Hashed bundle filenames (`assets/index-<hash>.js`) still serve correctly. The rewrite is a fallback, not a global override.
- **`user_favorites` RLS** — `using (user_id = auth.uid())`. Even with a leaked anon key, a user can only read their own pins.
- **Render env wiring** — secrets in `render.yaml` are `sync: false` (placeholders only); admin pastes real values in the Render dashboard. Never committed.
- **`uv.lock`** — pins all 142 transitive deps. Reproducible, audit-able.
- **`vercel.json`** rewrite is read-only on the build output; no security implication.

## Rollback strategy

| What broke | Roll back |
|---|---|
| Bad backend deploy | Render → `beroe-awb-api` → Deploys → previous green deploy → **Rollback** |
| Bad frontend deploy | Vercel → Deployments → previous green → **Promote to Production** |
| Bad DB migration | Forward-only — write `0017_revert_X.sql` and apply via Supabase Management API |
| Stuck job (EMAXCONNSESSION etc.) | Click **Rerun** in Documents UI (now enabled on >90 s pending) — fresh job, fresh enqueue |

## Known limitations & TODOs

- Favourites are still capped at 10 via the API (server-side `MAX_FAVORITES`). If users start asking for more, swap the trim logic for an LRU eviction or just raise the cap.
- The `react-refresh/only-export-components` rule is off because we deliberately export hooks alongside components (`useAuth`, `useAccountFromLayout`). Fast Refresh edge case isn't worth the friction. Migrate to component-only files in a future cleanup if Fast Refresh becomes an issue.
- The Vercel SPA rewrite serves `index.html` for *all* unknown paths. If you later add server-rendered routes (e.g. SEO landing pages), exclude them from the rewrite.
- Render free-tier web service spins down after 15 min idle; first request takes 30+ s. Either upgrade web to Starter ($7/mo) or attach a 5-min uptime pinger (`https://cron-job.org`).
- The session-pooler 15-client cap pinches if local dev + production share the same Supabase project. Either keep prod on `:6543` (current) or pause the local services when not coding.
