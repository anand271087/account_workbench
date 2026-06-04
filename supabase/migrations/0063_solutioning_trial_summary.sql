-- 03-Jun bug — "Engagement Shape" section in Solutioning renamed to
-- "Trial Summary" with a new field set:
--   * client_type (Existing / New)
--   * trial_type (Trial / Pilot)
--   * payment_type (Complimentary / Pro Bono / Paid)
--   * trial_date
--   * modules_tested (jsonb — per-module config captured during trial)
--   * trial_outcome (text — "What happened in the trial?")
--   * trial_feedback (text — overall feedback)
--
-- The legacy engagement_type / engagement_duration_months columns stay
-- in place so existing rows continue to load; new UI surfaces the
-- Trial Summary fields instead.

alter table public.account_solutioning
  add column if not exists trial_client_type text,
  add column if not exists trial_type text,
  add column if not exists trial_payment_type text,
  add column if not exists trial_date date,
  add column if not exists trial_modules_tested jsonb not null default '{}'::jsonb,
  add column if not exists trial_outcome text,
  add column if not exists trial_feedback text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname='chk_solutioning_trial_client_type') then
    alter table public.account_solutioning
      add constraint chk_solutioning_trial_client_type
      check (trial_client_type is null or trial_client_type in ('Existing','New'));
  end if;
  if not exists (select 1 from pg_constraint where conname='chk_solutioning_trial_type') then
    alter table public.account_solutioning
      add constraint chk_solutioning_trial_type
      check (trial_type is null or trial_type in ('Trial','Pilot'));
  end if;
  if not exists (select 1 from pg_constraint where conname='chk_solutioning_trial_payment_type') then
    alter table public.account_solutioning
      add constraint chk_solutioning_trial_payment_type
      check (
        trial_payment_type is null
        or trial_payment_type in ('Complimentary','Pro Bono','Paid')
      );
  end if;
  if not exists (select 1 from pg_constraint where conname='chk_solutioning_trial_modules_obj') then
    alter table public.account_solutioning
      add constraint chk_solutioning_trial_modules_obj
      check (jsonb_typeof(trial_modules_tested) = 'object');
  end if;
end $$;
