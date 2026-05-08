-- M2 — Initial schema for Sprint 1 (F01, F02, AK01, AK02, AK03)
-- Idempotent. Re-run safely.

-- ============================================================
-- ENUMS
-- ============================================================
do $$ begin
  create type role_key as enum (
    'csm','cs_team_manager','cs_director','vp_csm',
    'commercial_owner','vp_sales',
    'solutioning_manager','vp_solutioning',
    'inside_sales_manager','vp_inside_sales',
    'admin'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type contact_role as enum (
    'decision_maker','influencer','end_user','finance','it'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type influence_level as enum ('high','medium','low');
exception when duplicate_object then null; end $$;

do $$ begin
  create type maturity_level as enum ('low','medium','high');
exception when duplicate_object then null; end $$;

do $$ begin
  create type doc_kind as enum ('mom','vpd','recording','transcript','email','other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type ai_status as enum ('pending','processing','complete','failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type audit_action as enum ('insert','update','delete');
exception when duplicate_object then null; end $$;

-- ============================================================
-- LOOKUPS
-- ============================================================
create table if not exists lookup_geographies (
  id        uuid primary key default gen_random_uuid(),
  name      text unique not null,
  region    text not null
);

create table if not exists lookup_categories (
  id         uuid primary key default gen_random_uuid(),
  name       text unique not null,
  parent_id  uuid references lookup_categories(id) on delete set null,
  approved   boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists lookup_roles (
  role_key    role_key primary key,
  label       text not null,
  description text not null
);

-- ============================================================
-- TEAMS & USERS
-- ============================================================
create table if not exists teams (
  id              uuid primary key default gen_random_uuid(),
  name            text unique not null,
  manager_user_id uuid,           -- FK added after users created
  created_at      timestamptz not null default now()
);

create table if not exists users (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text unique not null,
  full_name   text,
  role        role_key not null,
  team_id     uuid references teams(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index if not exists idx_users_role on users(role) where deleted_at is null;
create index if not exists idx_users_team on users(team_id) where deleted_at is null;

alter table teams
  drop constraint if exists teams_manager_user_id_fkey;
alter table teams
  add constraint teams_manager_user_id_fkey
  foreign key (manager_user_id) references users(id) on delete set null;

-- ============================================================
-- ACCOUNTS
-- ============================================================
create table if not exists accounts (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  slug              text unique not null,
  industry          text,
  region            text,
  country           text,
  csm_user_id       uuid references users(id) on delete set null,
  co_user_id        uuid references users(id) on delete set null,
  category          text,
  tier              text,
  account_type      text,
  segment           text,
  current_acv       numeric(14,2) default 0,
  target_acv        numeric(14,2) default 0,
  contract_start    date,
  contract_end      date,
  renewal_date      date,
  health_score      smallint,                    -- computed in Sprint 6
  last_activity_at  timestamptz,                 -- derived from audit_log
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);
create index if not exists idx_accounts_csm     on accounts(csm_user_id) where deleted_at is null;
create index if not exists idx_accounts_co      on accounts(co_user_id)  where deleted_at is null;
create index if not exists idx_accounts_renewal on accounts(renewal_date) where deleted_at is null;

create table if not exists account_assignments (
  account_id      uuid not null references accounts(id) on delete cascade,
  user_id         uuid not null references users(id) on delete cascade,
  role_on_account text not null,                 -- 'csm' | 'co' | 'collaborator'
  created_at      timestamptz not null default now(),
  primary key (account_id, user_id, role_on_account)
);

-- ============================================================
-- AK03.a — ENGAGEMENT INFO
-- ============================================================
create table if not exists account_engagement (
  account_id              uuid primary key references accounts(id) on delete cascade,
  sdr_lead                text,
  pre_discovery_date      date,
  discovery_lead          text,
  sales_lead              text,
  target_categories       text[] not null default '{}',
  engagement_objective    text,
  procurement_maturity    maturity_level,
  ai_penetration          maturity_level,
  procurement_spend_musd  numeric(12,4),
  geographies             text[] not null default '{}',
  spoc_text               text,
  sponsor_text            text,
  power_users_text        text,
  ai_quality_score        smallint check (ai_quality_score between 1 and 5),
  ai_quality_dismissed    boolean not null default false,
  updated_at              timestamptz not null default now(),
  updated_by              uuid references users(id) on delete set null
);

-- ============================================================
-- AK03.b — CLIENT CONTACTS
-- ============================================================
create table if not exists client_contacts (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references accounts(id) on delete cascade,
  name        text not null,
  title       text,
  email       text,
  phone       text,
  role        contact_role,
  influence   influence_level,
  is_spoc     boolean not null default false,
  is_sponsor  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz                          -- 30-day restore window
);
create index if not exists idx_contacts_account on client_contacts(account_id) where deleted_at is null;

-- ============================================================
-- AK03.c — DOCUMENTS + JOBS
-- ============================================================
create table if not exists jobs (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null,                     -- 'process_document', etc.
  account_id   uuid references accounts(id) on delete cascade,
  document_id  uuid,                              -- FK below after documents created
  status       text not null default 'pending',   -- pending|running|complete|failed
  progress     smallint not null default 0,
  error        text,
  payload      jsonb,
  result       jsonb,
  started_at   timestamptz,
  finished_at  timestamptz,
  created_at   timestamptz not null default now()
);

create table if not exists documents (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references accounts(id) on delete cascade,
  kind               doc_kind not null,
  filename           text not null,
  file_hash          text not null,
  storage_path       text not null,
  mime_type          text,
  size_bytes         bigint,
  meeting_date       date,
  uploaded_by        uuid references users(id) on delete set null,
  uploaded_at        timestamptz not null default now(),
  ai_status          ai_status not null default 'pending',
  ai_summary_text    text,
  extracted_entities jsonb,
  job_id             uuid references jobs(id) on delete set null,
  deleted_at         timestamptz,
  unique (account_id, file_hash)
);
create index if not exists idx_documents_account on documents(account_id) where deleted_at is null;
create index if not exists idx_documents_status  on documents(ai_status)  where deleted_at is null;

alter table jobs
  drop constraint if exists jobs_document_id_fkey;
alter table jobs
  add constraint jobs_document_id_fkey
  foreign key (document_id) references documents(id) on delete cascade;

create table if not exists document_links (
  document_id uuid not null references documents(id) on delete cascade,
  contact_id  uuid not null references client_contacts(id) on delete cascade,
  primary key (document_id, contact_id)
);

create table if not exists account_discovery_summary (
  account_id            uuid primary key references accounts(id) on delete cascade,
  summary_text          text,
  source_document_ids   uuid[] not null default '{}',
  generated_at          timestamptz,
  generated_by_job_id   uuid references jobs(id) on delete set null
);

-- ============================================================
-- AUDIT LOG (append-only)
-- ============================================================
create table if not exists audit_log (
  id                  uuid primary key default gen_random_uuid(),
  table_name          text not null,
  row_id              uuid,
  action              audit_action not null,
  changed_by_user_id  uuid references users(id) on delete set null,
  changed_at          timestamptz not null default now(),
  field_name          text,
  old_value           jsonb,
  new_value           jsonb,
  request_id          text
);
create index if not exists idx_audit_table_row on audit_log(table_name, row_id);
create index if not exists idx_audit_changed_at on audit_log(changed_at desc);

-- ============================================================
-- updated_at trigger helper
-- ============================================================
create or replace function set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end; $$ language plpgsql;

do $$ declare t text;
begin
  for t in select unnest(array['users','accounts','client_contacts','account_engagement']) loop
    execute format('drop trigger if exists trg_%I_updated_at on %I', t, t);
    execute format('create trigger trg_%I_updated_at before update on %I for each row execute procedure set_updated_at()', t, t);
  end loop;
end $$;
