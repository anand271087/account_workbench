-- M3 realign — seed a test team and link the new CSM users.
-- Idempotent. Lets us exercise CS Team Manager scope tests.

-- Create the team if missing. Manager = APAC Team Lead.
insert into teams (id, name, manager_user_id)
select
  '99999999-9999-9999-9999-999999999999'::uuid,
  'APAC CS Team',
  (select id from users where email = 'team.lead@beroe-inc.com')
on conflict (id) do update
  set name = excluded.name, manager_user_id = excluded.manager_user_id;

-- Put the team lead, harish (csm), and csm2 (csm) on the team.
update users set team_id = '99999999-9999-9999-9999-999999999999'::uuid
where email in ('team.lead@beroe-inc.com', 'harish@beroe-inc.com', 'csm2@beroe-inc.com');

-- Reassign Sanofi to csm2 so the test data shows a "csm sees account but isn't editor" case.
update accounts
set csm_user_id = (select id from users where email = 'csm2@beroe-inc.com')
where slug = 'sanofi';

-- Refresh assignments table — Sanofi now has csm2 as the csm assignee.
delete from account_assignments
  where account_id = (select id from accounts where slug = 'sanofi')
    and role_on_account = 'csm';
insert into account_assignments (account_id, user_id, role_on_account)
select a.id, u.id, 'csm'
from accounts a, users u
where a.slug = 'sanofi' and u.email = 'csm2@beroe-inc.com'
on conflict do nothing;
