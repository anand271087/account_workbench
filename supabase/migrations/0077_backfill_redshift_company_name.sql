-- 0077_backfill_redshift_company_name.sql
--
-- One-shot backfill: set accounts.redshift_company_name = accounts.name
-- for the 5 accounts imported via the bulk XLSX (PR #5). The importer
-- did not populate this field, leaving the Analytics tab blank because
-- the /intel/* endpoints 409 when redshift_company_name is null.
--
-- Live Redshift verification 12-Jun confirmed all 5 names match
-- `tableau_schema.activity_per_user.companyname` exactly:
--
--   TAKEDA PHARMACEUTICAL CO.        ✓
--   BP P.L.C. (ULTIMATE PARENT)      ✓
--   Prestige Brands, Inc.            ✓
--   Idorsia (Actelion)               ✓
--   ABN Group                        ✓
--
-- Idempotent — only updates rows where redshift_company_name is null,
-- so re-running is a no-op and any admin override is preserved.

update accounts
set redshift_company_name = name
where redshift_company_name is null
  and deleted_at is null
  and name in (
    'TAKEDA PHARMACEUTICAL CO.',
    'BP P.L.C. (ULTIMATE PARENT)',
    'Prestige Brands, Inc.',
    'Idorsia (Actelion)',
    'ABN Group'
  );
