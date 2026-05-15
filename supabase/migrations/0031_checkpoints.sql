-- M21 — Checkpoints.
--
-- The cadence that proves value over the lifetime of the engagement.
-- Four standard types: Kickoff → MBR → QBR → Renewal. Auto-scheduled
-- from gate_signed_date (POST /auto-schedule). Each checkpoint can be
-- signed off with a structured snapshot of initiatives reviewed, metrics
-- discussed, and the client acknowledgement note — that snapshot is
-- what Renewal Readiness (M23) and the VDD (M22) draw on.

do $$ begin
  create type checkpoint_type as enum ('Kickoff', 'MBR', 'QBR', 'Renewal');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type checkpoint_status as enum ('not_held', 'held', 'signed_off');
exception when duplicate_object then null;
end $$;

create table if not exists checkpoints (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references accounts(id) on delete cascade,

  type            checkpoint_type not null,
  scheduled_date  date,
  held_date       date,

  status          checkpoint_status not null default 'not_held',
  notes           text,

  -- Sign-off snapshot — fixed shape:
  --   {
  --     initiatives: [{id, name, stage}],
  --     metrics:     [{id, name, value}],
  --     client_acknowledgement: string,
  --     next_actions:            string
  --   }
  -- Set only when status flips to 'signed_off'.
  signed_off_at      timestamptz,
  signed_off_by      uuid,
  signed_off_snapshot jsonb,

  created_at      timestamptz not null default now(),
  created_by      uuid,
  updated_at      timestamptz not null default now(),

  -- A held checkpoint without a held_date is suspicious; signed-off
  -- without a snapshot is incomplete. CHECK both invariants.
  constraint chk_checkpoints_signoff_consistent
    check (
      (status <> 'signed_off' and signed_off_at is null)
      or
      (status = 'signed_off' and signed_off_at is not null and signed_off_by is not null)
    ),

  -- snapshot must be an object (or null when not signed off).
  constraint chk_checkpoints_snapshot_object
    check (signed_off_snapshot is null or jsonb_typeof(signed_off_snapshot) = 'object')
);

-- Hot path: list checkpoints for an account in scheduled order.
create index if not exists idx_checkpoints_account_schedule
  on checkpoints(account_id, scheduled_date);

alter table checkpoints enable row level security;

drop policy if exists awb_checkpoints_view on checkpoints;
create policy awb_checkpoints_view
  on checkpoints for select
  using (auth.uid() is not null);

drop policy if exists awb_checkpoints_write on checkpoints;
create policy awb_checkpoints_write
  on checkpoints for all
  using (auth.uid() is not null)
  with check (auth.uid() is not null);
