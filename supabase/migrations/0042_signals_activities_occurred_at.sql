-- R29 — capture when an activity / soft signal actually occurred
-- (as opposed to when it was logged into the system). CSMs often log
-- retroactively — "noted a call from yesterday" — so we need a separate
-- occurred_at date alongside created_at.

alter table soft_signals
  add column if not exists occurred_at date;

alter table account_activities
  add column if not exists occurred_at date;
