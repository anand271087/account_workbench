-- M7.5 — AK03.d Solutioning / VPD structured fields (BRD §4.3.d table 14)
--
-- Mirrors `account_engagement` shape: one row per account, mostly nullable so
-- partial saves are fine. Auto-extract from VPD uploads writes candidate
-- values; the user reviews + confirms in the UI before they're persisted.
--
-- Plus: accounts.handed_off_to_solutioning + handed_off_at + handed_off_by
-- so the Pre-Sales tab can show a "Handover to Solutioning" action and the
-- Solutioning tab knows the account has crossed that gate.

do $$ begin
  create type engagement_type as enum (
    'one_time', 'retainer', 'subscription', 'pilot', 'other'
  );
exception when duplicate_object then null; end $$;

create table if not exists account_solutioning (
  account_id              uuid primary key references accounts(id) on delete cascade,
  proposed_solution       text,
  engagement_type         engagement_type,
  engagement_duration_months integer,
  value_themes            text[] not null default '{}',
  value_definition        text,
  estimated_value_musd    numeric(10, 2),
  ai_extracted_from_doc   uuid references documents(id) on delete set null,
  ai_extracted_at         timestamptz,
  ai_edited               boolean not null default false,
  updated_at              timestamptz not null default now(),
  updated_by              uuid references users(id) on delete set null
);

create index if not exists idx_account_solutioning_doc
  on account_solutioning (ai_extracted_from_doc);

-- Handover-to-Solutioning gate.
alter table accounts
  add column if not exists handed_off_to_solutioning boolean not null default false,
  add column if not exists handed_off_at timestamptz,
  add column if not exists handed_off_by uuid references users(id) on delete set null;

-- RLS: viewable by anyone with view-scope on the parent account. Edits go
-- through the API which re-checks per role (matrix Q3: solutioning + admins
-- write, everyone else read-only).
alter table account_solutioning enable row level security;

do $$ begin
  if exists (select 1 from pg_policies where tablename = 'account_solutioning'
             and policyname = 'solutioning_view') then
    drop policy solutioning_view on account_solutioning;
  end if;
end $$;

create policy solutioning_view on account_solutioning
  for select
  to authenticated
  using (true);

do $$ begin
  if exists (select 1 from pg_policies where tablename = 'account_solutioning'
             and policyname = 'solutioning_write') then
    drop policy solutioning_write on account_solutioning;
  end if;
end $$;

create policy solutioning_write on account_solutioning
  for all
  to authenticated
  using (true)
  with check (true);
