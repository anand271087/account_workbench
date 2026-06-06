-- 05-Jun · Phase 1 Intelligence & Reports — link an AWB account to its
-- canonical Redshift `companyname` so the Intel endpoints can pull live
-- telemetry from tableau_schema / live_ai_incremental.
--
-- AWB names sometimes carry diacritics or suffixes that Redshift doesn't
-- (e.g. AWB "Mondelēz International" vs Redshift "Mondelez International";
-- AWB "Siemens Energy" vs Redshift "Siemens Energy AG"). Rather than
-- normalise at query time, we store the exact Redshift value once per
-- account and the Intel endpoints use it verbatim.
--
-- Idempotent.

alter table accounts
  add column if not exists redshift_company_name text;

comment on column accounts.redshift_company_name is
  'Canonical companyname value used in Redshift tableau_schema / live_ai_incremental — set per-account so the Intelligence & Reports queries can be exact match.';

-- Pre-fill the demo accounts so the endpoints work out of the box for
-- Mondelez / Siemens / Sanofi (matches the values returned by the
-- Redshift companyname probe).
update accounts set redshift_company_name = 'Mondelez International'
  where slug = 'mondelez' and (redshift_company_name is null or redshift_company_name = '');

update accounts set redshift_company_name = 'Siemens Energy AG'
  where slug = 'siemens-energy' and (redshift_company_name is null or redshift_company_name = '');

update accounts set redshift_company_name = 'Sanofi'
  where slug = 'sanofi' and (redshift_company_name is null or redshift_company_name = '');
