-- M2 — seed lookup tables. Idempotent.

-- Roles (all 11 BRD roles)
insert into lookup_roles (role_key, label, description) values
  ('csm',                 'CSM',                 'Customer Success Manager — owns assigned accounts'),
  ('cs_team_manager',     'CS Team Manager',     'Manages a CSM team'),
  ('cs_director',         'CS Director',         'CS director — full read-write across accounts'),
  ('vp_csm',              'VP — CSM',            'VP-level CSM — full read-write'),
  ('commercial_owner',    'Commercial Owner',    'Owns commercial fields on portfolio'),
  ('vp_sales',            'VP — Sales',          'VP-level Sales — full read-write + leadership view'),
  ('solutioning_manager', 'Solutioning Manager', 'Read-write on solutioning sections; read-only elsewhere'),
  ('vp_solutioning',      'VP — Solutioning',    'Read-only across all + leadership view'),
  ('inside_sales_manager','Inside Sales Manager','Read-write on inside-sales sections'),
  ('vp_inside_sales',     'VP — Inside Sales',   'Read-only across all + leadership view'),
  ('admin',               'Admin',               'Full access; user management; audit log')
on conflict (role_key) do update set label = excluded.label, description = excluded.description;

-- Geographies (minimal seed — extend later)
insert into lookup_geographies (name, region) values
  ('North America', 'NA'),
  ('Europe',         'EMEA'),
  ('Asia Pacific',   'APAC'),
  ('Latin America',  'LATAM'),
  ('Middle East & Africa', 'MEA')
on conflict (name) do nothing;

-- Categories (minimal seed — Beroe team to provide ~30-50 list per BRD open question)
insert into lookup_categories (name, approved) values
  ('Direct Materials',        true),
  ('Indirect Materials',      true),
  ('MRO',                     true),
  ('Logistics',               true),
  ('Professional Services',   true),
  ('IT Services',             true),
  ('Marketing Services',      true),
  ('Packaging',               true),
  ('Energy',                  true),
  ('Travel',                  true)
on conflict (name) do nothing;
