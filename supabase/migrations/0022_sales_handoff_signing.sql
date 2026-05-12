-- M13 — Sales Handoff & Signing
--
-- Adds:
--   1. Signing gate on `accounts` — gate_signed + the contract metadata that
--      gets captured when Sales confirms the deal. Renewal + VDD due dates
--      are derived from signed_date + term in the API; we store them so
--      they're queryable / sortable without a derivation join.
--   2. Sales hand-off context on `account_solutioning` — the sh_* fields
--      that Sales fills in after Solutioning locks the value definition.
--
-- Two reasons for splitting across two tables:
--   - The signing event is account-level state (one row per account,
--     queried in account list, drives banners).
--   - The hand-off context continues from the Solutioning row, which
--     already holds the locked value definition.

-- ============================================================
-- 1. accounts.gate_* — the signing gate
-- ============================================================

alter table accounts
  add column if not exists gate_signed              boolean not null default false,
  add column if not exists gate_signed_date         date,
  add column if not exists gate_contract_acv        numeric(14, 2),
  add column if not exists gate_contract_term       text,             -- free text: "1 year", "2 years", "Custom"
  add column if not exists gate_renewal_date        date,
  add column if not exists gate_bvd_due_date        date,
  add column if not exists gate_confirmed_by        uuid references users(id) on delete set null,
  add column if not exists gate_confirmed_at        timestamptz,
  add column if not exists gate_unlocked            boolean not null default false,
  add column if not exists gate_unlock_reason       text,
  add column if not exists gate_unlocked_by         uuid references users(id) on delete set null,
  add column if not exists gate_unlocked_at         timestamptz,
  add column if not exists gate_contract_doc        text,             -- filename (storage path is derived)
  add column if not exists gate_contract_doc_at     date,
  add column if not exists gate_contract_modules    text[] not null default '{}',
  add column if not exists gate_platform_tier       text,
  add column if not exists gate_account_segment     text,
  add column if not exists gate_subscribers         text,
  -- Handover quality check — 4 boolean overrides keyed by item id.
  -- Stored as jsonb so we can evolve the list without a migration.
  -- Shape: {"savings": true, "stakeholders": true, "categories": true, "success_metric": false}
  add column if not exists handover_quality_check   jsonb not null default '{}';

-- Sanity: signed accounts must have a date.
do $$ begin
  alter table accounts
    add constraint chk_accounts_signed_has_date
    check (gate_signed = false or gate_signed_date is not null);
exception when duplicate_object then null; end $$;

-- Sanity: ACV is non-negative.
do $$ begin
  alter table accounts
    add constraint chk_accounts_gate_acv_nonneg
    check (gate_contract_acv is null or gate_contract_acv >= 0);
exception when duplicate_object then null; end $$;

-- Sanity: handover_quality_check is a JSON object, not an array or scalar.
do $$ begin
  alter table accounts
    add constraint chk_accounts_hqc_object
    check (jsonb_typeof(handover_quality_check) = 'object');
exception when duplicate_object then null; end $$;


-- ============================================================
-- 2. account_solutioning.sh_* — Sales Hand-off context
-- ============================================================

do $$ begin
  create type sh_validation as enum (
    'confirmed', 'partially_confirmed', 'revised'
  );
exception when duplicate_object then null; end $$;

alter table account_solutioning
  -- Value carried over from solutioning lock (set automatically on lock).
  add column if not exists sh_value_from_solutioning        text,
  add column if not exists sh_value_themes_from_solutioning text,
  add column if not exists sh_value_received_at             timestamptz,
  -- Sales fills in once they've reviewed.
  add column if not exists sh_value_validation              sh_validation,
  add column if not exists sh_validation_notes              text,
  -- Engagement timeline.
  add column if not exists sh_go_live_date                  date,
  add column if not exists sh_first_checkpoint              date,
  add column if not exists sh_stakeholder_signoff           text,
  add column if not exists sh_commercial_context            text,
  add column if not exists sales_watchouts                  text,
  add column if not exists handoff_file_name                text;
