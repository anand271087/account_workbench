-- M20 — Success Metrics tracking.
--
-- Each row is one tracked metric on one account. The active metric set
-- flows from the Success Contract (locked metric1 + optional metric2)
-- but additional metrics can be added manually for richer tracking.
--
-- log_entries is an append-only audit trail of every value update,
-- each entry: {at, by, value, source, note}. Stored as jsonb so we
-- can iterate the entry shape without DDL churn.

-- CREATE TYPE IF NOT EXISTS doesn't exist in Postgres; wrap each in a DO block.
do $$ begin
  create type metric_type as enum ('quantitative', 'qualitative');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type metric_status_override as enum ('green', 'amber', 'red', 'grey');
exception when duplicate_object then null;
end $$;

create table if not exists success_metrics (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references accounts(id) on delete cascade,

  name            text not null,
  description     text,
  metric_type     metric_type not null default 'quantitative',
  unit            text,                              -- '$' / '%' / 'MAU' / etc, or null for qualitative
  target_value    text,                              -- free-form so quant + qual share the column
  current_value   text,
  status_override metric_status_override,            -- if set, overrides auto-derived status

  log_entries     jsonb not null default '[]'::jsonb,

  -- Lineage — when a metric is auto-created from the locked Success
  -- Contract, point at it so we can re-sync if needed.
  source          text default 'manual',             -- 'manual' / 'success_contract'

  last_updated_at timestamptz,
  last_updated_by uuid,

  created_at      timestamptz not null default now(),
  created_by      uuid,
  updated_at      timestamptz not null default now(),

  -- Soft delete — keep the audit trail when a metric is removed.
  deleted_at      timestamptz,
  deleted_by      uuid,
  deleted_reason  text,

  -- log_entries must be a json array.
  constraint chk_metrics_log_array
    check (jsonb_typeof(log_entries) = 'array'),

  -- soft delete must include a reason (belt-and-braces; UI enforces too).
  constraint chk_metrics_delete_has_reason
    check (
      (deleted_at is null and deleted_reason is null)
      or
      (deleted_at is not null and deleted_reason is not null)
    )
);

-- Hot path: list active metrics for an account.
create index if not exists idx_metrics_account_active
  on success_metrics(account_id) where deleted_at is null;

-- Standard RLS — Beroe is the enforcement layer in FastAPI; RLS is
-- defense-in-depth.
alter table success_metrics enable row level security;

drop policy if exists awb_metrics_view on success_metrics;
create policy awb_metrics_view
  on success_metrics for select
  using (auth.uid() is not null);

drop policy if exists awb_metrics_write on success_metrics;
create policy awb_metrics_write
  on success_metrics for all
  using (auth.uid() is not null)
  with check (auth.uid() is not null);
