-- M16.x — Extend meeting_records + vpd bucket allowed_mime_types for the full
-- office-suite Markitdown can read.
--
-- Adds:
--   .pptx → application/vnd.openxmlformats-officedocument.presentationml.presentation
--   .ppt  → application/vnd.ms-powerpoint   (upload allowed; extract returns
--                                            a friendly "Save As .pptx" error)
--   .xlsx → application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
--   .xls  → application/vnd.ms-excel
--
-- contracts bucket left alone — those are pdf/docx only.

update storage.buckets
set allowed_mime_types = array[
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/plain',
  'text/vtt',
  'message/rfc822',
  'application/octet-stream'
]
where id = 'meeting_records';

update storage.buckets
set allowed_mime_types = array[
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/plain',
  'application/octet-stream'
]
where id = 'vpd';
