-- M6.5 — AK03.b realign to BRD table 12.
--
-- BRD requires:
--   - role/function       : Procurement | Supply Chain | Finance | Operations | IT | Other
--   - seniority           : CXO | VP | Director | Manager | Other
--   - decision_power      : Executive Sponsor | Influencer | Champion | Detractor | Unknown
--   - notes (≤ 500 chars)
--   - email unique per account
--
-- We add new ENUMs + columns alongside the legacy ones, backfill, then drop
-- the legacy. SPOC + Sponsor flags are kept; they're orthogonal to decision_power
-- (a person can be a SPOC without being the Executive Sponsor).
--
-- Idempotent: re-running this migration is a no-op.

-- 1) Create new ENUMs.
do $$ begin
  create type contact_function as enum (
    'procurement', 'supply_chain', 'finance', 'operations', 'it', 'other'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type contact_seniority as enum ('cxo', 'vp', 'director', 'manager', 'other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type contact_decision_power as enum (
    'executive_sponsor', 'influencer', 'champion', 'detractor', 'unknown'
  );
exception when duplicate_object then null; end $$;

-- 2) Add new columns (nullable initially so we can backfill).
alter table client_contacts
  add column if not exists function contact_function,
  add column if not exists seniority contact_seniority,
  add column if not exists decision_power contact_decision_power,
  add column if not exists notes text;

-- 3) Backfill from legacy columns when present.
update client_contacts
   set function = case
        when role::text = 'finance' then 'finance'::contact_function
        when role::text = 'it'      then 'it'::contact_function
        else 'procurement'::contact_function
       end
 where function is null;

update client_contacts
   set seniority = case
        when title ilike '%cxo%' or title ilike '%cpo%' or title ilike '%cfo%' or title ilike '%cio%' then 'cxo'::contact_seniority
        when title ilike '%vp%' or title ilike '%vice president%'                                      then 'vp'::contact_seniority
        when title ilike '%director%' or title ilike '%head of%'                                       then 'director'::contact_seniority
        when title ilike '%manager%' or title ilike '%lead%'                                            then 'manager'::contact_seniority
        else 'other'::contact_seniority
       end
 where seniority is null;

update client_contacts
   set decision_power = case
        when is_sponsor                                            then 'executive_sponsor'::contact_decision_power
        when role::text = 'decision_maker' and influence::text = 'high' then 'champion'::contact_decision_power
        when role::text = 'decision_maker'                          then 'executive_sponsor'::contact_decision_power
        when role::text = 'influencer'                              then 'influencer'::contact_decision_power
        else 'unknown'::contact_decision_power
       end
 where decision_power is null;

-- 4) Per-account email uniqueness (BRD AC).
create unique index if not exists ux_client_contacts_account_email
  on client_contacts (account_id, lower(email))
  where email is not null and deleted_at is null;

-- 5) Tighten name length (≥ 3 chars) — BRD requires it; reject empties at the DB.
do $$ begin
  alter table client_contacts
    add constraint client_contacts_name_min_length check (char_length(trim(name)) >= 3);
exception when duplicate_object then null; end $$;

-- 6) Notes ≤ 500 chars.
do $$ begin
  alter table client_contacts
    add constraint client_contacts_notes_max_length check (notes is null or char_length(notes) <= 500);
exception when duplicate_object then null; end $$;

-- 7) Drop legacy columns. Keeping `is_spoc` + `is_sponsor` flags — they remain
--    useful for the "SPOC pinned to top" UX even though Executive Sponsor now
--    lives in decision_power.
alter table client_contacts
  drop column if exists role,
  drop column if exists influence;

-- 8) Drop legacy ENUMs once no column references them.
do $$ begin
  drop type if exists contact_role;
exception when others then null; end $$;

do $$ begin
  drop type if exists influence_level;
exception when others then null; end $$;
