-- M16 — Extend meeting_records bucket allowed_mime_types for .eml + .doc.
--
-- Adds:
--   message/rfc822          → .eml (Outlook mail exports — the SDR MoM format)
--   application/msword      → .doc (legacy binary Word; extract.py rejects with
--                              a friendly "Save As .docx" message, but the
--                              upload itself must succeed first so the user
--                              sees the actionable error rather than a 415
--                              from Storage)
--
-- VPD + contracts buckets unchanged — only meeting_records (MoMs) need .eml.

update storage.buckets
set allowed_mime_types = array[
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'text/plain',
  'text/vtt',
  'message/rfc822',
  'application/octet-stream'
]
where id = 'meeting_records';
