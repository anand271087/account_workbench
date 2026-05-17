-- M23 — Delivery & Renewal on accounts.
--
-- Post-delivery dual-track view + 3-question Renewal Readiness +
-- final outcome (renewed / at_risk / not_renewed).
--
-- Single jsonb keeps the shape elastic — expand-pipeline columns and
-- red-flag types may evolve. Outcome stamp pair tracks "this is the
-- final call" + immutability (admin-only re-open mirrors M13/M19/M22
-- unlock asymmetry).
--
-- Track 1 (Renewal) cadence is derived from existing M21 checkpoints —
-- no duplication.
--
-- Outcome enum kept narrow now; can widen later without DDL since the
-- column is text-with-CHECK rather than a native enum.

alter table accounts
  add column if not exists delivery_renewal           jsonb       not null default '{}'::jsonb,
  add column if not exists dr_outcome                 text,
  add column if not exists dr_outcome_set_at          timestamptz,
  add column if not exists dr_outcome_set_by          uuid;

alter table accounts
  drop constraint if exists chk_accounts_dr_object;
alter table accounts
  add constraint chk_accounts_dr_object
  check (jsonb_typeof(delivery_renewal) = 'object');

alter table accounts
  drop constraint if exists chk_accounts_dr_outcome;
alter table accounts
  add constraint chk_accounts_dr_outcome
  check (
    dr_outcome is null
    or dr_outcome in ('renewed', 'at_risk', 'not_renewed', 'undecided')
  );

alter table accounts
  drop constraint if exists chk_accounts_dr_outcome_stamp_consistent;
alter table accounts
  add constraint chk_accounts_dr_outcome_stamp_consistent
  check (
    (dr_outcome is null and dr_outcome_set_at is null and dr_outcome_set_by is null)
    or
    (dr_outcome is not null and dr_outcome_set_at is not null and dr_outcome_set_by is not null)
  );
