-- M28 — Growth & Pipeline · External Intelligence (sub-tab 3 of 3).
--
-- Per-account market / competitor / strategic news. Each item carries a
-- 10-way category, a signal-relevance level, and a "pushed-as-signal"
-- back-reference into M27 soft_signals (so the CSM can promote a piece
-- of market intel into the appetite-affecting signal mix with one click).
--
-- AI-generated items have ai_generated=true; the worker / scheduled job
-- populates these. Manual entries (CSM pastes a competitor announcement)
-- are tagged ai_generated=false.

do $$ begin
  create type intel_news_category as enum (
    'financial_performance',
    'supply_chain',
    'supplier_strategy',
    'expansion_capex',
    'regulatory_compliance',
    'sustainability_esg',
    'digital_transformation',
    'risk_geopolitical',
    'product_innovation',
    'm_and_a'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type intel_signal_relevance as enum ('high', 'medium', 'low');
exception when duplicate_object then null; end $$;


create table if not exists intel_news_items (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references accounts(id) on delete cascade,
  category          intel_news_category not null,
  headline          text not null,
  summary           text,
  source            text,
  source_url        text,
  news_date         date,
  signal_relevance  intel_signal_relevance not null default 'medium',
  is_new            bool not null default true,
  signal_created    bool not null default false,
  signal_id         uuid references soft_signals(id) on delete set null,
  ai_generated      bool not null default false,
  hidden            bool not null default false,
  added_by          uuid references users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists ix_intel_news_account
  on intel_news_items (account_id) where hidden = false;

create index if not exists ix_intel_news_account_category
  on intel_news_items (account_id, category) where hidden = false;
