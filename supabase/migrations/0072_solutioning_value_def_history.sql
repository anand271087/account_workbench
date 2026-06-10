-- 10-Jun-2026 · Value Definition revision history.
--
-- Every time the Solutioning tab's `value_definition` field is overwritten
-- by a fresh VPD upload OR edited by a CSM, push a snapshot onto this
-- column. The frontend renders the list as a right-side panel so the
-- CSM can click any prior version and restore it.
--
-- Schema of each entry (Pydantic ValueDefVersion):
--   {
--     "value":          str,
--     "source":         "vpd" | "user",
--     "edited_by":      uuid | null,        -- null for VPD-driven writes
--     "edited_by_name": str | null,         -- "AI · VPD" or user.full_name
--     "edited_at":      timestamptz,
--     "document_id":    uuid | null         -- VPD document that drove this
--   }
--
-- Append-only — never mutated in place. Default empty array so older
-- rows still parse.

ALTER TABLE account_solutioning
  ADD COLUMN IF NOT EXISTS value_definition_history jsonb
    NOT NULL DEFAULT '[]'::jsonb;
