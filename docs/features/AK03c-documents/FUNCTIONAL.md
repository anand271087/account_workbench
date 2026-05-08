# AK03.c — Documents (MOM, VPD, transcripts, emails)

## What it does
Lets the team upload procurement-discovery documents to an account, summarises each one with Claude, and rolls them up into a single **Sales Discovery Summary** the CSM can quote in conversations. Supported formats today: `.docx`, `.pdf`, `.txt`, `.vtt`. Audio and video transcription land in v1.1.

## Who uses it

| Role | View | Upload **MOM** (and transcript / email / other) | Upload **VPD** (Value Prop Deck) |
|---|---|---|---|
| Admin | ✅ all | ✅ all | ✅ all |
| CS Director | ✅ all | ✅ all | ✅ all |
| VP — CSM | ✅ all | ✅ all | ✅ all |
| Solutioning Manager | ✅ all | ✅ all | ✅ all |
| CSM | ✅ all | ✅ own portfolio | ❌ view only |
| CS Team Manager | ✅ all | ✅ own + team | ❌ view only |
| Inside Sales Manager | ✅ assigned | ✅ assigned | ❌ view only |
| VP — Sales / Solutioning / Inside Sales | ✅ all | ❌ | ❌ |
| Commercial Owner | ✅ own | ❌ | ❌ |

(Per `Roles_Access_Matrix_Reviewed_05072026.xlsx`. The matrix is canonical when it conflicts with BRD §3.2 narrative.)

## How it works (user flow)

1. Open the Account → click the **Documents** sub-tab.
2. The top of the tab shows the **Sales Discovery Summary** for the account — an AI rollup of every processed document.
3. If the user can upload:
   - Pick the **document type** (Meeting Minutes, VPD, transcript, email, other).
   - Drop a file. The browser uploads it; the server returns immediately with a "queued" status.
4. Behind the scenes:
   - The server hashes the file and **deduplicates** — uploading the same content twice returns the original document, not a copy.
   - A Celery worker picks up the job, downloads the file from Supabase Storage, extracts text, asks Claude for a 200-word summary plus structured entities (people, decisions, action items, dates), and updates the row.
   - When all documents on the account are processed, the worker regenerates the **Sales Discovery Summary** so it always reflects the latest state.
5. The list shows each document with a status pill (Queued / Processing / Ready / Failed). Clicking **Show summary** expands the AI summary inline.
6. The user can:
   - **Rerun** the AI on a document if they want a fresh summary.
   - **Soft-delete** a document — kept for audit; aggregate summary regenerates without it.

## Business rules

- **Allowed formats:** `.docx`, `.pdf`, `.txt`, `.vtt`. Anything else returns 415 Unsupported.
- **Audio/video** (`.mp3`, `.mp4`, `.m4a`, `.wav`, `.mov`) return a clear "lands in v1.1" message — not a generic error.
- **Max file size:** 100 MB. Larger uploads are rejected at the API layer.
- **Per-account dedup:** uploading the same bytes twice for the same account is silently a no-op — you get the existing row back.
- **VPD is restricted:** only Solutioning Manager + CS Director / VP — CSM / Admin can write VPDs.
- **Soft delete:** documents stay in the database; the file in Storage is left in place for now. Deleted docs are excluded from the aggregate summary.
- **Rerun:** anyone with edit rights on the document kind can rerun. Resets `ai_status` to pending and regenerates.
- **AI fallback:** if Anthropic is down or no key is configured, the system uses a deterministic stub summary — the UI never breaks; rows just say "stub AI".

## What it stores

For each document: original filename, MIME type, size, file hash, the storage bucket key, who uploaded it, when, the AI status, the 200-word summary, and structured entities (people, decisions, action items, dates). For each account: a single rolled-up `Sales Discovery Summary` plus the list of source document IDs.

## What gets logged

Every upload, rerun, and delete writes to the audit log scoped to the account, so the Overview activity feed picks it up. The Celery job ID is preserved in `documents.job_id` for traceability.

## Edge cases user might hit

| Scenario | What happens |
|---|---|
| Upload a `.mp3` | 415 with "Audio/video transcription lands in v1.1." |
| Upload a `.exe` | 415 with allowed-extensions list. |
| Upload an empty file | 400 "Empty file". |
| Upload >100 MB | 413 "File exceeds 100 MB limit". |
| Upload identical bytes twice | 202 with `duplicate=true`; same document ID returned. |
| CSM tries to upload a VPD | 403; UI hides the option for them. |
| Anthropic key missing | Document still uploads; summary tagged `stub AI`; UI shows the stub badge. |
| Worker crashes mid-task | Job goes to `failed` with the error message; user can click Rerun. |

## Status
✅ Built — M7.

## Demo
1. Log in as `anand@beroe-inc.com` (admin).
2. Open Novo Nordisk → **Documents**.
3. Pick "Meeting Minutes" → upload a small `.txt` or `.docx` with a few action items.
4. The row appears with status **Queued**, flips to **Processing**, then **Ready** within seconds (worker must be running).
5. Click **Show summary** → expanded card with the AI summary + people/decisions/actions chips.
6. Open the Sales Discovery Summary card at the top → see the aggregated rollup.
7. Click **Rerun** to regenerate; click **Delete** to soft-delete.
