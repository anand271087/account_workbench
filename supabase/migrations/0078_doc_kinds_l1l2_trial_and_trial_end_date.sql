-- 12-Jun bugs 231 / 232 / 235 / 236 (Bug_Tracker_12_June.xlsx)
--
-- 231: Pre-Sales needs L1 call / L2 call note+file upload, like MoM.
-- 232: AI should extract Pre-Sales fields from L1/L2 uploads too
--      (worker-side change — same mom-extraction pass keyed on kind).
-- 235: Solutioning needs a Trial Summary upload, like the VPD card.
-- 236: Trial duration captured as Start date + End date. The existing
--      `trial_date` column keeps its data and becomes the START date
--      (label-only change in UI); `trial_end_date` is new.

-- 1) New doc kinds. Same idempotent pattern as 0048.
do $$ begin
  alter type doc_kind add value if not exists 'l1_call';
exception when others then null;
end $$;

do $$ begin
  alter type doc_kind add value if not exists 'l2_call';
exception when others then null;
end $$;

do $$ begin
  alter type doc_kind add value if not exists 'trial_summary';
exception when others then null;
end $$;

-- 2) Trial end date (bug 236). trial_date (0063) is reused as the start.
alter table account_solutioning
  add column if not exists trial_end_date date;

-- 3) Buckets: l1_call / l2_call ride meeting_records; trial_summary
--    rides the vpd bucket. Both exist since 0010 — no new buckets.
