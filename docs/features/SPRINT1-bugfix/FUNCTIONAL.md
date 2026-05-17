# Sprint-1 Bug Tracker — Functional Spec

**Source:** `Bug_Tracker_For 1st Sprint.xlsx` (Harish S, 2026-05-12)
**Build:** https://account-workbench-web.vercel.app/
**Shipped:** 2026-05-17 (commit `190ac7f`)

## Summary

7 bugs from sprint-1 stakeholder testing, all addressed in a single bundled pass. 4 × P1 (Major), 2 × P2 (Minor), and 1 × P1 verified as expected-behaviour-with-poor-UX.

| ID | Sev | Module | Resolution |
|----|-----|--------|------------|
| 1 | P1 | Roles | Upload affordance disabled for roles that can't write the kind |
| 2 | P1 | MOM | Verified extraction endpoints work for non-Admin; apply step gating clarified |
| 3 | P1 | MOM | Per-document notes field added with editor on the doc row |
| 4 | P2 | Contacts | Duplicate (name OR email) preflight + 409 surface |
| 5 | P2 | Other | Logout button is now sticky at the bottom of the sidebar |
| 6 | P1 | MOM | Paste-text + CSV + MD + XLSX accepted on MoM/VPD upload zones |
| 7 | P1 | Roles | Account reassign opened to admin / cs_director / vp_csm / vp_sales |

---

## Bug 7 — Reassign owner widened (P1)

**Behaviour before:** Only Admin could reassign an account owner. The Reassign link and the bulk-reassign affordance on `/accounts` were admin-only.

**Behaviour after:** Admin, CS Director, VP CSM, and VP Sales can reassign. The Reassign link appears on the row for any of these four roles; bulk reassign uses the same gate.

**RBAC rationale:** Each reassign is captured by the existing audit listener, so widening the predicate doesn't create an unaccounted-for window.

**Verify:** Log in as CS Director or VP Sales → open `/accounts` → the Reassign link appears next to each account name and works end-to-end.

---

## Bug 5 — Sticky logout (P2)

**Behaviour before:** On long account profiles, the sidebar grew with the main content and the avatar + sign-out footer scrolled off-screen — users had to scroll back to the top of the page to log out.

**Behaviour after:** The navy sidebar is viewport-locked. Pinned accounts list scrolls internally; the avatar + sign-out footer is permanently visible at the bottom-left.

**Verify:** Open any long account profile (e.g. a Pre-Sales tab with many MoMs uploaded) → scroll down on the main content → the sidebar footer never moves out of view.

---

## Bug 4 — Contact dedup on name OR email (P2)

**Behaviour before:** Adding a contact with a duplicate name silently created a second row. Adding a duplicate email returned a 409 from the backend but the UI only surfaced it as a generic save error.

**Behaviour after:**
1. **Preflight in the form** — Save button disables when the typed name or email (case-insensitive trim) matches any non-deleted contact on the account. A red banner names the existing row: `A contact with this name already exists on this account: "Jordan Mills". Edit the existing row instead of creating a duplicate.`
2. **Backend enforcement** — `POST /accounts/:id/contacts` does its own server-side name check before insert and returns 409 with the same message. Email uniqueness was already enforced via the `ux_client_contacts_account_email` unique index.

**Verify:** Contacts tab → "+ Add contact" → type the name of any existing contact → Save shows "Duplicate detected" and is disabled.

---

## Bug 2 — AI extraction for non-Admin (P1, verified-only)

**Behaviour before / after:** No code change. Verified that the following endpoints do **not** gate by admin role:
- `POST /documents/:id/extract-fields` (MoM)
- `POST /documents/:id/extract-goals` (VPD)
- `POST /ai/quality-check`

All three are view-gated (or auth-only). Any role that can view the parent account can trigger extraction.

**The actual visible failure** was downstream: the auto-apply step (PATCH `/engagement`, POST `/contacts`, POST `/cs-goals`) honours per-section write RBAC. For example, a `solutioning_manager` can extract but can't apply to Engagement (matrix Q3: view-only). The MoM extraction review modal already surfaces these per-row as red "Failed" pills.

**Verify:** Log in as a non-admin CSM on one of your own accounts → upload an MoM → the modal opens with the per-row results, and Apply succeeds where you have write access, fails (with a clear error) where you don't.

---

## Bug 3 — Per-document notes (P1)

**Behaviour before:** The prototype's per-document notes section was missing from MoM and VPD uploads — there was no place to add remarks ("Jordan was distracted, follow up by phone", "VPD V2 — Phase 2 added", etc.).

**Behaviour after:** Each uploaded document row now has a notes editor.
- Empty state shows a small `+ Add note` link.
- Click to open a 2-line textarea (4000-char max).
- Save on blur, or Cmd/Ctrl+Enter.
- Notes are visible to everyone with view access; only roles that can write the document kind can edit.

**Verify:** Documents tab on any account → "+ Add note" on a doc row → type, click outside → reload, note persists.

---

## Bug 6 — Paste / CSV / MD / XLSX uploads (P1)

**Behaviour before:** MoM/VPD upload zones only accepted `.docx/.doc/.pptx/.ppt/.xlsx/.xls/.pdf/.txt/.vtt/.eml`. CSVs, markdown files, and pasted text from emails were rejected.

**Behaviour after:**
- `.csv`, `.md`, `.markdown` now accepted at the file picker, drag-drop, and the backend extractor. Excel was already supported via markitdown.
- New **Paste text** button next to the file input opens a 14-row textarea modal. Click "Upload as text" → content becomes a synthetic `pasted-{kind}-{ts}.txt` file and flows through the regular pipeline (Celery → AI summary → MoM/VPD field extraction → review modal).

**Verify:** Pre-Sales → MoM card → click "Paste text" → paste a meeting recap → Upload → in ~5 seconds the AI summary lands and the MoM extraction modal opens.

---

## Bug 1 — Role-aware upload (P1)

**Behaviour before:** Anyone with view access on the account saw the upload prompt even if their role couldn't write that document kind. Drag-drop and file picker were not disabled — the user could try to upload and only learn about the 403 from a generic error toast.

**Behaviour after:** `KindUploadCard` now reads `is_editable` from the documents listing (already returned by `/accounts/:id/documents`, derived from `can_write_documents(role, kind)`).
- File input + Paste button disabled when can't write.
- Drag-drop is a no-op (events return early before preventing default).
- Amber badge displays: **"Read-only — your role can't upload VPDs on this account."**

**Verify:** Log in as a `solutioning_manager` → open an account → Pre-Sales (MoM upload) shows the read-only badge; Solutioning (VPD upload) is fully enabled (matrix Q4).

---

## Test coverage notes

Pre-existing test-pollution flakes (`test_pagination`, `test_list_contacts_admin`) are **not** introduced by these fixes — they assert hardcoded counts against a DB that accumulates rows across runs. Tracked separately in the v1.1 backlog (switch cross-test cleanup to fixture-scoped truncates).
