-- M2.5 — F01 AC-3: 5-fail lockout (15 min) on login.
--
-- A small append-only log of failed attempts keyed on email + a sliding
-- 15-minute window. Wins over the in-memory approach: survives restarts,
-- shared across multi-process API.
--
-- Successful logins are NOT logged here — Supabase already has its own
-- audit. This table exists solely to count fail-streaks per email.

create table if not exists login_attempts (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  attempted_at timestamptz not null default now(),
  ip          text,
  user_agent  text
);

create index if not exists idx_login_attempts_email_time
  on login_attempts (lower(email), attempted_at desc);

-- The API server (service role) is the only writer/reader; users never
-- query this table directly. RLS deny-all for `authenticated`.
alter table login_attempts enable row level security;

do $$ begin
  if exists (select 1 from pg_policies where tablename = 'login_attempts'
             and policyname = 'login_attempts_deny_all') then
    drop policy login_attempts_deny_all on login_attempts;
  end if;
end $$;

create policy login_attempts_deny_all
  on login_attempts
  for all
  to authenticated
  using (false)
  with check (false);
