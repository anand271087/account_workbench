-- M14 — CS Onboarding (Phase 5a)
--
-- Adds the Entry type picker + Entry B baseline context + CSM-side
-- handover checklist + 3-role stakeholder map. All on accounts as small
-- text / jsonb columns to match the prototype's flat data shape — no new
-- tables until the Phase 5b Goal Validation work (which needs proper
-- relational structure for initiatives + audit history).
--
-- Why the CSM checklist is separate from accounts.handover_quality_check:
--   - handover_quality_check (M13) = Sales side. "Did Sales pass these?"
--   - cs_handover_checklist (M14) = CSM side. "Did CSM confirm receipt?"
-- Two-sided handshake on the same 4 items. Keeping them separate avoids
-- ambiguity about who confirmed what.

do $$ begin
  create type cs_entry_type as enum ('A', 'B');
exception when duplicate_object then null; end $$;

alter table accounts
  add column if not exists cs_entry_type           cs_entry_type,
  add column if not exists cs_entry_b_context      text,
  add column if not exists cs_entry_b_goals        text,
  -- CSM-side handover checklist, shape mirrors handover_quality_check.
  -- {"savings": true, "stakeholders": true, "categories": true, "success_metric": false}
  add column if not exists cs_handover_checklist   jsonb not null default '{}',
  -- 3 mandatory roles, each {name, email, phone}. Empty {} = nothing filled in.
  -- {"commercial": {...}, "champion": {...}, "category": {...}}
  add column if not exists cs_stakeholders         jsonb not null default '{}';

-- Sanity: both jsonb columns must be objects (not arrays / scalars).
do $$ begin
  alter table accounts
    add constraint chk_accounts_cs_handover_object
    check (jsonb_typeof(cs_handover_checklist) = 'object');
exception when duplicate_object then null; end $$;

do $$ begin
  alter table accounts
    add constraint chk_accounts_cs_stakeholders_object
    check (jsonb_typeof(cs_stakeholders) = 'object');
exception when duplicate_object then null; end $$;
