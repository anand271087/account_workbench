-- ============================================================
-- 0056_documents_handoff_extracted.sql
-- ============================================================
--
-- Adds two columns on `documents` to carry structured fields auto-
-- extracted by the Celery worker when kind='contract' (Sales Handoff
-- document). Mirrors the M16 mom_extracted_fields + M7.5
-- vpd_extracted_fields pattern.
--
-- The extracted JSON shape lives in apps/api/app/schemas/handoff_extraction.py
-- and feeds the Client Signed form on the Sales Hand-off tab as a
-- dirty draft (frontend polls + one-shot applies).

alter table public.documents
  add column if not exists handoff_extracted_fields jsonb,
  add column if not exists handoff_extracted_at     timestamptz;

comment on column public.documents.handoff_extracted_fields is
  'Structured Client Signed fields extracted from a kind=contract document (signed date, ACV, term, modules, platform tier, segment, subscribers).';
comment on column public.documents.handoff_extracted_at is
  'Timestamp of the most recent handoff extraction. Drives the frontend auto-apply gate.';
