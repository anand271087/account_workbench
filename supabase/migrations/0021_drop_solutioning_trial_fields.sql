-- M11.1 — Roll back the Trial / POC block on Solutioning.
--
-- Removes the 9 trial columns introduced by 0019. We KEEP locked_at +
-- locked_by because the Sales Hand-off lock is referenced separately in
-- the prototype (passSolToHandoff). Also drops the trial_kind enum since
-- nothing else uses it.
--
-- This is destructive: any data entered into these columns is gone.

alter table account_solutioning
  drop column if exists trial_conducted,
  drop column if exists trial_type,
  drop column if exists trial_duration_text,
  drop column if exists trial_participant_count,
  drop column if exists trial_participants_text,
  drop column if exists key_users_text,
  drop column if exists info_tested,
  drop column if exists hypothesis_tested,
  drop column if exists trial_summary;

-- Constraint added by 0019 — gone with the column, but drop explicitly
-- in case it survived on platforms that detach constraints first.
alter table account_solutioning
  drop constraint if exists chk_account_solutioning_participants_nonneg;

drop type if exists trial_kind;
