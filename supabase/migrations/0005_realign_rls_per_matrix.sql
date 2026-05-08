-- Realign RLS to match Roles_Access_Matrix_Reviewed_05072026.xlsx (canonical source).
--
-- Key shifts from initial 0002_rls_policies.sql:
--   1) VP — Sales is NOT a global admin (was wrongly grouped with admin/cs_director/vp_csm).
--   2) Solutioning Manager loses edit on account_engagement (matrix Q3: "Only sol. Sections").
--   3) audit_log readable by ALL VPs + CS Director (matrix Q6: "All").
--   4) Account-level SELECT is broad: all roles can read all accounts; write-scoping is per-resource.
--      Exception: Commercial Owner sees only their portfolio (own co_user_id) per matrix Q-CO clarification.
--      Exception: CSM/CS Team Manager sees ALL accounts in the LIST (read-only on others); edit only on own/team.

-- ============================================================
-- HELPER FUNCTIONS — replace
-- ============================================================

-- Global admins per matrix = admin, cs_director, vp_csm. (vp_sales removed.)
create or replace function role_is_global_admin() returns boolean
  language sql stable as $$
  select current_user_role() in ('admin','cs_director','vp_csm');
$$;

-- Global readers (read-only across most things) — VPs other than vp_csm
create or replace function role_is_global_reader() returns boolean
  language sql stable as $$
  select current_user_role() in ('vp_sales','vp_solutioning','vp_inside_sales');
$$;

-- New: who can view audit_log
create or replace function role_can_view_audit() returns boolean
  language sql stable as $$
  select current_user_role() in (
    'admin','cs_director','vp_csm','vp_sales','vp_solutioning','vp_inside_sales'
  );
$$;

-- ============================================================
-- ACCOUNTS — broaden SELECT per matrix; tighten edit semantics
-- ============================================================
drop policy if exists accounts_select on accounts;
create policy accounts_select on accounts for select
  using (
    deleted_at is null and (
      role_is_global_admin()
      or role_is_global_reader()
      or current_user_role() in ('csm','cs_team_manager','solutioning_manager','inside_sales_manager')
      or (current_user_role() = 'commercial_owner' and co_user_id = auth.uid())
    )
  );

-- CSM may update own row; CS Team Manager updates rows where csm is on their team.
drop policy if exists accounts_csm_write on accounts;
create policy accounts_csm_write on accounts for update
  using (
    deleted_at is null and (
      (current_user_role() = 'csm' and (csm_user_id = auth.uid() or co_user_id = auth.uid()))
      or (
        current_user_role() = 'cs_team_manager'
        and csm_user_id in (
          select id from public.users where team_id = (
            select team_id from public.users where id = auth.uid()
          ) and team_id is not null
        )
      )
    )
  )
  with check (true);

-- Admin (and only admin per matrix) can reassign owner / full RW
drop policy if exists accounts_admin_write on accounts;
create policy accounts_admin_write on accounts for all
  using (current_user_role() = 'admin')
  with check (current_user_role() = 'admin');

-- (Note: cs_director and vp_csm get write via separate ALL-privilege policy below.)
drop policy if exists accounts_director_write on accounts;
create policy accounts_director_write on accounts for all
  using (current_user_role() in ('cs_director','vp_csm'))
  with check (current_user_role() in ('cs_director','vp_csm'));

-- ============================================================
-- ACCOUNT_ENGAGEMENT (AK03.a) — Solutioning Manager LOSES edit (matrix Q3)
-- ============================================================
drop policy if exists eng_select on account_engagement;
create policy eng_select on account_engagement for select
  using (
    role_is_global_admin() or role_is_global_reader()
    or current_user_role() in ('csm','cs_team_manager','solutioning_manager','inside_sales_manager')
    or (current_user_role() = 'commercial_owner' and exists (
      select 1 from accounts a where a.id = account_id and a.co_user_id = auth.uid()
    ))
  );

