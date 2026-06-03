-- 2 June bug — Pre-Sales / Procurement Spend needs a currency selector.
-- Add an ISO-4217-style currency text column on account_engagement.
-- Default 'USD' for back-compat with existing seeded rows where
-- procurement_spend_musd is implicitly USD millions.

alter table public.account_engagement
  add column if not exists procurement_spend_currency text;

-- Belt-and-braces: bound the set of allowed codes via CHECK.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'chk_engagement_procurement_spend_currency'
  ) then
    alter table public.account_engagement
      add constraint chk_engagement_procurement_spend_currency
      check (
        procurement_spend_currency is null
        or procurement_spend_currency in (
          'USD','EUR','GBP','INR','JPY','CNY','AUD','CAD','CHF',
          'SGD','AED','SAR','HKD','BRL','MXN','ZAR','SEK','NOK',
          'DKK','NZD','KRW','THB','MYR','IDR','PHP','TRY','RUB'
        )
      );
  end if;
end $$;

-- Backfill any existing rows that already have a spend amount but no
-- currency code to 'USD' (the implicit-prior-behaviour).
update public.account_engagement
   set procurement_spend_currency = 'USD'
 where procurement_spend_musd is not null
   and procurement_spend_currency is null;
