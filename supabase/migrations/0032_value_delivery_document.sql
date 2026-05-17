-- M22 — Value Delivery Document on accounts.
--
-- The renewal-conversation source of truth. Four sections:
--   1. Client strategic priorities  (free-form list of pillars)
--   2. Agreed success metrics       (snapshot/ref of success_metrics)
--   3. Beroe's approach per initiative
--        — links cs_goals.initiatives + the 3-lever savings model
--          (cost / risk / adoption)
--   4. Value delivered  (CSM-attributed $identified / $committed /
--                        $implemented per initiative — the renewal rollup)
--
-- Single jsonb so shape can evolve without DDL churn. Lock pair tracks
-- "VDD signed by the client" state (sales-handoff style asymmetry: any
-- write set can lock; only admin can unlock — keeps every revision under
-- a director-grade trail).
--
-- Auto-drafts on first read from success_contract + success_metrics +
-- cs_goals.initiatives so the CSM lands on a populated document.

alter table accounts
  add column if not exists value_delivery_document      jsonb       not null default '{}'::jsonb,
  add column if not exists vdd_locked_at                timestamptz,
  add column if not exists vdd_locked_by                uuid;

alter table accounts
  drop constraint if exists chk_accounts_vdd_lock_consistent;

alter table accounts
  add constraint chk_accounts_vdd_lock_consistent
  check (
    (vdd_locked_at is null and vdd_locked_by is null)
    or
    (vdd_locked_at is not null and vdd_locked_by is not null)
  );

alter table accounts
  drop constraint if exists chk_accounts_vdd_object;

alter table accounts
  add constraint chk_accounts_vdd_object
  check (jsonb_typeof(value_delivery_document) = 'object');
