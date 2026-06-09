-- 09-Jun · Unify "candidate goals" + "autofill success metrics"
-- under one VPD-review modal. Both are extracted from the same VPD
-- (worker step after AI summary). Goals already persisted to
-- documents.cs_goals_extracted. Metrics were on-demand only via the
-- POST /documents/:id/extract-metrics route. Adding parallel columns
-- so the worker can auto-persist metrics too — single CTA on the VPD
-- doc row reads both counts and opens one unified review modal.
--
-- Idempotent — safe to re-apply.

alter table documents
  add column if not exists metrics_extracted jsonb;

alter table documents
  add column if not exists metrics_extracted_at timestamptz;
