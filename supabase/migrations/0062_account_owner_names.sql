-- 03-Jun bug — Add Account modal: Commercial Owner + CSM Owner dropdowns
-- list specific Beroe staff names (Aditya Pherwani, Sethuraman K, …).
-- Those names don't necessarily exist as users yet, so we capture the
-- visible name as plain text on the account row. The existing
-- co_user_id / csm_user_id FKs continue to drive RBAC; the new columns
-- are display-only metadata until the named staff are properly invited.

alter table public.accounts
  add column if not exists commercial_owner_name text,
  add column if not exists csm_owner_name text;
