-- 05-Jun · Phase 3 — Offline source staging tables.
--
-- Five external systems (Cirtuo / nnamu / Upply / Training / NPS)
-- live on SharePoint or CSV exports. The Phase-3 loader scripts
-- (apps/scripts/intel_loaders/*.py) parse those files and upsert
-- into these tables. Backend bundles read from here when present;
-- otherwise the existing NA pill flow renders an "Awaiting offline
-- CSV load" reason.
--
-- Schema choices:
--   * `company_name` column = canonical Redshift companyname (same
--     value as accounts.redshift_company_name) so bundles look up by
--     a single string without a join to public.accounts.
--   * `report_period` column on each = the date the row pertains to
--     (start of month for monthly sources, file-export date otherwise).
--   * `loaded_at` audit column = when the loader inserted this row.
--   * Idempotent: all tables use IF NOT EXISTS; loaders use upserts
--     keyed on (company_name, report_period) or (company_name, row_key).
--
-- All tables live in the `public` schema (no separate schema for
-- now). RLS is intentionally OFF on these — bundles are read via the
-- service-role key in app/services, and there's no direct frontend
-- exposure to these tables.

-- ============================================================
-- nnamu — negotiation savings
-- spec: Total / Final price · Absolute savings · Avg relative %
-- ============================================================
create table if not exists public.intel_nnamu_savings (
  id                       uuid primary key default gen_random_uuid(),
  company_name             text not null,
  report_period            date not null,
  initial_comparison_price numeric(18,2),  -- USD
  final_comparison_price   numeric(18,2),  -- USD
  absolute_savings         numeric(18,2),  -- USD (initial - final; loader can compute)
  savings_pct              numeric(6,2),   -- 0..100 (loader can compute)
  raw                      jsonb default '{}'::jsonb,
  loaded_at                timestamptz not null default now(),
  unique (company_name, report_period)
);
create index if not exists ix_intel_nnamu_company on public.intel_nnamu_savings (company_name);

comment on table public.intel_nnamu_savings is
  'Phase 3 — nnamu Savings Report (Pivot / Main Tracker). Loaded by scripts/intel_loaders/load_nnamu.py';

-- ============================================================
-- Upply — route benchmarks (one row per request)
-- spec: # routes · Unique users · Avg routes/user · by medium · top lanes · monthly trend
-- ============================================================
create table if not exists public.intel_upply_tracking (
  id            uuid primary key default gen_random_uuid(),
  company_name  text not null,
  user_email    text,
  medium        text,   -- AIR / OCEAN / ROADEMEA / ROADNA
  origin        text,
  destination   text,
  request_date  date,
  raw           jsonb default '{}'::jsonb,
  loaded_at     timestamptz not null default now()
);
create index if not exists ix_intel_upply_company on public.intel_upply_tracking (company_name);
create index if not exists ix_intel_upply_request on public.intel_upply_tracking (company_name, request_date);

comment on table public.intel_upply_tracking is
  'Phase 3 — Upply_Tracking_Report CSV. Loaded by scripts/intel_loaders/load_upply.py';

-- ============================================================
-- Cirtuo — sourcing projects + feedback (per period)
-- spec: # Categories Supported · % Feedback captured · average feedback
-- ============================================================
create table if not exists public.intel_cirtuo_projects (
  id                    uuid primary key default gen_random_uuid(),
  company_name          text not null,
  report_period         date not null,
  categories_supported  integer,             -- count of Cirtuo projects executed
  feedback_received     integer,             -- # responses
  feedback_total        integer,             -- # delivered
  feedback_score_avg    numeric(4,2),        -- avg user rating
  raw                   jsonb default '{}'::jsonb,
  loaded_at             timestamptz not null default now(),
  unique (company_name, report_period)
);
create index if not exists ix_intel_cirtuo_company on public.intel_cirtuo_projects (company_name);

comment on table public.intel_cirtuo_projects is
  'Phase 3 — Cirtuo project tracker file. Loaded by scripts/intel_loaders/load_cirtuo.py';

-- ============================================================
-- Platform Training — attendance (per session or per period)
-- spec: # users attended · % of users attended
-- ============================================================
create table if not exists public.intel_training_attendance (
  id              uuid primary key default gen_random_uuid(),
  company_name    text not null,
  session_date    date not null,
  users_attended  integer,
  users_invited   integer,         -- denominator for %
  topic           text,
  raw             jsonb default '{}'::jsonb,
  loaded_at       timestamptz not null default now(),
  unique (company_name, session_date, topic)
);
create index if not exists ix_intel_training_company on public.intel_training_attendance (company_name);

comment on table public.intel_training_attendance is
  'Phase 3 — SharePoint training file. Loaded by scripts/intel_loaders/load_training.py';

-- ============================================================
-- NPS — feedback score per period
-- spec: Average NPS feedback
-- ============================================================
create table if not exists public.intel_nps_scores (
  id              uuid primary key default gen_random_uuid(),
  company_name    text not null,
  report_period   date not null,
  nps_score       numeric(5,2),       -- can be -100..100 (Net Promoter Score) or 1..10 raw
  promoters_pct   numeric(5,2),       -- 0..100
  passives_pct    numeric(5,2),
  detractors_pct  numeric(5,2),
  response_count  integer,
  raw             jsonb default '{}'::jsonb,
  loaded_at       timestamptz not null default now(),
  unique (company_name, report_period)
);
create index if not exists ix_intel_nps_company on public.intel_nps_scores (company_name);

comment on table public.intel_nps_scores is
  'Phase 3 — SharePoint NPS file. Loaded by scripts/intel_loaders/load_nps.py';
