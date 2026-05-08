-- M9 — extend public.users with invite/status metadata.
--
-- status:
--   pending      → admin invited, user hasn't logged in yet
--   active       → user has logged in at least once
--   deactivated  → soft-deleted (mirrors deleted_at; kept as enum for queries)
--
-- invited_at / invited_by → audit who onboarded whom (BRD §5).

do $$ begin
  create type user_status as enum ('pending', 'active', 'deactivated');
exception when duplicate_object then null; end $$;

alter table users
  add column if not exists status user_status not null default 'active',
  add column if not exists invited_at timestamptz,
  add column if not exists invited_by uuid references users(id) on delete set null;

-- Existing seeded users are already-active; new invites land as 'pending'.
update users set status = 'active' where status is null and deleted_at is null;
