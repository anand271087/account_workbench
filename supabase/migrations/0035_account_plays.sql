-- M26 — Growth & Pipeline · Account Plan (sub-tab 1 of 3).
--
-- Mirrors the prototype's `a.plan.plays` shape: an unbounded list of
-- "plays" (opportunities) per account, each tagged with one or more
-- modes (rescue/retain/expand). Backed by a table rather than jsonb
-- so we can query across accounts later (e.g. portfolio pipeline).
--
-- Sales-stage probabilities (0–100) drive colour + sort. The
-- 10-step ladder (Accelerated Trials … Closed) lives in the
-- frontend SALES_STAGES const for now — keeps the schema simple.
--
-- `plan_current_mode` on accounts holds the user override for the
-- recommended mode (calculated server-side from health × signals ×
-- renewal × ARR). Null means "auto" — use the recommendation.

create table if not exists account_plays (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references accounts(id) on delete cascade,
  title         text not null,
  value_usd     numeric(14, 2) not null default 0,
  prob          int  not null default 0,    -- 0..100 sales probability
  when_text     text,                       -- e.g. "Q3 2026", "Immediate"
  trigger_text  text,                       -- one-line why
  modes         text[] not null default '{}',  -- rescue|retain|expand subset
  role          text,                       -- role accountable (e.g. CSM, AE)
  added_by      uuid references users(id),
  hidden        bool not null default false, -- soft-delete equivalent
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists ix_account_plays_account
  on account_plays (account_id) where hidden = false;

alter table account_plays
  drop constraint if exists chk_plays_prob_range;
alter table account_plays
  add constraint chk_plays_prob_range check (prob between 0 and 100);

alter table account_plays
  drop constraint if exists chk_plays_modes_subset;
alter table account_plays
  add constraint chk_plays_modes_subset check (
    modes <@ array['rescue', 'retain', 'expand']::text[]
  );

alter table accounts
  add column if not exists plan_current_mode text;

alter table accounts
  drop constraint if exists chk_accounts_plan_mode;
alter table accounts
  add constraint chk_accounts_plan_mode check (
    plan_current_mode is null
    or plan_current_mode in ('rescue', 'retain', 'expand')
  );
