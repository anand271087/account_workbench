# Sprint-1 Bug Tracker — Technical Spec

**Commit:** `190ac7f`
**Shipped:** 2026-05-17

## Diff surface

```
 apps/api/app/core/config.py              # allow .csv/.md/.markdown
 apps/api/app/core/rbac.py                # reassign predicate widened
 apps/api/app/models/document.py          # +notes column
 apps/api/app/routes/contacts.py          # +server-side name dedup
 apps/api/app/routes/documents.py         # +PATCH /:id/notes
 apps/api/app/schemas/document.py         # +DocumentNotesUpdate, +notes field
 apps/api/app/services/extract.py         # .csv/.md handled
 apps/api/tests/test_accounts.py          # reassign test widened
 apps/web/src/components/AppShell.tsx     # sticky aside
 apps/web/src/components/KindUploadCard.tsx  # role-aware upload, NotesEditor, PasteTextButton
 apps/web/src/routes/accounts/AccountListPage.tsx  # canReassign instead of isAdmin
 apps/web/src/routes/accounts/tabs/ContactsTab.tsx  # preflight dedup
 apps/web/src/types/document.ts           # notes field
 render.yaml                              # ALLOWED_DOC_EXTENSIONS
 supabase/migrations/0037_documents_notes.sql   # +notes column
```

15 files; 356 insertions, 20 deletions.

---

## Bug 7 — Reassign RBAC

`app/core/rbac.py::can_reassign_account_owner`

```py
def can_reassign_account_owner(role: str) -> bool:
    return role in {"admin", "cs_director", "vp_csm", "vp_sales"}
```

Frontend `AccountListPage.tsx` swaps the global `isAdmin` check for a kept-in-sync `canReassign`:

```ts
const canReassign = !!me && [
  "admin", "cs_director", "vp_csm", "vp_sales",
].includes(me.user.role);
```

Used by:
- per-row Reassign button (`Row` component now takes `canReassign` instead of `isAdmin`)
- bulk-reassign header + checkbox column (`canBulkReassign = canReassign`)

Test:
```py
def test_reassign_owner_admin_only(...):
    # CSM still 403
    # CS Director (newly allowed) → 200
```

---

## Bug 5 — Sticky logout

`apps/web/src/components/AppShell.tsx` — sidebar `<aside>` change:

```diff
- <aside className="w-[224px] ... flex flex-col flex-shrink-0">
+ <aside className="w-[224px] ... flex flex-col flex-shrink-0 sticky top-0 h-screen self-start">
```

Why sticky + `h-screen` + `self-start`?
- `sticky top-0` locks the element to the top of its parent's flex container as the user scrolls
- `h-screen` constrains the aside to the viewport height (otherwise the flex parent forces it to grow with `<main>`)
- `self-start` keeps the sticky positioning relative to the top edge of the flex item, not centered

Inner `<nav>` already had `flex-1 overflow-y-auto`, so account lists scroll inside the aside without pushing the footer.

---

## Bug 4 — Contact dedup

### Frontend (preflight)

`apps/web/src/routes/accounts/tabs/ContactsTab.tsx::ContactFormModal`:

```ts
const nameKey = form.name.trim().toLowerCase();
const emailKey = (form.email ?? "").trim().toLowerCase();
const dup = existing.find(
  (c) =>
    c.id !== initial?.id &&
    !c.deleted_at &&
    ((nameKey && c.name.trim().toLowerCase() === nameKey) ||
      (emailKey && (c.email ?? "").trim().toLowerCase() === emailKey)),
);
```

- Excludes the row being edited (`c.id !== initial?.id`)
- Excludes soft-deleted rows (`!c.deleted_at`)
- Case-insensitive trimmed match on name OR email

Save button disables and shows `"Duplicate detected"` when `dup` is truthy.

### Backend (defense-in-depth)

`apps/api/app/routes/contacts.py::create_contact`:

```py
clash = (
    await db.execute(
        select(ClientContact)
        .where(ClientContact.account_id == account_id)
        .where(ClientContact.deleted_at.is_(None))
        .where(func.lower(func.trim(ClientContact.name)) == name_key)
    )
).scalar_one_or_none()
if clash is not None:
    raise HTTPException(409, f'A contact with this name already exists ...')
```

