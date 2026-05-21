-- H46 — Brief gets a "Categories" tab. Free-form list of strings.
-- Mirrors the prototype `bMomBrief` categories block where the rep
-- lists the procurement categories in scope for the call.

alter table meeting_briefs
  add column if not exists categories jsonb not null default '[]';

alter table meeting_briefs
  drop constraint if exists chk_meeting_briefs_categories_array;

alter table meeting_briefs
  add constraint chk_meeting_briefs_categories_array
  check (jsonb_typeof(categories) = 'array');
