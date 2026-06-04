-- 03-Jun — CS Handoff prototype port.
--
-- Adds the state the prototype needs that doesn't fit existing columns:
--   * accounts.cs_handoff jsonb — { realignment: {block, note, sent_at,
--     sent_to} | null, started: bool, started_at: timestamptz | null }
--   * cs_goals validation: 'pending' (default) | 'accepted' | 'flagged' |
--     'removed'. Distinct from alignment_status, which tracks Phase A/B/C
--     progress; validation_status is the CSM's per-goal sign-off.
--   * cs_goals.flag_note — required when status='flagged'.
--   * cs_goals.phase_*_completed_at — timestamps drive the prototype's
--     "Done" badge per phase, independent of alignment_status rollups.

-- ============================================================
-- 1) accounts.cs_handoff
-- ============================================================
alter table public.accounts
  add column if not exists cs_handoff jsonb not null default '{}'::jsonb;

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'chk_accounts_cs_handoff_is_object'
  ) then
    alter table public.accounts
      add constraint chk_accounts_cs_handoff_is_object
      check (jsonb_typeof(cs_handoff) = 'object');
  end if;
end $$;

-- ============================================================
-- 2) cs_goal_validation_status enum + cs_goals columns
-- ============================================================
do $$ begin
  create type cs_goal_validation_status as enum (
    'pending', 'accepted', 'flagged', 'removed'
  );
exception when duplicate_object then null; end $$;

alter table public.cs_goals
  add column if not exists validation_status
    cs_goal_validation_status not null default 'pending';

alter table public.cs_goals
  add column if not exists flag_note text;

alter table public.cs_goals
  add column if not exists phase_a_completed_at timestamptz;

alter table public.cs_goals
  add column if not exists phase_b_completed_at timestamptz;

alter table public.cs_goals
  add column if not exists phase_c_completed_at timestamptz;

-- A 'flagged' goal must carry a non-trivial reason. Belt-and-braces; the
-- API enforces min length=5 too.
do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'chk_cs_goals_flag_has_note'
  ) then
    alter table public.cs_goals
      add constraint chk_cs_goals_flag_has_note
      check (
        validation_status <> 'flagged'
        or (flag_note is not null and length(trim(flag_note)) >= 5)
      );
  end if;
end $$;

-- Hot path: filter by validation_status when assembling the CS Handoff
-- ready-checks rollup.
create index if not exists idx_cs_goals_account_validation
  on cs_goals (account_id, validation_status) where deleted_at is null;