Email uniqueness was already enforced by `ux_client_contacts_account_email` (partial unique index from `0011_contacts_brd_realign.sql`).

---

## Bug 3 — Document notes

### Migration

`supabase/migrations/0037_documents_notes.sql`:

```sql
alter table documents
  add column if not exists notes text;
```

No CHECK constraint — empty / null / multi-line text all valid.

### Schema + route

`apps/api/app/schemas/document.py`:

```py
class DocumentNotesUpdate(BaseModel):
    notes: str = Field("", max_length=4000)
```

`apps/api/app/routes/documents.py`:

```py
@document_router.patch("/{document_id}/notes", response_model=DocumentOut)
async def edit_notes(...) -> DocumentOut:
    if not can_write_documents(user.role, ..., kind=doc.kind):
        raise HTTPException(403, "Cannot edit this document")
    doc.notes = body.notes.strip() or None
    await db.commit()
```

Empty-string-after-strip stores as NULL so the empty-state `+ Add note` link reappears.

### Frontend

`KindUploadCard.tsx::NotesEditor`:

- 2-line textarea with save-on-blur + Cmd/Ctrl+Enter shortcut
- `dirty` flag turns the editor border amber until the mutation resolves
- For non-writers, the existing note stays visible but the textarea is read-only

---

## Bug 6 — Paste / CSV / MD / XLSX uploads

### Backend

`apps/api/app/services/extract.py`:

```py
elif name.endswith((".txt", ".csv", ".md", ".markdown")):
    text = data.decode("utf-8", errors="replace")
```

Added to the `extract_text` dispatch alongside the existing `.txt` branch. `errors="replace"` keeps the extraction non-fatal on dirty UTF-8 inputs (BOMs, mixed encodings).

`apps/api/app/core/config.py::Settings.allowed_doc_extensions` extended:

```py
allowed_doc_extensions: str = (
    ".docx,.doc,.pptx,.ppt,.xlsx,.xls,.pdf,.txt,.vtt,.eml,.csv,.md,.markdown"
)
```

`render.yaml` `ALLOWED_DOC_EXTENSIONS` env var updated to match (otherwise the production validation in `documents.py::upload_document` would reject these formats even with the local default).

### Frontend

`KindUploadCard.tsx::PasteTextButton`:

```ts
const blob = new Blob([text], { type: "text/plain" });
const file = new File(
  [blob],
  `pasted-${kind}-${stamp}.txt`,
  { type: "text/plain" },
);
await handleFiles([file]);
```

The pasted content is wrapped as a synthetic `File` and dropped into the same `handleFiles` pipeline that real uploads use. The filename pattern (`pasted-{kind}-{ISO-timestamp}.txt`) makes it greppable in the documents listing.

`ALLOWED_EXT` const updated to mirror the backend list — keeps the `accept=` attribute on the file input and the placeholder hint in sync with what the backend will actually accept.

---

## Bug 1 — Role-aware upload

`KindUploadCard.tsx` reads `data.is_editable` from the documents listing endpoint:

```ts
const canUpload = data?.is_editable ?? false;
```

`is_editable` is computed server-side in `documents.py::list_documents`:

```py
is_editable = can_write_documents(
    user.role, is_assigned=is_assigned, is_team=is_team, kind=kind
)
```

So the gate matches the kind. A `solutioning_manager` reading the MoM tab sees `is_editable: false` (Q3) but reading the VPD tab sees `is_editable: true` (Q4).

UI changes when `!canUpload`:
- `<input type="file" disabled />`
- `<PasteTextButton disabled />`
- drag-drop handlers return early before `preventDefault()`
- amber badge: `"Read-only — your role can't upload {VPDs|MoMs} on this account."`
- card itself rendered with `opacity-70` so the read-only state is visually obvious

---

## Test status

```
$ pytest tests/test_accounts.py::test_reassign_owner_admin_only \
        tests/test_contacts.py tests/test_documents.py -q
29 passed, 1 failed (test_list_contacts_admin — pre-existing pollution)
```

`test_list_contacts_admin` was failing **before** this commit (asserts 4 contacts; DB has accumulated ~10 from prior test runs). Tracked in v1.1 backlog.
