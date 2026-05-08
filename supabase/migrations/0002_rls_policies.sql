-- M2 — Row Level Security policies.
-- Enforced at DB layer. FastAPI also enforces via require_role/require_account_access (defense-in-depth).

-- Helper: current user's role (NULL if not in our users table)
create or replace function current_user_role() returns role_key
  language sql stable security definer set search_path = public as
$$
  select role from public.users where id = auth.uid() and deleted_at is null
$$;

-- Helper: is the current user assigned (any way) to this account?
create or replace function user_assigned_to_account(p_account uuid) returns boolean
  language sql stable security definer set search_path = public as
$$
  select exists (
    select 1 from public.account_assignments
    where account_id = p_account and user_id = auth.uid()
  ) or exists (
    select 1 from public.accounts a
    where a.id = p_account
      and (a.csm_user_id = auth.uid() or a.co_user_id = auth.uid())
      and a.deleted_at is null
  );
$$;

-- Helper: roles that always see/edit everything (Admin + Directors + VPs read-write)
create or replace function role_is_global_admin() returns boolean
  language sql stable as $$
  select current_user_role() in ('admin','cs_director','vp_csm','vp_sales');
$$;

-- Helper: read-only-everywhere roles (VP — Solutioning, VP — Inside Sales)
create or replace function role_is_global_reader() returns boolean
  language sql stable as $$
  select current_user_role() in ('vp_solutioning','vp_inside_sales');
$$;

-- ============================================================
-- ENABLE RLS
-- ============================================================
alter table users                       enable row level security;
alter table teams                       enable row level security;
alter table accounts                    enable row level security;
alter table account_assignments         enable row level security;
alter table account_engagement          enable row level security;
alter table client_contacts             enable row level security;
alter table documents                   enable row level security;
alter table document_links              enable row level security;
alter table account_discovery_summary   enable row level security;
alter table jobs                        enable row level security;
alter table audit_log                   enable row level security;
alter table lookup_categories           enable row level security;
alter table lookup_geographies          enable row level security;
alter table lookup_roles                enable row level security;

-- ============================================================
-- USERS — every authed user can see themselves + admins see all
-- ============================================================
drop policy if exists users_self_select on users;
create policy users_self_select on users for select
  using (id = auth.uid() or role_is_global_admin() or role_is_global_reader());

drop policy if exists users_admin_write on users;
create policy users_admin_write on users for all
  using (current_user_role() = 'admin')
  with check (current_user_role() = 'admin');

-- ============================================================
-- TEAMS — read for all authed; admins write
-- ============================================================
drop policy if exists teams_select on teams;
create policy teams_select on teams for select using (auth.uid() is not null);

drop policy if exists teams_admin_write on teams;
create policy teams_admin_write on teams for all
  using (current_user_role() = 'admin')
  with check (current_user_role() = 'admin');

-- ============================================================
-- LOOKUPS — read for authed; admin write
-- ============================================================
drop policy if exists lookup_cat_read on lookup_categories;
create policy lookup_cat_read on lookup_categories for select using (auth.uid() is not null);
drop policy if exists lookup_cat_admin on lookup_categories;
create policy lookup_cat_admin on lookup_categories for all
  using (current_user_role() = 'admin') with check (current_user_role() = 'admin');

drop policy if exists lookup_geo_read on lookup_geographies;
create policy lookup_geo_read on lookup_geographies for select using (auth.uid() is not null);
drop policy if exists lookup_geo_admin on lookup_geographies;
create policy lookup_geo_admin on lookup_geographies for all
  using (current_user_role() = 'admin') with check (current_user_role() = 'admin');

drop policy if exists lookup_roles_read on lookup_roles;
create policy lookup_roles_read on lookup_roles for select using (auth.uid() is not null);

-- ============================================================
-- ACCOUNTS
-- ============================================================
drop policy if exists accounts_select on accounts;
create policy accounts_select on accounts for select
  using (
    deleted_at is null and (
      role_is_global_admin()
      or role_is_global_reader()
      or csm_user_id = auth.uid()
      or co_user_id = auth.uid()
      or current_user_role() in ('solutioning_manager','inside_sales_manager','commercial_owner')
      or user_assigned_to_account(id)
    )
  );

drop policy if exists accounts_csm_write on accounts;
create policy accounts_csm_write on accounts for update
  using (csm_user_id = auth.uid() and deleted_at is null)
  with check (csm_user_id = auth.uid());

drop policy if exists accounts_admin_write on accounts;
create policy accounts_admin_write on accounts for all
  using (role_is_global_admin())
  with check (role_is_global_admin());

-- ============================================================
-- ACCOUNT_ASSIGNMENTS
-- ============================================================
drop policy if exists assn_select on account_assignments;
create policy assn_select on account_assignments for select
  using (
    role_is_global_admin() or role_is_global_reader()
    or user_id = auth.uid()
    or user_assigned_to_account(account_id)
  );

