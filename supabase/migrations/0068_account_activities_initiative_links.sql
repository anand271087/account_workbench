-- 09-Jun · G7 — value_flow_map.html Stage 10 gap-pill:
--   "Touchpoint counter per initiative not surfaced — should show
--    '5 touchpoints / last on 22 Mar' on initiative card."
--
-- account_activities already carries linked_metrics (uuid[]). Adding
-- two parallel columns so each activity can be associated with the
-- initiatives + goals it advanced.
--
-- linked_initiatives is text[] (NOT uuid[]) because Initiative.id
-- lives inside cs_goals.initiatives jsonb as a prototype string
-- ("i_0", "i_<ms>" — see GoalAlignmentTab readInit/writeInit). There
-- is no initiatives table to FK-reference. Goals do have a UUID PK
-- so linked_goals is uuid[].
--
-- Idempotent — safe to re-apply.

alter table account_activities
  add column if not exists linked_initiatives text[] not null default '{}';

alter table account_activities
  add column if not exists linked_goals uuid[] not null default '{}';

-- GIN indexes so "activities touching this initiative" filter queries
-- scan only matching rows. Non-blocking — small tables, < 1 min build.
create index if not exists ix_account_activities_linked_initiatives
  on account_activities using gin (linked_initiatives);

create index if not exists ix_account_activities_linked_goals
  on account_activities using gin (linked_goals);
