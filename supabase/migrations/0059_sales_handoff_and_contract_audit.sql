-- 04-Jun — Sales Handoff prototype port.
--
-- Two-lock model:
--   Stage 1 (Sales Handoff) → Stage 2 (Contract Audit)
--     accounts.sh_locked_at / sh_locked_by  (NEW — this migration)
--   Stage 2 (Contract Audit) → Stage 3 (Handed off to CS)
--     accounts.gate_signed = true (EXISTING — set via /sign endpoint)
--
-- Per-module configurations land in accounts.gate_module_configs jsonb
-- with the prototype's open shape (key = module name, value = dict).
-- Contract Ops also captures a small bag of audit-only extras (billing
-- freq, payment terms, discount, geography, other terms) in a second
-- jsonb to avoid 10 new columns; documents get a typed subtype.

-- ============================================================
-- 1) Sales Handoff stage-1 lock
-- ============================================================
alter table public.accounts
  add column if not exists sh_locked_at  timestamptz,
  add column if not exists sh_locked_by  uuid references users(id) on delete set null;

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'chk_accounts_sh_lock_consistent'
  ) then
    alter table public.accounts
      add constraint chk_accounts_sh_lock_consistent
      check (
        (sh_locked_at is null and sh_locked_by is null)
        or (sh_locked_at is not null and sh_locked_by is not null)
      );
  end if;
end $$;

-- ============================================================
-- 2) Per-module contract configurations
-- ============================================================
alter table public.accounts
  add column if not exists gate_module_configs jsonb not null default '{}'::jsonb;

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'chk_accounts_gate_module_configs_is_object'
  ) then
    alter table public.accounts
      add constraint chk_accounts_gate_module_configs_is_object
      check (jsonb_typeof(gate_module_configs) = 'object');
  end if;
end $$;

-- ============================================================
-- 3) Contract Audit extras (billing / payment / discount /
--    geography / module caveats / audit notes / other terms /
--    TCV override / audited_by name / audited_at)
-- ============================================================
alter table public.accounts
  add column if not exists gate_contract_extras jsonb not null default '{}'::jsonb;

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'chk_accounts_gate_contract_extras_is_object'
  ) then
    alter table public.accounts
      add constraint chk_accounts_gate_contract_extras_is_object
      check (jsonb_typeof(gate_contract_extras) = 'object');
  end if;
end $$;

-- ============================================================
-- 4) Document subtype — Signed Proposal / MSA / SOW etc.
--    The prototype lets Sales tag every contract doc with one of
--    9 subtypes so the audit table can filter/sort by type.
-- ============================================================
alter table public.documents
  add column if not exists contract_subtype text;

-- Bound the set to the prototype's nine canonical types + null.
do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'chk_documents_contract_subtype'
  ) then
    alter table public.documents
      add constraint chk_documents_contract_subtype
      check (
        contract_subtype is null
        or contract_subtype in (
          'Signed Proposal', 'Unsigned Proposal', 'Work Order',
          'MSA', 'Purchase Order', 'Invoice', 'SOW',
          'Amendment', 'NDA'
        )
      );
  end if;
end $$;
