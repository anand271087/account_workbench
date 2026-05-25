-- Row 50 (25-May-2026) — replace the Client Signed text-only "filename"
-- input with a real file upload + last-3 download dropdown. Files flow
-- through the existing Documents pipeline (M7) with kind='contract'.

-- 1) Add 'contract' to the doc_kind enum.
do $$ begin
  alter type doc_kind add value if not exists 'contract';
exception when others then null;
end $$;

-- 2) The `contracts` storage bucket was created back in 0010 — we reuse
--    that. (Confirmed in CLAUDE.md "M7 — buckets meeting_records, vpd,
--    contracts created in 0010_storage_buckets.sql".) Bucket policies
--    already enforce service-role-only access; signed URLs minted by the
--    API are the regular-user path.