drop policy if exists eng_write on account_engagement;
create policy eng_write on account_engagement for all
  using (
    role_is_global_admin()
    or (current_user_role() = 'csm' and exists (
      select 1 from accounts a where a.id = account_id and (a.csm_user_id = auth.uid() or a.co_user_id = auth.uid())
    ))
    or (current_user_role() = 'cs_team_manager' and exists (
      select 1 from accounts a where a.id = account_id and a.csm_user_id in (
        select id from users where team_id = (select team_id from users where id = auth.uid()) and team_id is not null
      )
    ))
    or (current_user_role() = 'inside_sales_manager' and exists (
      select 1 from accounts a where a.id = account_id and a.csm_user_id = auth.uid()
    ))
  )
  with check (
    role_is_global_admin()
    or (current_user_role() = 'csm' and exists (
      select 1 from accounts a where a.id = account_id and (a.csm_user_id = auth.uid() or a.co_user_id = auth.uid())
    ))
    or (current_user_role() = 'cs_team_manager' and exists (
      select 1 from accounts a where a.id = account_id and a.csm_user_id in (
        select id from users where team_id = (select team_id from users where id = auth.uid()) and team_id is not null
      )
    ))
    or (current_user_role() = 'inside_sales_manager' and exists (
      select 1 from accounts a where a.id = account_id and a.csm_user_id = auth.uid()
    ))
  );

-- ============================================================
-- CLIENT_CONTACTS — Solutioning Manager has F (all) per matrix
-- ============================================================
drop policy if exists contacts_select on client_contacts;
create policy contacts_select on client_contacts for select
  using (
    deleted_at is null and (
      role_is_global_admin() or role_is_global_reader()
      or current_user_role() in ('csm','cs_team_manager','solutioning_manager','inside_sales_manager')
      or (current_user_role() = 'commercial_owner' and exists (
        select 1 from accounts a where a.id = account_id and a.co_user_id = auth.uid()
      ))
    )
  );

drop policy if exists contacts_write on client_contacts;
create policy contacts_write on client_contacts for all
  using (
    role_is_global_admin()
    or current_user_role() = 'solutioning_manager'
    or (current_user_role() = 'csm' and exists (
      select 1 from accounts a where a.id = account_id and (a.csm_user_id = auth.uid() or a.co_user_id = auth.uid())
    ))
    or (current_user_role() = 'cs_team_manager' and exists (
      select 1 from accounts a where a.id = account_id and a.csm_user_id in (
        select id from users where team_id = (select team_id from users where id = auth.uid()) and team_id is not null
      )
    ))
    or (current_user_role() = 'inside_sales_manager' and exists (
      select 1 from accounts a where a.id = account_id and a.csm_user_id = auth.uid()
    ))
  )
  with check (true);

-- ============================================================
-- DOCUMENTS — Solutioning Manager F (all) on VPDs and MOMs (matrix)
-- ============================================================
drop policy if exists docs_select on documents;
create policy docs_select on documents for select
  using (
    deleted_at is null and (
      role_is_global_admin() or role_is_global_reader()
      or current_user_role() in ('csm','cs_team_manager','solutioning_manager','inside_sales_manager')
      or (current_user_role() = 'commercial_owner' and exists (
        select 1 from accounts a where a.id = account_id and a.co_user_id = auth.uid()
      ))
    )
  );

drop policy if exists docs_write on documents;
create policy docs_write on documents for all
  using (
    role_is_global_admin()
    or current_user_role() = 'solutioning_manager'
    or (current_user_role() = 'csm' and exists (
      select 1 from accounts a where a.id = account_id and (a.csm_user_id = auth.uid() or a.co_user_id = auth.uid())
    ))
    or (current_user_role() = 'cs_team_manager' and exists (
      select 1 from accounts a where a.id = account_id and a.csm_user_id in (
        select id from users where team_id = (select team_id from users where id = auth.uid()) and team_id is not null
      )
    ))
    or (current_user_role() = 'inside_sales_manager' and exists (
      select 1 from accounts a where a.id = account_id and a.csm_user_id = auth.uid()
    ))
  )
  with check (true);

-- ============================================================
-- AUDIT_LOG — VPs + CS Director see all (matrix Q6: "All")
-- ============================================================
drop policy if exists audit_select on audit_log;
create policy audit_select on audit_log for select
  using (
    role_can_view_audit()
    or changed_by_user_id = auth.uid()
  );
