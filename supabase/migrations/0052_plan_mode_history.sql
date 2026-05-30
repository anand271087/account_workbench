-- 28-May bug 28-33 — Mode override audit + history.
--
-- Adds two columns on `accounts`:
--   * plan_mode_override_reason  text         — why the CSM picked a
--                                                 non-Auto mode. Required
--                                                 (≥10 chars) by the route
--                                                 when mode is non-null.
--   * plan_mode_history          jsonb        — append-only list of
--                                                 {at, by, from, to, reason}
--                                                 entries. Last 50 retained.
--
-- The existing audit_log table already captures every plan_current_mode
-- write via the SQLAlchemy before_flush listener. The dedicated history
-- array is a denormalized, user-facing convenience so the Account Plan
-- tab can show "who changed what when, and why" without a join.

alter table public.accounts
  add column if not exists plan_mode_override_reason text,
  add column if not exists plan_mode_history jsonb not null default '[]'::jsonb;

-- Sanity: history must be an array.
alter table public.accounts
  drop constraint if exists chk_plan_mode_history_array;
alter table public.accounts
  add constraint chk_plan_mode_history_array
  check (jsonb_typeof(plan_mode_history) = 'array');

-- Sanity: reason length (allow nullable; non-null must be ≥10 chars).
alter table public.accounts
  drop constraint if exists chk_plan_mode_override_reason_len;
alter table public.accounts
  add constraint chk_plan_mode_override_reason_len
  check (
    plan_mode_override_reason is null
    or length(plan_mode_override_reason) between 10 and 600
  );

comment on column public.accounts.plan_mode_override_reason is
  '28-May bug 28-33 — reason captured when CSM overrides Appetite mode. Cleared when mode → Auto.';
comment on column public.accounts.plan_mode_history is
  '28-May bug 28-33 — append-only mode-change log (last 50 entries).';
