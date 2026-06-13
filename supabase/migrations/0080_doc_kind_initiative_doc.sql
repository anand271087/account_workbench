-- 12-Jun bug 250 (Bug_Tracker_12_June.xlsx)
-- "Under Initiatives - there must be an option to upload document."
-- New doc kind for evidence/supporting files attached to a goal
-- initiative. Stored via the regular documents pipeline; the initiative
-- JSONB keeps a lightweight reference {document_id, filename}.
-- Idempotent enum-add, same pattern as 0048 / 0078.

do $$ begin
  alter type doc_kind add value if not exists 'initiative_doc';
exception when others then null;
end $$;

-- Rides the meeting_records bucket (created in 0010) — no new bucket.
