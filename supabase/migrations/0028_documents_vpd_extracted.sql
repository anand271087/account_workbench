-- M16.x — Persist VPD field extraction on the document row.
--
-- Mirrors 0026 (MoM extraction) for the VPD flow. The worker now writes the
-- structured Solutioning candidate payload (proposed_solution / engagement_*
-- / value_themes / value_definition / estimated_value_musd) to this column
-- instead of directly mutating account_solutioning. The frontend polling
-- loop sees the column flip and one-shot applies the result as a dirty
-- draft on the Solutioning form — user reviews, then clicks Save.

alter table documents
  add column if not exists vpd_extracted_fields jsonb,
  add column if not exists vpd_extracted_at      timestamptz;

alter table documents
  drop constraint if exists chk_documents_vpd_extracted_object;

alter table documents
  add constraint chk_documents_vpd_extracted_object
  check (vpd_extracted_fields is null or jsonb_typeof(vpd_extracted_fields) = 'object');
