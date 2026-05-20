-- M16.1 — surfaces the remaining MoM-extraction account-header fields on
-- accounts so the apply step in MomExtractionReview.tsx can land them with
-- a single PATCH /accounts/:id call. industry / country / tier already
-- exist; we just need the 3 below.

alter table accounts
  add column if not exists headquarters text;

alter table accounts
  add column if not exists annual_revenue_text text;

alter table accounts
  add column if not exists sf_link text;
