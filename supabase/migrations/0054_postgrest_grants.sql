-- ============================================================
-- 0054_postgrest_grants.sql — defensive grants for Supabase Data API.
-- ============================================================
--
-- Context (May 2026):
--   Supabase announced that from 30 May 2026, NEW projects no longer
--   expose `public` tables via the Data API (PostgREST / GraphQL) by
--   default. From 30 Oct 2026 the same applies to NEW tables in
--   EXISTING projects. Existing tables keep their current grants.
--
-- This project does NOT use the Data API today:
--   • Frontend supabase-js client is initialised for AUTH only (no
--     `.from()` / `.rpc()` / `.storage` calls against business
--     tables).
--   • Backend (FastAPI + asyncpg) hits Postgres directly via the
--     pooler — DATABASE_URL on port 5432 (session) or 6543 (tx-mode).
--   • Storage operations use service-role signed URLs minted by the
--     API.
--
-- So nothing is broken today. This migration is DEFENSIVE — it makes
-- the project bulletproof against the Oct 30 cliff IF the architecture
-- ever flips to direct REST/GraphQL access. The cost is zero (these
-- grants are no-ops while no Data API consumer exists).
--
-- Behaviour:
--   • anon            : SELECT on every `lookup_*` table only.
--                       Business tables stay closed to anonymous reads.
--   • authenticated   : SELECT/INSERT/UPDATE/DELETE on every public
--                       table. RLS policies (migrations 0002, 0005, and
--                       per-table RLS in 0010+) already gate row-level
--                       access per signed-in user — these grants just
--                       open the door for PostgREST.
--   • service_role    : ALL on every public table (RLS-bypassing).
--   • Sequences       : USAGE+SELECT to authenticated + service_role
--                       so INSERTs with serial/identity defaults work.
--   • Default privileges: subsequent CREATE TABLE statements in the
--                         public schema automatically inherit these
--                         grants, so we don't have to remember to
--                         repeat them per-migration.
--
-- Migration is idempotent: granting an existing privilege is a no-op.
-- ============================================================

-- ============================================================
-- IMPORTANT — pre-existing anon over-permissioning.
--
-- Inspecting the live DB before applying this migration showed every
-- public table had anon: DELETE,INSERT,REFERENCES,SELECT,TRIGGER,
-- TRUNCATE,UPDATE. That comes from Supabase's pre-30-May-2026 default
-- behaviour of granting broad privileges on table creation. RLS
-- policies on every business table keep rows safe today, but defence-
-- in-depth says: anon should not have DML on accounts/users/etc.
--
-- This DO block tightens anon down to read-only on lookup_* tables
-- only. authenticated + service_role get the same explicit grants as
-- before. Idempotent — running again is safe (REVOKE on already-
-- revoked privileges is a no-op).
-- ============================================================

do $$
declare
  t record;
begin
  for t in
    select tablename
    from pg_tables
    where schemaname = 'public'
  loop
    if t.tablename like 'lookup\_%' escape '\' then
      -- Lookups: anon gets READ-ONLY (lock everything else down).
      execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from anon', t.tablename);
      execute format('grant select on public.%I to anon', t.tablename);
    else
      -- Business tables: revoke ALL anon privileges. RLS is still
      -- the row-level guard, but anon shouldn't even be able to
      -- attempt a DELETE/UPDATE via the Data API.
      execute format('revoke all on public.%I from anon', t.tablename);
    end if;

    -- authenticated: full DML. RLS policies (migrations 0002, 0005,
    -- and per-table RLS in 0010+) gate row-level access per signed-in
    -- user — these grants just open the door for PostgREST.
    execute format(
      'grant select, insert, update, delete on public.%I to authenticated',
      t.tablename
    );

    -- service_role: full access. Used by FastAPI when invalidating
    -- cache, by the SQLAlchemy before_flush listener, by Celery
    -- workers, etc.
    execute format('grant all on public.%I to service_role', t.tablename);
  end loop;
end $$;

-- Sequences — needed for serial/identity defaults on INSERT.
grant usage, select on all sequences in schema public to authenticated;
grant usage, select on all sequences in schema public to service_role;

-- Functions — RPC endpoints if PostgREST ever needs to call helpers.
-- Only granting EXECUTE on existing functions; new functions added by
-- later migrations should specify their own grant if they want REST
-- exposure.
grant execute on all functions in schema public to authenticated;
grant execute on all functions in schema public to service_role;

-- ============================================================
-- Default privileges — every NEW table / sequence / function created
-- in the public schema after this migration inherits the same grants
-- automatically, so subsequent migrations don't need explicit GRANT
-- statements. This is the key clause that future-proofs us against
-- the Supabase Oct 30 change.
-- ============================================================

alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;

alter default privileges in schema public
  grant all on tables to service_role;

alter default privileges in schema public
  grant usage, select on sequences to authenticated;

alter default privileges in schema public
  grant usage, select on sequences to service_role;

alter default privileges in schema public
  grant execute on functions to authenticated;

alter default privileges in schema public
  grant execute on functions to service_role;
