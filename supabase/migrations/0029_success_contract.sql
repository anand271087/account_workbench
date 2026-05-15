-- M19 — Success Contract on accounts.
--
-- The CSM commitment to the client. Three locks must all be present for
-- the contract to be locked:
--   1. Primary success metric (+ unit) [+ optional secondary]
--   2. Measurement method (source / frequency / owner)
--   3. Value narrative (≥10 chars)
--
-- Stored as a single jsonb so we can iterate the shape (per-category
-- extras, language variants) without DDL churn. Three scalar columns
-- track lock state separately so we can query "all locked contracts"
-- and "who locked when" without unpacking jsonb.
--
-- Auto-drafts on first read from sh_successMetrics + sol_valueDefinition
-- + sh_stakeholderSignoff — the CSM lands on a pre-filled contract they
-- can review, refine, and lock rather than a blank form.

alter table accounts
  add column if not exists success_contract        jsonb       not null default '{}'::jsonb,
  add column if not exists success_contract_locked_at timestamptz,
  add column if not exists success_contract_locked_by uuid;

-- Either both lock fields set, or both null — same belt-and-braces
-- pattern as the gate/cs-goal soft-delete CHECKs.
alter table accounts
  drop constraint if exists chk_accounts_sc_lock_consistent;

alter table accounts
  add constraint chk_accounts_sc_lock_consistent
  check (
    (success_contract_locked_at is null and success_contract_locked_by is null)
    or
    (success_contract_locked_at is not null and success_contract_locked_by is not null)
  );

alter table accounts
  drop constraint if exists chk_accounts_sc_object;

alter table accounts
  add constraint chk_accounts_sc_object
  check (jsonb_typeof(success_contract) = 'object');
