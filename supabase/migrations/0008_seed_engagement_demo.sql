-- M5 — seed AK03.a engagement-info for the 4 demo accounts.
-- Idempotent. Cast every string array element to text[] explicitly because
-- some values pass through Postgres's varchar inference.

insert into account_engagement (
  account_id, sdr_lead, pre_discovery_date, discovery_lead, sales_lead,
  target_categories, engagement_objective,
  procurement_maturity, ai_penetration, procurement_spend_musd, geographies,
  spoc_text, sponsor_text, power_users_text,
  ai_quality_score, ai_quality_dismissed,
  updated_at, updated_by
) values
  -- Siemens — strong objective
  (
    (select id from accounts where slug = 'siemens-energy'),
    'Inbound — RFP via partner', date '2023-05-15', 'Megha Aggarwal', 'Santosh Peshkar',
    array['Direct Materials','Indirect Materials','Energy']::text[],
    'Drive 15% reduction in copper and aluminium contract costs across the next 18 months by combining Beroe price intelligence with quarterly should-cost benchmarks. Replace 3 fragmented intelligence vendors (~€800K/year) with a single platform supporting nearshoring of 8 European categories. Success: documented €2.4M cost-out by Q4 2025 and 40 onboarded power users.',
    'high'::maturity_level, 'medium'::maturity_level, 2800.0,
    array['Europe','North America']::text[],
    'Gunter Braun (VP Procurement)', 'Dr. Klaus Richter (CPO)',
    'Priya Menon, Raj Kumar, Ingrid Schmidt',
    null, false,
    now(), (select id from users where email = 'megha@beroe-inc.com')
  ),
  -- Mondelez — short, generic (will trigger AI quality warning)
  (
    (select id from accounts where slug = 'mondelez'),
    'Outbound', null, 'Aditya Pherwani', 'Aditya Pherwani',
    array['Packaging','Direct Materials']::text[],
    'Cost savings on packaging and commodities.',
    'medium'::maturity_level, 'low'::maturity_level, 1500.0,
    array['North America']::text[],
    'Jordan Mills', 'Dave Kowalski', 'Ana Reyes',
    null, false,
    now(), null
  ),
  -- Sanofi — moderate objective
  (
    (select id from accounts where slug = 'sanofi'),
    'Outbound + LinkedIn', date '2023-06-10', 'Alekh Chatterji', 'Alekh Chatterji',
    array['Direct Materials','Logistics']::text[],
    'Provide single procurement intelligence platform with real-time API supplier risk monitoring, on-demand category research, and packaging sustainability data. Replace fragmented vendor landscape across 6 categories. Reduce supplier-risk response time from 2 weeks to 3 days.',
    'high'::maturity_level, 'medium'::maturity_level, 4200.0,
    array['Europe']::text[],
    'Marc Leblanc', 'Céline Dupont (VP Global Procurement)',
    'Pierre Moreau, Sophie Bernard, Isabelle Roux',
    null, false,
    now(), (select id from users where email = 'megha@beroe-inc.com')
  ),
  -- Novo Nordisk — fresh, blank-ish
  (
    (select id from accounts where slug = 'novonordisk'),
    'Inbound — GLP-1 report', date '2025-02-20', 'Anurag Bhagat', 'Dinesh Gokhale',
    array['Direct Materials']::text[],
    null,
    'medium'::maturity_level, 'low'::maturity_level, null,
    array['Europe']::text[],
    'Lars Andersen', 'Mette Hansen (CPO)', 'Frederik Jensen, Astrid Nielsen',
    null, false,
    now(), null
  )
on conflict (account_id) do update set
  sdr_lead = excluded.sdr_lead,
  pre_discovery_date = excluded.pre_discovery_date,
  discovery_lead = excluded.discovery_lead,
  sales_lead = excluded.sales_lead,
  target_categories = excluded.target_categories,
  engagement_objective = excluded.engagement_objective,
  procurement_maturity = excluded.procurement_maturity,
  ai_penetration = excluded.ai_penetration,
  procurement_spend_musd = excluded.procurement_spend_musd,
  geographies = excluded.geographies,
  spoc_text = excluded.spoc_text,
  sponsor_text = excluded.sponsor_text,
  power_users_text = excluded.power_users_text,
  updated_at = now(),
  updated_by = excluded.updated_by;
