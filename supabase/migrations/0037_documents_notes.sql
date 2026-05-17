-- BUG-FIX (sprint-1 bug tracker, Bug 3): "Notes / content section missing
-- after MoM or VPD file is uploaded. Prototype provides a notes section to
-- add remarks to each uploaded file."
--
-- Per-document free-text notes. Editable by anyone with documents-write
-- access on the parent account.

alter table documents
  add column if not exists notes text;
