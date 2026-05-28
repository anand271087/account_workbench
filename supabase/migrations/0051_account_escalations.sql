-- 0051 — Escalations on accounts.
--
-- Mirrors prototype's notes.escalations[] shape (line 4140 of
-- beroe_awb_v20.html). Single jsonb array on accounts; same single-jsonb
-- pattern as M19 success_contract / M22 value_delivery_document / M23
-- delivery_renewal.red_flags.
--
-- Each escalation entry:
--   { id, raised_at, raised_by_user_id, raised_by_name, reason,
--     escalation_type, owner, next_action, status, resolved_at,
--     resolved_by_user_id, resolved_note }
--
-- status ∈ {open, in_progress, resolved}
-- escalation_type ∈ {director, sales, joint}

alter table accounts
  add column if not exists escalations jsonb not null default '[]'::jsonb;

alter table accounts
  add constraint chk_accounts_escalations_array
  check (jsonb_typeof(escalations) = 'array');
