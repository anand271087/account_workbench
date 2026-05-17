-- M27 — Growth & Pipeline · Signals & Activity.
--
-- Two related but distinct collections per account:
--
--   soft_signals       Early indicators of risk / opportunity. Drive
--                      the Signal Mix component of the Appetite Score
--                      (M26). Active / resolved status; resolution
--                      requires a note for the audit trail.
--   account_activities Per-account activity feed (CSM calls, exec
--                      visits, MoM imports, etc.). Optional link to
--                      success_metrics via linked_metrics[] for
--                      value-tracing.
--
-- Both are first-class tables (not jsonb) so they're queryable across
-- accounts later (e.g. portfolio risk view).

-- Signal type / impact / status — mirror prototype's SIG vocab.
do $$ begin
  create type signal_type as enum (
    'risk', 'positive', 'expansion', 'neutral', 'critical'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type signal_impact as enum ('critical', 'high', 'medium', 'low');
exception when duplicate_object then null; end $$;

do $$ begin
  create type signal_status as enum ('active', 'resolved');
exception when duplicate_object then null; end $$;

do $$ begin
  create type activity_type as enum (
    'csm_call', 'exec_visit', 'product', 'research',
    'qbr', 'internal', 'escalation'
  );
exception when duplicate_object then null; end $$;


create table if not exists soft_signals (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references accounts(id) on delete cascade,
  type            signal_type not null,
  category        text,
  signal          text not null,
  description     text,
  impact          signal_impact not null default 'medium',
  status          signal_status not null default 'active',
  resolved_at     timestamptz,
  resolved_by     uuid references users(id),
  resolved_note   text,
  valid_until     date,
  source          text,
  ai_extracted    bool not null default false,
  added_by        uuid references users(id),
  hidden          bool not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists ix_soft_signals_account
  on soft_signals (account_id) where hidden = false;

-- Resolving requires a note + resolved_at + resolved_by; flip back to
-- active and they must all be null.
alter table soft_signals
  drop constraint if exists chk_soft_signals_resolution_consistent;
alter table soft_signals
  add constraint chk_soft_signals_resolution_consistent check (
    (status = 'active'
       and resolved_at is null
       and resolved_by is null
       and resolved_note is null)
    or
    (status = 'resolved'
       and resolved_at is not null
       and resolved_by is not null
       and resolved_note is not null
       and length(trim(resolved_note)) >= 5)
  );


create table if not exists account_activities (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references accounts(id) on delete cascade,
  type            activity_type not null,
  title           text not null,
  summary         text,
  items           text,                       -- bullet list of items
  attendees       text,
  linked_metrics  uuid[] not null default '{}',
  file_name       text,
  added_by        uuid references users(id),
  hidden          bool not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists ix_account_activities_account
  on account_activities (account_id) where hidden = false;
