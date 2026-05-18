-- Backfill abi.usage_trend + abi.avg_feedback so the Analytics / Abi KPI
-- tiles don't display hardcoded fallbacks ("Increasing", "8.5/10").
-- These columns aren't in the Pydantic schema directly (carried via
-- extra="allow") so we just jsonb_set them onto the existing abi key.

update accounts
set platform_intel = jsonb_set(
  jsonb_set(platform_intel, '{abi,usage_trend}', '"Increasing"'::jsonb, true),
  '{abi,avg_feedback}', '"8.7/10"'::jsonb, true
)
where slug = 'mondelez';

update accounts
set platform_intel = jsonb_set(
  jsonb_set(platform_intel, '{abi,usage_trend}', '"Stable"'::jsonb, true),
  '{abi,avg_feedback}', '"8.2/10"'::jsonb, true
)
where slug = 'siemens-energy';
