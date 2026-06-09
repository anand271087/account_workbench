-- 09-Jun · sh_first_checkpoint stores a CADENCE LABEL ("30 days" /
-- "45 days" / "60 days"), not an actual date. The Date column type
-- meant every Save sent "30 days" → Pydantic Date validator rejected
-- with "Input should be a valid date or datetime, input is too
-- short" → field could never be saved.
--
-- Convert the column to TEXT. Existing data is empty (the field has
-- never worked) so no preservation needed.
--
-- Idempotent — safe to re-apply.

ALTER TABLE account_solutioning
  ALTER COLUMN sh_first_checkpoint TYPE text USING sh_first_checkpoint::text;
