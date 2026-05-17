-- M15.1 — AI candidate-goals extraction from VPD docs.
--
-- After the existing VPD AI summary + extract_vpd_fields pass, the
-- worker also runs a second pass that extracts candidate Goals from
-- the document text. Result lives on the document row as jsonb so the
-- frontend can show a "Review N candidate goals →" CTA + a review
-- modal that fans out POST /cs-goals on user confirm.
--
-- Mirrors the M16 pattern (documents.mom_extracted_fields) — same
-- shape, different consumer.

alter table documents
  add column if not exists cs_goals_extracted     jsonb,
  add column if not exists cs_goals_extracted_at  timestamptz;

alter table documents
  drop constraint if exists chk_documents_cs_goals_extracted_object;
alter table documents
  add constraint chk_documents_cs_goals_extracted_object
  check (
    cs_goals_extracted is null
    or jsonb_typeof(cs_goals_extracted) = 'object'
  );
