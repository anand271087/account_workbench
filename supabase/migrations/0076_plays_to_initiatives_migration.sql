-- 0076_plays_to_initiatives_migration.sql
--
-- One-shot data migration: convert existing account_plays rows into
-- initiatives on a per-account "Migrated expansion plays" goal.
--
-- Why: stakeholder decision 12-Jun — "expansion play is nothing but
-- initiatives. you have to map the initiatives as per the success
-- metric". The Active tab of Expansion Plays now reads cs_goals
-- initiatives directly; standalone account_plays rows would orphan.
-- This migration preserves the existing data by lifting each play
-- into an initiative under a placeholder goal the CSM can re-home
-- manually later.
--
-- Idempotency: the "Migrated expansion plays" goal is created at most
-- once per account. account_plays rows are flagged via hidden=true
-- after migration so re-running is a no-op (the WHERE not hidden
-- filter skips them).
--
-- Mapping:
--   play.title         → initiative.title
--   play.value_usd     → initiative.value_target  (formatted "$N K/M")
--   play.prob          → initiative.status        (4-stage threshold)
--                          ≥90 → delivered
--                          ≥60 → in_progress
--                          ≥30 → pipeline
--                          else → identification
--   play.trigger_text  → initiative.notes
--   play.when_text     → initiative.value_fields.when_text
--   play.modes         → initiative.value_fields.modes
--   play.role          → initiative.value_fields.role
--   play.prob          → initiative.value_fields.prob (audit trail)
--   play.id            → initiative.id  ("play-<uuid>")

-- Step 1: create the per-account "Migrated expansion plays" goal for
-- every account that has at least one non-hidden play, but only if
-- the goal doesn't already exist.

insert into cs_goals (
  account_id, title, category, target_value, target_date, owner,
  alignment_status, history
)
select distinct
  ap.account_id,
  'Migrated expansion plays'::text,
  'other'::text,
  null::text,                                  -- target_value
  null::date,                                  -- target_date (must cast)
  null::text,                                  -- owner
  'not_started'::cs_goal_alignment,
  jsonb_build_array(
    jsonb_build_object(
      'action', 'created',
      'at',     now()::text,
      'by',     null,
      'note',   'Auto-created by migration 0076 to host plays moved from account_plays.'
    )
  )
from account_plays ap
where not ap.hidden
  and not exists (
    select 1
    from cs_goals g
    where g.account_id = ap.account_id
      and g.title = 'Migrated expansion plays'
      and g.deleted_at is null
  );

-- Step 2: append each non-hidden play to its account's migrated goal
-- as one initiative. Uses a CTE to build the per-account array then
-- jsonb_concat onto the existing initiatives jsonb. Each per-play
-- jsonb_build_object emits the full initiative shape consumed by the
-- frontend's InitiativeEditor.

with migrated_goal as (
  select id as goal_id, account_id
  from cs_goals
  where title = 'Migrated expansion plays'
    and deleted_at is null
),
play_inits as (
  select
    mg.goal_id,
    jsonb_agg(
      jsonb_build_object(
        'id',           'play-' || ap.id::text,
        -- Initiative schema uses `name`, not `title` (cs_goal.py:114).
        'name',         ap.title,
        'status',       case
                          when ap.prob >= 90 then 'delivered'
                          when ap.prob >= 60 then 'in_progress'
                          when ap.prob >= 30 then 'pipeline'
                          else                    'identification'
                        end,
        'owner',        ap.added_by::text,
        'value_target', case
                          when ap.value_usd >= 1000000 then '$' || trim(to_char(ap.value_usd / 1000000.0, 'FM999990.0')) || 'M'
                          when ap.value_usd >=    1000 then '$' || trim(to_char(ap.value_usd / 1000.0,    'FM999990'))   || 'K'
                          when ap.value_usd > 0        then '$' || trim(to_char(ap.value_usd,             'FM999990'))
                          else                              null
                        end,
        'notes',        ap.trigger_text,
        'value_fields', jsonb_build_object(
          'when_text', ap.when_text,
          'modes',     to_jsonb(ap.modes),
          'role',      ap.role,
          'prob',      ap.prob
        )
      )
      order by ap.created_at
    ) as inits
  from account_plays ap
  join migrated_goal mg on mg.account_id = ap.account_id
  where not ap.hidden
  group by mg.goal_id
)
update cs_goals g
set initiatives = coalesce(g.initiatives, '[]'::jsonb) || pi.inits
from play_inits pi
where g.id = pi.goal_id;

-- Step 3: flag migrated plays as hidden so the next run is a no-op
-- and so any legacy /plays endpoint that filters out hidden rows
-- stops surfacing them.

update account_plays
set hidden = true,
    updated_at = now()
where not hidden
  and account_id in (select account_id from cs_goals where title = 'Migrated expansion plays');

-- Step 4 (idempotent repair): an earlier run of this migration emitted
-- the initiative under key `title` instead of the canonical `name`.
-- This statement renames the key on any affected rows; safe to run
-- repeatedly because `jsonb_set` with `-` removes the old key and
-- adds the new one only when present.

update cs_goals
set initiatives = (
  select jsonb_agg(
    case
      when init ? 'title' and not (init ? 'name')
        then (init - 'title') || jsonb_build_object('name', init->'title')
      else init
    end
    order by ord
  )
  from jsonb_array_elements(initiatives) with ordinality as t(init, ord)
)
where title = 'Migrated expansion plays'
  and deleted_at is null
  and initiatives::text like '%"title"%';
