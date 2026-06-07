-- 08-Jun · Per stakeholder: account names must be unique. Today the
-- create flow only uniqueifies the slug (via _unique_slug `-2`, `-3`...),
-- letting two accounts share the same display name. Adds a case-
-- insensitive PARTIAL unique index on the live (non-deleted) rows so:
--
--   1. The DB rejects future duplicates with 23505 even if the
--      preflight check in routes/accounts.py:create_account is
--      bypassed.
--   2. Soft-deleted rows DON'T count — a re-create of the same name
--      after a delete is fine.
--   3. Trimming + lower-casing normalises 'Acme Co.' vs 'acme co.'
--      vs 'Acme Co. ' (trailing whitespace) into one canonical key.
--
-- No back-fill needed: the verification on 2026-06-08 showed zero
-- duplicate groups across 15 live accounts. If a future apply hits
-- duplicates the migration will error — manual triage required
-- (typically: soft-delete the newer row + re-run).

create unique index if not exists ux_accounts_name_live
  on public.accounts (lower(trim(name)))
  where deleted_at is null;

comment on index public.ux_accounts_name_live is
  'Per stakeholder 2026-06-08: account names must be unique among live (non-deleted) rows. Case-insensitive + whitespace-trimmed. Soft-deleted rows excluded so a same-name re-create after delete is allowed.';
