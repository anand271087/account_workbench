-- M11 — Solutioning trial / POC block + value-definition lock
--
-- Adds the discovery-trial fields from the v20 prototype (what was tested,
-- with whom, for how long, and the trial summary) plus an explicit
-- "Solutioning locked, ready for Sales Hand-off" gate that captures who
-- pushed it through and when. Unlock is a manual edit-and-re-pass.

do $$ begin
  create type trial_kind as enum ('trial', 'poc', 'pilot', 'demo', 'none');
exception when duplicate_object then null; end $$;

alter table account_solutioning
  add column if not exists trial_conducted boolean,
  add column if not exists trial_type trial_kind,
  add column if not exists trial_duration_text text,
  add column if not exists trial_participant_count integer,
  add column if not exists trial_participants_text text,
  add column if not exists key_users_text text,
  add column if not exists info_tested text,
  add column if not exists hypothesis_tested text,
  add column if not exists trial_summary text,
  add column if not exists locked_at timestamptz,
  add column if not exists locked_by uuid references users(id) on delete set null;

-- Sanity: participant count is non-negative.
do $$ begin
  alter table account_solutioning
    add constraint chk_account_solutioning_participants_nonneg
    check (trial_participant_count is null or trial_participant_count >= 0);
exception when duplicate_object then null; end $$;
