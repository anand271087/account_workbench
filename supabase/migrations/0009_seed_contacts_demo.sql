-- M6 — seed demo client contacts for the 4 accounts.
-- Idempotent (delete + reinsert by deterministic id keeps the table clean across re-runs).

-- Wipe prior demo seed (uses fixed UUIDs in the 5xxxx... namespace)
delete from client_contacts where id::text like '50000000-%';

insert into client_contacts (
  id, account_id, name, title, email, phone, role, influence, is_spoc, is_sponsor
) values
  -- Siemens (4 contacts)
  ('50000000-0000-0000-0000-000000000001', (select id from accounts where slug='siemens-energy'),
   'Dr. Klaus Richter',  'CPO',                    'klaus.richter@siemens-energy.com',  '+49-89-636-101', 'decision_maker'::contact_role, 'high'::influence_level,  false, true),
  ('50000000-0000-0000-0000-000000000002', (select id from accounts where slug='siemens-energy'),
   'Gunter Braun',       'VP Procurement',         'gunter.braun@siemens-energy.com',   '+49-89-636-102', 'decision_maker'::contact_role, 'high'::influence_level,  true,  false),
  ('50000000-0000-0000-0000-000000000003', (select id from accounts where slug='siemens-energy'),
   'Priya Menon',        'Sr. Category Manager',   'priya.menon@siemens-energy.com',    '+49-89-636-103', 'end_user'::contact_role,       'medium'::influence_level, false, false),
  ('50000000-0000-0000-0000-000000000004', (select id from accounts where slug='siemens-energy'),
   'Ingrid Schmidt',     'Strategic Sourcing Lead','ingrid.schmidt@siemens-energy.com', '+49-89-636-104', 'influencer'::contact_role,     'medium'::influence_level, false, false),

  -- Mondelez (3 contacts)
  ('50000000-0000-0000-0000-000000000010', (select id from accounts where slug='mondelez'),
   'Jordan Mills',       'Director, Procurement',  'jordan.mills@mdlz.com',             '+1-847-555-0102', 'decision_maker'::contact_role, 'high'::influence_level,  true,  false),
  ('50000000-0000-0000-0000-000000000011', (select id from accounts where slug='mondelez'),
   'Dave Kowalski',      'CPO Americas',           'dave.kowalski@mdlz.com',            '+1-847-555-0103', 'decision_maker'::contact_role, 'high'::influence_level,  false, true),
  ('50000000-0000-0000-0000-000000000012', (select id from accounts where slug='mondelez'),
   'Ana Reyes',          'Category Manager',       'ana.reyes@mdlz.com',                '+1-847-555-0104', 'end_user'::contact_role,       'medium'::influence_level, false, false),

  -- Sanofi (3 contacts)
  ('50000000-0000-0000-0000-000000000020', (select id from accounts where slug='sanofi'),
   'Céline Dupont',      'VP Global Procurement',  'celine.dupont@sanofi.com',          '+33-1-5377-1010', 'decision_maker'::contact_role, 'high'::influence_level,  false, true),
  ('50000000-0000-0000-0000-000000000021', (select id from accounts where slug='sanofi'),
   'Marc Leblanc',       'Head of Category Mgmt',  'marc.leblanc@sanofi.com',           '+33-1-5377-1011', 'decision_maker'::contact_role, 'high'::influence_level,  true,  false),
  ('50000000-0000-0000-0000-000000000022', (select id from accounts where slug='sanofi'),
   'Sophie Bernard',     'Head Digital Procurement','sophie.bernard@sanofi.com',        '+33-1-5377-1012', 'influencer'::contact_role,     'high'::influence_level,  false, false),

  -- Novo Nordisk (2 contacts)
  ('50000000-0000-0000-0000-000000000030', (select id from accounts where slug='novonordisk'),
   'Lars Andersen',      'Global Category Director','lars.andersen@novonordisk.com',    '+45-4444-8888',   'decision_maker'::contact_role, 'high'::influence_level,  true,  false),
  ('50000000-0000-0000-0000-000000000031', (select id from accounts where slug='novonordisk'),
   'Mette Hansen',       'CPO',                    'mette.hansen@novonordisk.com',      '+45-4444-8889',   'decision_maker'::contact_role, 'high'::influence_level,  false, true);
