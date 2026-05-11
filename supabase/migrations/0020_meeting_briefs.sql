-- M12 — Pre-Meeting Brief (MOM) for the Pre-Sales tab.
--
-- One brief per account (account_id is PK). The "current upcoming meeting"
-- model from the v20 prototype. If we need history later, we'll archive
-- prior versions into a sibling table — for now, the form holds one live
-- brief at a time.
--
-- Scalar fields for call info + cheat-sheet text. JSONB for the deep nested
-- collections (attendees, minefields, objectives, discovery questions,
-- value anchors, news, annual reports, closing scenarios, plus the small
-- company-snapshot stat cards and call timer). Pydantic enforces structure
-- on the way in; Postgres just stores the document.
--
-- RLS mirrors account_engagement: anyone with view-scope on the parent
-- account can read; FastAPI gates writes by the same matrix that gates
-- engagement edits (Pre-Sales / SDR / Solutioning / global admins).

do $$ begin
  create type brief_call_type as enum (
    'first_discovery', 'qbr', 'renewal', 'expansion', 'other'
  );
exception when duplicate_object then null; end $$;

create table if not exists meeting_briefs (
  account_id            uuid primary key references accounts(id) on delete cascade,

  -- Call info (scalars).
  call_type             brief_call_type,
  call_date             date,
  call_time             text,            -- free text like "10:00–11:00 AM CET"
  call_platform         text,
  call_duration_minutes integer,

  -- Win condition for the call.
  win_condition         text,

  -- Cheat-sheet scalars — short prompts the meeting lead references.
  cheat_sheet_win_condition_short text,

  -- JSONB collections. All default to empty arrays so the form renders
  -- on a fresh brief without nullable checks everywhere.
  company_snapshot    jsonb not null default '[]',  -- [{num, label, sub}]
  call_timer          jsonb not null default '[]',  -- [{time, label}]
  attendees           jsonb not null default '[]',  -- [{initials, name, role, company, objectives, primary_objective, background, opening_ask, is_self, avatar_color}]
  minefields          jsonb not null default '[]',  -- [{severity, type, text, why}]
  objectives          jsonb not null default '[]',  -- [{rank, name, confidence, bullets, beroe, sources}]
  discovery_questions jsonb not null default '[]',  -- [{objective, rank, person, from_email, text}]
  value_anchors       jsonb not null default '[]',  -- [{objective, points: [{text, note}]}]
  email_insights      jsonb not null default '[]',  -- [{meta, bullets}]
  public_signals      jsonb not null default '[]',  -- [{person, headline, text, url, tag}]
  news                jsonb not null default '[]',  -- [{days_ago, headline, source, signal, url, tag}]
  annual_reports      jsonb not null default '[]',  -- [{title, year, url, bullets}]
  closing_scenarios   jsonb not null default '[]',  -- [{type, label, text}]
  cheat_sheet_never_say    jsonb not null default '[]',  -- ["Wood Mackenzie", ...]
  cheat_sheet_opening_asks jsonb not null default '[]',  -- ["What's the one thing none of your current vendors get right?", ...]

  updated_at timestamptz not null default now(),
  updated_by uuid references users(id) on delete set null,

  constraint chk_call_duration_nonneg
    check (call_duration_minutes is null or call_duration_minutes >= 0)
);

-- Sanity: collection columns must be arrays, not objects/scalars. Cheap
-- guard against malformed PATCH bodies sneaking past Pydantic.
do $$ begin
  alter table meeting_briefs
    add constraint chk_meeting_briefs_arrays
    check (
      jsonb_typeof(company_snapshot) = 'array'
      and jsonb_typeof(call_timer) = 'array'
      and jsonb_typeof(attendees) = 'array'
      and jsonb_typeof(minefields) = 'array'
      and jsonb_typeof(objectives) = 'array'
      and jsonb_typeof(discovery_questions) = 'array'
      and jsonb_typeof(value_anchors) = 'array'
      and jsonb_typeof(email_insights) = 'array'
      and jsonb_typeof(public_signals) = 'array'
      and jsonb_typeof(news) = 'array'
      and jsonb_typeof(annual_reports) = 'array'
      and jsonb_typeof(closing_scenarios) = 'array'
      and jsonb_typeof(cheat_sheet_never_say) = 'array'
      and jsonb_typeof(cheat_sheet_opening_asks) = 'array'
    );
exception when duplicate_object then null; end $$;

alter table meeting_briefs enable row level security;

do $$ begin
  if exists (
    select 1 from pg_policies
    where tablename = 'meeting_briefs' and policyname = 'meeting_brief_view'
  ) then
    drop policy meeting_brief_view on meeting_briefs;
  end if;
end $$;

create policy meeting_brief_view on meeting_briefs
  for select to authenticated using (true);

do $$ begin
  if exists (
    select 1 from pg_policies
    where tablename = 'meeting_briefs' and policyname = 'meeting_brief_write'
  ) then
    drop policy meeting_brief_write on meeting_briefs;
  end if;
end $$;

create policy meeting_brief_write on meeting_briefs
  for all to authenticated using (true) with check (true);
