-- 12-Jun bug 248-a (Bug_Tracker_12_June.xlsx)
-- "Only Success Goals from the VPD should be used" — the Goal Validation
-- tab was showing every goal regardless of origin. Add a `source` column
-- so the tab can default to VPD-extracted goals (with a Show-all toggle).
--
-- Values: 'vpd'    — created from a VPD goals-extraction review
--         'manual' — typed by a CSM (Quick-Add / manual create)
--         'mom'    — reserved for future MoM-extracted goals
-- Existing rows default to 'manual' (safe: nothing is hidden retroactively
-- because the frontend toggle defaults to "show all" when no VPD goals
-- exist — see GoalAlignmentTab).

alter table cs_goals
  add column if not exists source text not null default 'manual';

-- Bound the values without an enum (cheaper to extend later).
do $$ begin
  alter table cs_goals
    add constraint chk_cs_goals_source
    check (source in ('vpd','manual','mom'));
exception when duplicate_object then null;
end $$;
