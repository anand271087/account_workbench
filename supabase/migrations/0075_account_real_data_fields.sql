-- 0075_account_real_data_fields.sql
--
-- Real-data ingestion (5-account onboarding spreadsheet).
--
-- Adds 13 scalar columns to `accounts` for the fields surfaced by the
-- "Data for 5 Accounts with Priorities" XLSX, and creates a relational
-- `account_products` table for the 27 yes/no product flags. The roster
-- table drives:
--   * Growth & Pipeline → "Product Roster" card
--   * Business Review modal → auto-deselect un-owned products
--   * Analytics tab → gate sub-tabs to owned products
--
-- Drops the legacy `headquarters` column — per stakeholder decision,
-- Billing Country (`accounts.country`) is the single home for that.

-- 1. Drop legacy headquarters column.
alter table accounts drop column if exists headquarters;

-- 2. Add 13 new scalar columns on accounts.
alter table accounts
  add column if not exists client_priority      text,
  add column if not exists platform_status      text,
  add column if not exists subscription_plan    text,
  add column if not exists category_count       integer,
  add column if not exists supplier_count       integer,
  add column if not exists sector               text,
  add column if not exists revenue_bucket       text,
  add column if not exists renewal_risk         text,
  add column if not exists is_fortune_500       boolean not null default false,
  add column if not exists is_focus_region      boolean not null default false,
  add column if not exists is_focus_industry    boolean not null default false,
  add column if not exists procurement_maturity text,
  add column if not exists genai_adoption       text;

-- CHECK constraints — text-with-enum-feel, additive so unseeded rows
-- stay null without violating.
do $$ begin
  alter table accounts
    add constraint chk_accounts_platform_status
      check (platform_status is null or platform_status in ('Active', 'Inactive'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table accounts
    add constraint chk_accounts_renewal_risk
      check (renewal_risk is null or renewal_risk in ('Low', 'Medium', 'High'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table accounts
    add constraint chk_accounts_procurement_maturity
      check (procurement_maturity is null or procurement_maturity in ('Low', 'Medium', 'High'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table accounts
    add constraint chk_accounts_genai_adoption
      check (genai_adoption is null or genai_adoption in ('Low', 'Medium', 'High'));
exception when duplicate_object then null; end $$;

-- 3. account_products — yes/no roster per account per Beroe product.
create table if not exists account_products (
  account_id  uuid    not null references accounts(id) on delete cascade,
  product_key text    not null,
  purchased   boolean,    -- nullable: true=Yes, false=No, null=unknown/blank in source
  source      text not null default 'import',  -- 'import' | 'manual' | 'api'
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.users(id),
  primary key (account_id, product_key)
);

create index if not exists ix_account_products_purchased
  on account_products (product_key, purchased)
  where purchased is true;

-- RLS — mirror the rest of the schema. Inherits the same view scope
-- as the parent account.
alter table account_products enable row level security;

drop policy if exists account_products_select on account_products;
create policy account_products_select on account_products
  for select using (
    exists (
      select 1 from accounts a where a.id = account_id
        and (
          current_user_role() in (
            'admin','cs_director','vp_csm','vp_sales','vp_inside_sales',
            'cs_team_manager','solutioning_manager'
          )
          or user_assigned_to_account(account_id)
        )
    )
  );

drop policy if exists account_products_write on account_products;
create policy account_products_write on account_products
  for all using (
    current_user_role() in ('admin','cs_director','vp_csm')
  ) with check (
    current_user_role() in ('admin','cs_director','vp_csm')
  );