drop policy if exists assn_admin_write on account_assignments;
create policy assn_admin_write on account_assignments for all
  using (role_is_global_admin())
  with check (role_is_global_admin());

-- ============================================================
-- ACCOUNT_ENGAGEMENT (AK03.a)
-- Solutioning Manager: read-write (per BRD F02)
-- ============================================================
drop policy if exists eng_select on account_engagement;
create policy eng_select on account_engagement for select
  using (
    role_is_global_admin() or role_is_global_reader()
    or current_user_role() in ('solutioning_manager','vp_solutioning')
    or user_assigned_to_account(account_id)
  );

drop policy if exists eng_write on account_engagement;
create policy eng_write on account_engagement for all
  using (
    role_is_global_admin()
    or current_user_role() = 'solutioning_manager'
    or user_assigned_to_account(account_id)
  )
  with check (
    role_is_global_admin()
    or current_user_role() = 'solutioning_manager'
    or user_assigned_to_account(account_id)
  );

-- ============================================================
-- CLIENT_CONTACTS (AK03.b) — same scope as account
-- ============================================================
drop policy if exists contacts_select on client_contacts;
create policy contacts_select on client_contacts for select
  using (
    deleted_at is null and (
      role_is_global_admin() or role_is_global_reader()
      or user_assigned_to_account(account_id)
      or current_user_role() in ('solutioning_manager','vp_solutioning')
    )
  );

drop policy if exists contacts_write on client_contacts;
create policy contacts_write on client_contacts for all
  using (
    role_is_global_admin()
    or user_assigned_to_account(account_id)
    or current_user_role() = 'solutioning_manager'
  )
  with check (
    role_is_global_admin()
    or user_assigned_to_account(account_id)
    or current_user_role() = 'solutioning_manager'
  );

-- ============================================================
-- DOCUMENTS (AK03.c)
-- VPDs writable by Solutioning Manager too
-- ============================================================
drop policy if exists docs_select on documents;
create policy docs_select on documents for select
  using (
    deleted_at is null and (
      role_is_global_admin() or role_is_global_reader()
      or user_assigned_to_account(account_id)
      or current_user_role() in ('solutioning_manager','vp_solutioning')
    )
  );

drop policy if exists docs_write on documents;
create policy docs_write on documents for all
  using (
    role_is_global_admin()
    or user_assigned_to_account(account_id)
    or (kind = 'vpd' and current_user_role() = 'solutioning_manager')
  )
  with check (
    role_is_global_admin()
    or user_assigned_to_account(account_id)
    or (kind = 'vpd' and current_user_role() = 'solutioning_manager')
  );

-- ============================================================
-- DOC_LINKS — same scope as parent doc (via JOIN)
-- ============================================================
drop policy if exists doclinks_select on document_links;
create policy doclinks_select on document_links for select
  using (
    exists (
      select 1 from documents d where d.id = document_id and d.deleted_at is null and (
        role_is_global_admin() or role_is_global_reader()
        or user_assigned_to_account(d.account_id)
        or current_user_role() in ('solutioning_manager','vp_solutioning')
      )
    )
  );

drop policy if exists doclinks_write on document_links;
create policy doclinks_write on document_links for all
  using (
    exists (
      select 1 from documents d where d.id = document_id and (
        role_is_global_admin()
        or user_assigned_to_account(d.account_id)
        or (d.kind = 'vpd' and current_user_role() = 'solutioning_manager')
      )
    )
  )
  with check (
    exists (
      select 1 from documents d where d.id = document_id and (
        role_is_global_admin()
        or user_assigned_to_account(d.account_id)
        or (d.kind = 'vpd' and current_user_role() = 'solutioning_manager')
      )
    )
  );

-- ============================================================
-- ACCOUNT_DISCOVERY_SUMMARY — read-only by users with account access; write by service role only (worker)
-- ============================================================
drop policy if exists ads_select on account_discovery_summary;
create policy ads_select on account_discovery_summary for select
  using (
    role_is_global_admin() or role_is_global_reader()
    or user_assigned_to_account(account_id)
    or current_user_role() in ('solutioning_manager','vp_solutioning')
  );

-- (no write policy — service role bypasses RLS, only the worker writes)

-- ============================================================
-- JOBS — viewable by users with access to the account; writes by service role
-- ============================================================
drop policy if exists jobs_select on jobs;
create policy jobs_select on jobs for select
  using (
    role_is_global_admin() or role_is_global_reader()
    or (account_id is not null and user_assigned_to_account(account_id))
  );

-- ============================================================
-- AUDIT_LOG — admins read all; users see only their own actions
-- ============================================================
drop policy if exists audit_select on audit_log;
create policy audit_select on audit_log for select
  using (
    role_is_global_admin()
    or changed_by_user_id = auth.uid()
  );

-- (no write policy — only service role writes audit_log via SQLAlchemy listeners)
