# Live findings — 2026-05-22 stakeholder test pass

18 findings across security, RBAC, data, and naming. Triaged below.

## Real bugs (will fix)

| # | Severity | Title | Plan |
|---|---|---|---|
| LIVE-003 | P0 | VP Sales can access `/admin/categories` | Tighten `RequireAdmin` from `is_global_admin` → `can_view_admin_panel` (admin-exact). Same gate now blocks vp_csm, cs_director too — matrix says admin-only for User mgmt + Categories admin. |
| LIVE-007 | P1 | VP Sales `/admin/users` hangs on "Loading…" | Same fix as LIVE-003. Tightened guard sends VP Sales to `/access-denied` before UsersPage's query fires. |
| LIVE-004/005/006 | P1 | Mondelez Home empty (signals / pipeline / metrics) | Mondelez has 0 soft_signals, 1 account_play, 0 success_metrics in DB. Seed real data so demo screens populate. |
| LIVE-008 | P1 | 3×409 console errors on app init | Investigate. Likely the legacy localStorage→DB favorites migration POSTs that 409 on duplicates (already silently caught). Tighten: skip migration if user has zero legacy entries. |
| LIVE-011 | P2 | "Test1" / "XTT" test accounts visible in CSM portfolio | Soft-delete in DB. |
| LIVE-012 | P2 | CS Onboarding sub-tab not clickable | Verify route + label; likely a rename mismatch. |
| LIVE-013 | P2 | Two Health numbers on Home ("Score: 56" vs "Health 41") | Rename Appetite mode chip's "Score" → "Appetite Score" to distinguish from Health KPI. |

## Not bugs (matrix-intended behavior)

| # | Severity | Title | Why not a bug |
|---|---|---|---|
| LIVE-001 | P0 | CSM IDOR — can view other accounts | Per `Roles_Access_Matrix_Reviewed_05072026.xlsx` (the canonical source over BRD §3.2 narrative): CSM/CS Team Manager see ALL accounts in the list, read-only on non-own/non-team. `can_view_account()` correctly returns True for global readers. The "(read-only)" tag in the header IS the documented signal that they can view but not edit. |
| LIVE-002 | P0 | Solutioning Mgr IDOR | Same. Per matrix Q3: Solutioning Manager can see ALL accounts read-only; only edits Solutioning section. Behaviour intentional. |
| LIVE-018 | P2 | JWT in localStorage with `user_metadata.role` claim | Already addressed by design (CLAUDE.md decision 2026-05-08): "App role lives in `public.users.role`, NOT in JWT claims. RLS as third wall + FastAPI `require_role` as second wall + frontend gating as first." Server re-reads role from DB on every request via `get_current_user`. Tampering the JWT claim doesn't escalate. |
| LIVE-009/010 | P3 | Spec ↔ build naming drift on Success Mgmt sub-tabs / top-tab count | Per user, no build change needed — spec gets updated. |

## Defensive hardening worth doing anyway

- LIVE-001/002 read-only badge: already present but could be more prominent. Out of scope this pass.
- LIVE-008: even if it's the favorites migration noise, switching the contact-create / favorites endpoints to return 200-with-"skipped" instead of 409 would silence the console. Smaller — out of scope; matrix-intended behavior.
