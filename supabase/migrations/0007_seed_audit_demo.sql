-- M4 — seed a few audit_log entries so AK02 activity feed isn't empty for demo.
-- Real entries land automatically once M5/M6/M7 PATCH endpoints exist.
-- Idempotent.

-- Wipe only seeded demo entries (request_id = 'seed-m4'); keep any real ones.
delete from audit_log where request_id = 'seed-m4';

-- Insert per-account demo activity. We dynamically resolve account ids by slug.
insert into audit_log (
  table_name, row_id, action, changed_by_user_id, changed_at,
  field_name, old_value, new_value, request_id
)
select * from (
  values
    -- Siemens — created at handoff
    (
      'accounts',
      (select id from accounts where slug = 'siemens-energy'),
      'insert'::audit_action,
      (select id from users where email = 'megha@beroe-inc.com'),
      now() - interval '5 days',
      null,
      null,
      jsonb_build_object('account_id', (select id from accounts where slug = 'siemens-energy')::text, 'name', 'Siemens Energy AG'),
      'seed-m4'
    ),
    -- Siemens — handed off CSM ownership to Harish
    (
      'accounts',
      (select id from accounts where slug = 'siemens-energy'),
      'update'::audit_action,
      (select id from users where email = 'anand@beroe-inc.com'),
      now() - interval '4 days',
      'csm_user_id',
      jsonb_build_object('csm_user_id', null),
      jsonb_build_object('csm_user_id', (select id from users where email = 'harish@beroe-inc.com')::text),
      'seed-m4'
    ),
    -- Sanofi — reassigned to csm2
    (
      'accounts',
      (select id from accounts where slug = 'sanofi'),
      'update'::audit_action,
      (select id from users where email = 'anand@beroe-inc.com'),
      now() - interval '12 hours',
      'csm_user_id',
      jsonb_build_object('csm_user_id', (select id from users where email = 'harish@beroe-inc.com')::text),
      jsonb_build_object('csm_user_id', (select id from users where email = 'csm2@beroe-inc.com')::text),
      'seed-m4'
    ),
    -- Mondelez — health score recomputed (placeholder for Sprint 6)
    (
      'accounts',
      (select id from accounts where slug = 'mondelez'),
      'update'::audit_action,
      null,
      now() - interval '8 hours',
      'health_score',
      jsonb_build_object('health_score', 38),
      jsonb_build_object('health_score', 41),
      'seed-m4'
    ),
    -- Novo Nordisk — Just signed (most recent)
    (
      'accounts',
      (select id from accounts where slug = 'novonordisk'),
      'update'::audit_action,
      (select id from users where email = 'megha@beroe-inc.com'),
      now() - interval '2 hours',
      'contract_start',
      jsonb_build_object('contract_start', null),
      jsonb_build_object('contract_start', '2025-03-01'),
      'seed-m4'
    )
) as v;
