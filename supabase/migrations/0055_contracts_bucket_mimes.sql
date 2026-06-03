-- ============================================================
-- 0055_contracts_bucket_mimes.sql
-- ============================================================
--
-- Fix: 415 invalid_mime_type when uploading a .txt to Sales Handoff.
--
-- The `contracts` bucket (migration 0010) was created with a strict
-- allowed_mime_types list of just PDF + DOCX + octet-stream. The Sales
-- Handoff "Upload handoff documents" affordance accepts a wider set
-- (the same files the MoM and VPD pipelines accept — text, markdown,
-- CSV, VTT, EML, .pptx, .xlsx). Widening the contracts bucket so the
-- 415 stops blocking legitimate handoff uploads.
--
-- Idempotent: replaces allowed_mime_types wholesale.

update storage.buckets
set allowed_mime_types = array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',  -- .docx
    'application/vnd.openxmlformats-officedocument.presentationml.presentation', -- .pptx
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',         -- .xlsx
    'application/msword',                                                        -- legacy .doc
    'text/plain',
    'text/markdown',
    'text/csv',
    'text/vtt',
    'message/rfc822',                                                            -- .eml
    'application/octet-stream'
  ]
where id = 'contracts';
