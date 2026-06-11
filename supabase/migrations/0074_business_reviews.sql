-- 0074_business_reviews.sql
--
-- Backend-rendered, DB-persisted Business Reviews.
--
-- One row per Generate click. The row carries:
--   * cadence + period metadata (so the row is self-describing for the
--     Cycles list — no joins required)
--   * data_snapshot jsonb — the analytics shape that produced this BR.
--     Frozen at generation time so re-rendering yields identical output
--     even if the underlying account data shifts later.
--   * html / pdf / pptx bytes — rendered once, served on demand. Pre-
--     rendering trades DB size for predictable download latency.
--
-- The frontend BR tab posts to /accounts/:id/business-reviews/generate,
-- which writes one of these rows and returns its id. Past Cycles lists
-- read the row metadata; download endpoints stream the bytes.

do $$ begin
  create type business_review_cadence as enum ('monthly', 'quarterly', 'renewal', 'custom');
exception when duplicate_object then null; end $$;

create table if not exists business_reviews (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references accounts(id) on delete cascade,
  cadence         business_review_cadence not null,
  period_label    text not null,
  period_start    date,
  period_end      date,
  generated_by    uuid references public.users(id),
  generated_at    timestamptz not null default now(),
  data_snapshot   jsonb not null default '{}'::jsonb,
  html            text not null default '',
  pdf             bytea,
  pptx            bytea,
  constraint chk_business_reviews_snapshot_object
    check (jsonb_typeof(data_snapshot) = 'object')
);

create index if not exists ix_business_reviews_account_generated
  on business_reviews (account_id, generated_at desc);

-- RLS (mirror the rest of the schema). View/insert tied to whether the
-- user can view the account. Service-role bypasses RLS.
alter table business_reviews enable row level security;

drop policy if exists business_reviews_select on business_reviews;
create policy business_reviews_select on business_reviews
  for select using (
    exists (
      select 1 from accounts a where a.id = account_id
        and (
          current_user_role() in (
            'admin', 'cs_director', 'vp_csm', 'vp_sales',
            'vp_inside_sales', 'cs_team_manager', 'solutioning_manager'
          )
          or user_assigned_to_account(account_id)
        )
    )
  );

drop policy if exists business_reviews_insert on business_reviews;
create policy business_reviews_insert on business_reviews
  for insert with check (
    current_user_role() in ('admin', 'cs_director', 'vp_csm', 'cs_team_manager', 'csm')
    and (
      current_user_role() in ('admin', 'cs_director', 'vp_csm')
      or user_assigned_to_account(account_id)
    )
  );

drop policy if exists business_reviews_delete on business_reviews;
create policy business_reviews_delete on business_reviews
  for delete using (current_user_role() = 'admin');
