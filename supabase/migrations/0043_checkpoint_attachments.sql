-- R31 — file / recording attachments on checkpoints. Each entry is
-- { name: string, url: string | null } stored in jsonb so the shape can
-- grow (size, content_type, etc.) without DDL churn.

alter table checkpoints
  add column if not exists attachments jsonb not null default '[]'::jsonb;

alter table checkpoints
  drop constraint if exists chk_checkpoints_attachments_array;

alter table checkpoints
  add constraint chk_checkpoints_attachments_array
  check (jsonb_typeof(attachments) = 'array');
