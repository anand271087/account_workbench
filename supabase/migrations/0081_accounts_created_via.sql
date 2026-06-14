-- 14-Jun — track how an account was created so CS Onboarding can pick the
-- right default entry type:
--   'manual' → created via the Create Account modal  → CS Entry A
--   'import' → created via the bulk XLSX importer     → CS Entry B
-- Existing rows default to 'manual' (the seeded/manually-created demo
-- accounts); the importer stamps 'import' on rows it inserts.

alter table accounts
  add column if not exists created_via text not null default 'manual';

do $$ begin
  alter table accounts
    add constraint chk_accounts_created_via
    check (created_via in ('manual', 'import'));
exception when duplicate_object then null;
end $$;
