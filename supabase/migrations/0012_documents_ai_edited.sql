-- M7.1 — BRD §4.3.c "AI-generated → AI-assisted" lifecycle.
--
-- When a user edits the AI summary, we flip ai_edited=true. The UI shows
-- "AI-generated" by default, "AI-assisted" once edited. Tracks which user
-- last touched the summary so the activity feed can attribute edits.

alter table documents
  add column if not exists ai_edited boolean not null default false,
  add column if not exists ai_edited_by uuid references users(id) on delete set null,
  add column if not exists ai_edited_at timestamptz;
