-- 29-May bug 29-06 — Geographies needs country-level options.
--
-- The original seed (migration 0003) inserted 5 regions only.
-- The 29-May screenshot (column J row 127) shows users selecting
-- specific countries (United States, Germany, UAE) as Geography
-- pills alongside the regions. This migration adds ~35 commonly
-- targeted countries to lookup_geographies. Idempotent — uses
-- INSERT … ON CONFLICT (name) DO NOTHING.

insert into lookup_geographies (name, region) values
  -- North America
  ('United States',   'NA'),
  ('Canada',          'NA'),
  ('Mexico',          'NA'),

  -- Europe
  ('Germany',         'EMEA'),
  ('United Kingdom',  'EMEA'),
  ('France',          'EMEA'),
  ('Italy',           'EMEA'),
  ('Spain',           'EMEA'),
  ('Netherlands',     'EMEA'),
  ('Switzerland',     'EMEA'),
  ('Sweden',          'EMEA'),
  ('Belgium',         'EMEA'),
  ('Poland',          'EMEA'),
  ('Denmark',         'EMEA'),
  ('Norway',          'EMEA'),
  ('Finland',         'EMEA'),
  ('Ireland',         'EMEA'),

  -- Asia Pacific
  ('India',           'APAC'),
  ('China',           'APAC'),
  ('Japan',           'APAC'),
  ('Australia',       'APAC'),
  ('Singapore',       'APAC'),
  ('South Korea',     'APAC'),
  ('Malaysia',        'APAC'),
  ('Indonesia',       'APAC'),
  ('Thailand',        'APAC'),
  ('Vietnam',         'APAC'),
  ('Philippines',     'APAC'),
  ('New Zealand',     'APAC'),

  -- Latin America
  ('Brazil',          'LATAM'),
  ('Argentina',       'LATAM'),
  ('Chile',           'LATAM'),
  ('Colombia',        'LATAM'),

  -- Middle East & Africa
  ('UAE',             'MEA'),
  ('Saudi Arabia',    'MEA'),
  ('South Africa',    'MEA'),
  ('Egypt',           'MEA'),
  ('Israel',          'MEA')
on conflict (name) do nothing;
