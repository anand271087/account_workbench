-- 03-Jun bug — Contacts form additions:
--   * Salutation dropdown before Name (Mr./Mrs./Ms./Miss/Dr./Prof./Mx./
--     Sir/Madam/Rev./Prefer not to say).
--   * Function list expanded from 6 enum values to the prototype's
--     12-item set. Strategy: drop the enum, switch to text+CHECK so
--     future tweaks don't require ALTER TYPE.

-- ============================================================
-- 1) Salutation
-- ============================================================
alter table public.client_contacts
  add column if not exists salutation text;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'chk_client_contacts_salutation'
  ) then
    alter table public.client_contacts
      add constraint chk_client_contacts_salutation
      check (
        salutation is null
        or salutation in (
          'Mr.', 'Mrs.', 'Ms.', 'Miss', 'Dr.', 'Prof.', 'Mx.',
          'Sir', 'Madam', 'Rev.', 'Prefer not to say'
        )
      );
  end if;
end $$;

-- ============================================================
-- 2) Function — drop enum, switch to text + CHECK
-- ============================================================
alter table public.client_contacts
  alter column function drop default;

alter table public.client_contacts
  alter column function type text using function::text;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'chk_client_contacts_function'
  ) then
    alter table public.client_contacts
      add constraint chk_client_contacts_function
      check (
        function is null
        or function in (
          -- legacy values preserved for back-compat
          'procurement', 'supply_chain', 'finance', 'operations', 'it', 'other',
          -- 03-Jun prototype additions
          'executive_leadership',
          'research_development',
          'manufacturing',
          'legal',
          'marketing',
          'sales'
        )
      );
  end if;
end $$;

-- Drop the unused enum type if nothing else references it.
do $$ begin
  if exists (select 1 from pg_type where typname = 'contact_function') then
    if not exists (
      select 1
      from pg_attribute a join pg_type t on a.atttypid = t.oid
      where t.typname = 'contact_function'
    ) then
      drop type contact_function;
    end if;
  end if;
end $$;
