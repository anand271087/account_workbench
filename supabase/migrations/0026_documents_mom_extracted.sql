-- M16.x — Persist MoM field extraction on the document row.
--
-- The Celery worker now runs extract_from_mom() right after AI summarisation
-- (only for kind='mom') and writes the structured payload here. The frontend
-- polling loop sees these fields land and one-shot applies them as a
-- dirty/unsaved draft on the Pre-Sales + Brief forms — no user-click needed.

alter table documents
  add column if not exists mom_extracted_fields jsonb,
  add column if not exists mom_extracted_at      timestamptz;

-- Sanity: the column is either an object payload or NULL (no arrays / scalars).
alter table documents
  drop constraint if exists chk_documents_mom_extracted_object;

alter table documents
  add constraint chk_documents_mom_extracted_object
  check (mom_extracted_fields is null or jsonb_typeof(mom_extracted_fields) = 'object');
