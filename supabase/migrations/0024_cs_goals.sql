-- M14b — CS Goal Validation & Alignment (Phase 5b)
--
-- One row per goal. Phases + initiatives + history live as jsonb on the
-- same row — matches the prototype's flat data shape and keeps each goal
-- a single source of truth. We can normalize into proper tables later if
-- we need queries like "all 'committed' initiatives across accounts."
--
-- Why a separate history column vs reusing audit_log:
--   * audit_log captures field-level DB writes (one row per column change)
--   * cs_goals.history captures business-level events (phase completion,
--     initiative stage change, soft-delete with reason). The granularity
--     is different — phase completion isn't a single field change.
-- Both coexist: audit_log fires on every write via the SQLAlchemy event
-- listener; goal.history is appended by the route handler.

do $$ begin
  create type cs_goal_category as enum (
    'cost_savings',
    'base_rationalization',
    'risk_mitigation',
    'adoption',
    'other'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type cs_goal_alignment as enum ('not_started', 'partial', 'aligned');
exception when duplicate_object then null; end $$;

create table if not exists cs_goals (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references accounts(id) on delete cascade,

  title             text not null,
  category          cs_goal_category not null default 'other',
  target_value      text,                       -- free-text: "$1M", "40 → 25", "80% MAU"
  target_date       date,
  owner             text,
  alignment_status  cs_goal_alignment not null default 'not_started',

  -- Three discovery phases. Each is an open object — Pydantic enforces
  -- the per-category shape on the way in.
  phase_a           jsonb not null default '{}',
  phase_b           jsonb not null default '{}',
  phase_c           jsonb not null default '{}',

  -- List of initiative objects (name, valueStage, valueFields, etc.).
  -- Shape varies by goal category; Pydantic does the per-category validation.
  initiatives       jsonb not null default '[]',

  -- Business-level audit trail. Each entry: {date, changed_by, action,
  -- previous_value, new_value, reason}.
  history           jsonb not null default '[]',

  -- Soft delete. We never hard-delete goals so the audit trail survives.
  deleted_at        timestamptz,
  deleted_reason    text,
  deleted_by        uuid references users(id) on delete set null,

  created_at        timestamptz not null default now(),
  created_by        uuid references users(id) on delete set null,
  updated_at        timestamptz not null default now(),
  updated_by        uuid references users(id) on delete set null
);

-- Hot path: list goals for an account. Partial index for the active set;
-- a second full index lets admin views fetch deleted ones too.
create index if not exists idx_cs_goals_account_active
  on cs_goals (account_id) where deleted_at is null;

create index if not exists idx_cs_goals_account_all
  on cs_goals (account_id);

-- Sanity: phases are objects; initiatives + history are arrays.
do $$ begin
  alter table cs_goals
    add constraint chk_cs_goals_phases_objects
    check (
      jsonb_typeof(phase_a) = 'object'
      and jsonb_typeof(phase_b) = 'object'
      and jsonb_typeof(phase_c) = 'object'
    );
exception when duplicate_object then null; end $$;

do $$ begin
  alter table cs_goals
    add constraint chk_cs_goals_arrays
    check (
      jsonb_typeof(initiatives) = 'array'
      and jsonb_typeof(history) = 'array'
    );
exception when duplicate_object then null; end $$;

-- Soft delete must have a reason captured — defense in depth alongside
-- the API requiring it. Either both null (active) or both set (deleted).
do $$ begin
  alter table cs_goals
    add constraint chk_cs_goals_delete_has_reason
    check (
      (deleted_at is null and deleted_reason is null and deleted_by is null)
      or (deleted_at is not null and deleted_reason is not null)
    );
exception when duplicate_object then null; end $$;

alter table cs_goals enable row level security;

do $$ begin
  if exists (
    select 1 from pg_policies
    where tablename = 'cs_goals' and policyname = 'cs_goals_view'
  ) then
    drop policy cs_goals_view on cs_goals;
  end if;
end $$;

create policy cs_goals_view on cs_goals
  for select to authenticated using (true);

do $$ begin
  if exists (
    select 1 from pg_policies
    where tablename = 'cs_goals' and policyname = 'cs_goals_write'
  ) then
    drop policy cs_goals_write on cs_goals;
  end if;
end $$;

create policy cs_goals_write on cs_goals
  for all to authenticated using (true) with check (true);
