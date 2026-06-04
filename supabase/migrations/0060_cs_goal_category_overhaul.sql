-- 03-Jun bug — Goals Category dropdown expanded from 5 enum values
-- (cost_savings/base_rationalization/risk_mitigation/adoption/other) to
-- the prototype's 16-item list (Cost Reduction, Negotiation Leverage,
-- Should-Cost Modeling, …).
--
-- Strategy: convert the column to text + CHECK so we can edit the
-- allowed set freely without ALTER TYPE gymnastics. Keep the old 5
-- values in the CHECK so existing rows still validate; new rows use
-- the new vocabulary.

-- Step 1 — drop the existing default that references the enum type.
alter table public.cs_goals
  alter column category drop default;

-- Step 2 — switch column type from cs_goal_category enum to text.
alter table public.cs_goals
  alter column category type text using category::text;

-- Step 3 — re-add the default (text literal now).
alter table public.cs_goals
  alter column category set default 'other';

-- Step 4 — CHECK on the union of legacy + new vocab. Legacy values
-- preserved so existing rows pass validation; the UI surfaces the
-- new 16-item list when creating goals.
do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'chk_cs_goals_category'
  ) then
    alter table public.cs_goals
      add constraint chk_cs_goals_category
      check (category in (
        -- legacy (kept for back-compat)
        'cost_savings', 'base_rationalization', 'risk_mitigation',
        'adoption', 'other',
        -- 03-Jun prototype vocabulary (16 items)
        'cost_reduction',
        'negotiation_leverage',
        'should_cost_modeling',
        'tco_optimization',
        'competitive_benchmarking',
        'category_strategy_market_dynamics',
        'supply_demand_outlook',
        'enhanced_supplier_discovery',
        'financial_risk_monitoring',
        'supply_assurance',
        'geopolitical_risk_management',
        'lcc_ncc_sourcing_strategy',
        'ai_driven_sourcing_transformations',
        'esg_responsible_sourcing'
      ));
  end if;
end $$;

-- Step 5 — drop the now-unused enum type if nothing else references it.
-- Guarded so a re-run on a partially-migrated DB doesn't error.
do $$ begin
  if exists (select 1 from pg_type where typname = 'cs_goal_category') then
    -- Verify nothing in pg_attribute still points at this enum.
    if not exists (
      select 1
      from pg_attribute a
      join pg_type t on a.atttypid = t.oid
      where t.typname = 'cs_goal_category'
    ) then
      drop type cs_goal_category;
    end if;
  end if;
end $$;
