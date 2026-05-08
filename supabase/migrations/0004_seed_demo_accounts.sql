-- M3 — Seed demo accounts (4 from the v20 prototype) + assignments.
-- Idempotent. Re-runnable.

-- Helper: a "service-role" connection bypasses RLS, so this runs cleanly.

with u as (
  select email, id, role from public.users
)
insert into public.accounts (
  id, name, slug, industry, region, country,
  csm_user_id, co_user_id,
  category, tier, account_type, segment,
  current_acv, target_acv,
  contract_start, contract_end, renewal_date,
  health_score, last_activity_at, created_at, updated_at
)
select
  v.id,
  v.name,
  v.slug,
  v.industry,
  v.region,
  v.country,
  (select id from u where email = v.csm_email),
  (select id from u where email = v.co_email),
  v.category,
  v.tier,
  v.account_type,
  v.segment,
  v.current_acv,
  v.target_acv,
  v.contract_start::date,
  v.contract_end::date,
  v.renewal_date::date,
  v.health_score,
  now() - (interval '1 day' * v.last_activity_days_ago),
  now(),
  now()
from (values
  -- name, slug, industry, region, country, csm_email, co_email, category, tier, account_type, segment,
  -- current_acv, target_acv, contract_start, contract_end, renewal_date, health_score, last_activity_days_ago
  ('11111111-1111-1111-1111-111111111111'::uuid,
    'Siemens Energy AG', 'siemens-energy', 'Power & Electrical Equipment', 'Europe', 'Germany',
    'harish@beroe-inc.com', 'santosh@beroe-inc.com',
    'Energy', 'T1', 'Hyper Growth', 'Segment C',
    420000, 630000, '2023-07-01', '2026-06-30', '2026-06-30', 78, 2),
  ('22222222-2222-2222-2222-222222222222'::uuid,
    'Mondelēz International', 'mondelez', 'Food & Beverages', 'North America', 'United States',
    'harish@beroe-inc.com', 'santosh@beroe-inc.com',
    'Consumer Staples', 'T2', 'Standard Growth', 'Segment B',
    310000, 465000, '2024-04-01', '2025-03-31', '2025-03-31', 41, 5),
  ('33333333-3333-3333-3333-333333333333'::uuid,
    'Sanofi S.A.', 'sanofi', 'Pharmaceuticals', 'Europe', 'France',
    'harish@beroe-inc.com', 'santosh@beroe-inc.com',
    'Health Care', 'T2', 'Standard Growth', 'Segment B',
    290000, 435000, '2023-12-01', '2025-11-30', '2025-11-30', 76, 3),
  ('44444444-4444-4444-4444-444444444444'::uuid,
    'Novo Nordisk A/S', 'novonordisk', 'Pharmaceuticals', 'Europe', 'Denmark',
    'harish@beroe-inc.com', 'santosh@beroe-inc.com',
    'Health Care', 'T2', 'New Account', 'Segment A',
    200000, 350000, '2025-03-01', '2026-02-28', '2026-02-28', 56, 1)
) as v(
  id, name, slug, industry, region, country,
  csm_email, co_email,
  category, tier, account_type, segment,
  current_acv, target_acv,
  contract_start, contract_end, renewal_date,
  health_score, last_activity_days_ago
)
on conflict (id) do update set
  name = excluded.name,
  slug = excluded.slug,
  industry = excluded.industry,
  region = excluded.region,
  country = excluded.country,
  csm_user_id = excluded.csm_user_id,
  co_user_id = excluded.co_user_id,
  category = excluded.category,
  tier = excluded.tier,
  account_type = excluded.account_type,
  segment = excluded.segment,
  current_acv = excluded.current_acv,
  target_acv = excluded.target_acv,
  contract_start = excluded.contract_start,
  contract_end = excluded.contract_end,
  renewal_date = excluded.renewal_date,
  health_score = excluded.health_score,
  last_activity_at = excluded.last_activity_at,
  updated_at = now();

-- Assignments — Harish (CSM) + Santosh (VP Sales) on all four accounts
insert into public.account_assignments (account_id, user_id, role_on_account)
select a.id, u.id, 'csm'
from public.accounts a, public.users u
where u.email = 'harish@beroe-inc.com'
on conflict do nothing;

insert into public.account_assignments (account_id, user_id, role_on_account)
select a.id, u.id, 'co'
from public.accounts a, public.users u
where u.email = 'santosh@beroe-inc.com'
on conflict do nothing;
