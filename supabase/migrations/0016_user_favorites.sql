-- Pinned accounts in the sidebar — per-user, persistent (replaces the
-- localStorage Phase-1 implementation).
--
-- Cap of 10 is enforced at the API layer, not here, so the DB stays simple.

create table if not exists user_favorites (
  user_id    uuid not null references users(id) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade,
  pinned_at  timestamptz not null default now(),
  primary key (user_id, account_id)
);

create index if not exists idx_user_favorites_user_pinned
  on user_favorites (user_id, pinned_at desc);

-- RLS — users only ever see/touch their own favourites.
alter table user_favorites enable row level security;

do $$ begin
  if exists (select 1 from pg_policies where tablename = 'user_favorites'
             and policyname = 'user_favorites_self') then
    drop policy user_favorites_self on user_favorites;
  end if;
end $$;

create policy user_favorites_self on user_favorites
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
