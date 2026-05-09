# M10 — Production polish + deploy

## What it does

Brings Sprint 1 from "feature-complete on localhost" to "live on Render + Vercel for stakeholder demo," plus a batch of UX polish that came out of using the app on real data. No new feature scope — every change here is a tightening, fixing, or finishing of work shipped in M1–M9.

## Six concrete deliverables

### 1. Visual match to the prototype HTML
Every Sprint 1 page now mirrors `prototype/beroe_awb_v20.html` for typography, colours, and layout: 224 px navy sidebar with brightened text contrast, sub-nav as underline tabs (not pills), 14 px-radius cards with the prototype's `--cb` border, prototype's KPI / chip / pill components. Login screen is unchanged.

### 2. Account profile UX upgrades
- **Header KPI strip:** ACV / Renewal / Health / Tier / Category are uniform mini-cards. Renewal *and* Health now render as **red alert pills with a ⚠ icon** when the value is bad ("70d overdue", "At Risk"). Cards align to a common baseline so the strip stops looking jagged.
- **Solutioning** sub-tab moved next to Pre-Sales (was after Documents).
- **Overview tab redesigned** — no more duplication with the header KPIs:
  - Engagement snapshot (objective preview, target-categories chips, geographies, procurement maturity / AI penetration / spend mini-stats).
  - Three side-by-side mini-cards: Roster (active contacts + SPOC/Sponsor counts), Documents (count + ready/processing pills + last filename), Solutioning (handed-off badge + estimated value + engagement type).
  - Lifecycle progress bar with a today marker, renewal date overlay (red if overdue), Account type / Segment / Last activity / Target ACV with headroom calculation.
  - Sales Discovery Summary preview (only when one exists).
- **Sortable Client Contacts columns** — click any column header.

### 3. Unsaved-changes guard (Pre-Sales + Solutioning)
- Sticky save bar **pulses amber** when dirty with hint text *"Unsaved changes · Cmd / Ctrl + S to save"*.
- Trying to leave the tab (clicking another sub-tab, sidebar item, browser refresh, or close) pops a three-button dialog: **Save & continue / Discard & continue / Stay**.
- The destination is shown human-readably (*"Going to Solutioning"*, not the raw UUID URL).
- `Cmd / Ctrl + S` shortcut triggers save.

### 4. Persistent favourites
- **Star icon** on every account row in AK01 + on the AK02 header. Click to pin / unpin.
- Pinned accounts appear in the sidebar **Pinned** section. Cross-device — pins follow you to any browser, persisted in `user_favorites` (Postgres). Cap of 10 (oldest pin drops when you exceed it).
- CSMs and CS Team Managers also see a **My portfolio** auto-section listing their assigned accounts.

### 5. Categories admin page
- New **Sidebar → Admin → Categories** entry (admin only).
- Two-column layout: pending review (left) | approved (right).
- Approve any pending category in one click; reject opens a modal that requires a **rejection reason** (5 char minimum, ≤ 500 chars). The reason gets persisted to the audit log so anyone can see later why it was killed.
- Quick-pick reason chips ("Duplicate of an existing category", "Spelling or naming error", etc.) — click to fill the textarea.

### 6. Production deployment
- **render.yaml blueprint** — one-click setup for the API + Celery worker + managed Redis on Render.
- **vercel.json SPA fallback** — deep links like `/accounts/<id>/documents` no longer 404 on browser refresh or direct paste.
- Step-by-step deploy guide at `docs/deploy/RENDER_VERCEL.md` covering: blueprint setup, env wiring, Vercel project, CORS update, Supabase Auth redirect URLs, smoke test, rollback plan.

## Who uses what

| Role | Sees |
|---|---|
| Anyone | Star toggle on any visible account, Pinned sidebar section, prettier KPI strip on AK02 header, redesigned Overview, sub-nav as underline tabs, unsaved-changes guard on editable forms |
| CSM / CS Team Manager | All of the above + the **My portfolio** sidebar auto-section |
| Admin | All of the above + **Sidebar → Admin → Categories** for approving/rejecting CSM-proposed categories with audit-logged rejection reasons |

## Business rules

- Every favourite cap of 10 — pinning the 11th drops the oldest pin.
- Rejection reason is required (≥5 chars). The reason is written to `audit_log` before the category row is deleted.
- Approved categories cannot be deleted (engagement records reference them); the API returns 400 if you try.
- Sticky save bar's "Cmd/Ctrl + S" only fires when the form is dirty AND not already saving — no double-fires.
- The unsaved-changes dialog's "Discard & continue" reverts the form back to last-saved values, then navigates.

## What gets logged

- Category rejection: `audit_log` row with `table_name='lookup_categories'`, `action='delete'`, `new_value={ rejected: true, name, reason }`, `changed_by_user_id=admin`. The reason is searchable / queryable.
- Favourite pin/unpin: deliberately *not* audited — high-volume, per-user UI state, of no business interest.

## Status
✅ Built — M10. Deployed to Render + Vercel. End-to-end smoke-tested on the live URL.

## Demo flow

1. Open https://account-workbench-web.vercel.app → log in as `anand@beroe-inc.com`.
2. Click the **star** on Mondelēz → it appears in the Pinned sidebar section. Open in a different browser → still pinned (DB-backed, not localStorage).
3. Open Mondelēz → header KPI strip: Renewal "70d overdue" shows as a red alert pill with ⚠. Sub-nav tabs are underlined.
4. **Pre-Sales** → edit the engagement objective → bottom save bar turns amber + pulses → press `Cmd+S` → saved.
5. Edit again → click **Contacts** sub-tab → unsaved-changes dialog → choose Save & continue → navigates after save.
6. Sign in as CSM (`harish@beroe-inc.com`) → propose a new category from Pre-Sales target-categories field → "(pending)" pill.
7. Switch back to admin → **Sidebar → Admin → Categories** → reject with a reason → category disappears, reason in audit log.
