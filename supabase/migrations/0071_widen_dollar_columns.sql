-- 10-Jun-2026 · Widen all $-amount Decimal columns to NUMERIC(20, 2).
--
-- Per stakeholder ask: every dollar input across the app must accept
-- raw amounts of any size (procurement spend, ACV, play value,
-- contract ACV) without hitting a Pydantic upper-bound. Pydantic
-- validators already had their `le=` caps removed in this commit;
-- this migration matches by widening the underlying NUMERIC precision
-- so the DB doesn't refuse the same values.
--
-- Old precision summary:
--   account_engagement.procurement_spend_musd  NUMERIC(12, 4)   max ~$10M (in mil-USD) ≈ $10 trillion raw
--   account_solutioning.estimated_value_musd   NUMERIC(10, 2)   max ~$100M
--   accounts.current_acv                       NUMERIC(14, 2)   max ~$1T
--   accounts.target_acv                        NUMERIC(14, 2)   max ~$1T
--   accounts.gate_contract_acv                 NUMERIC(14, 2)   max ~$1T
--   account_plays.value_usd                    NUMERIC(14, 2)   max ~$1T
--
-- New precision: NUMERIC(20, 2) — max ~10^18 ($1 quintillion). Safe
-- for any real-world enterprise procurement-spend number; idempotent
-- via ALTER COLUMN TYPE.
--
-- Existing data is preserved verbatim (PostgreSQL re-casts in place;
-- no precision loss because we keep 2 decimals and only widen
-- the integer side).

ALTER TABLE account_engagement
  ALTER COLUMN procurement_spend_musd TYPE NUMERIC(20, 2);

ALTER TABLE account_solutioning
  ALTER COLUMN estimated_value_musd TYPE NUMERIC(20, 2);

ALTER TABLE accounts
  ALTER COLUMN current_acv TYPE NUMERIC(20, 2);

ALTER TABLE accounts
  ALTER COLUMN target_acv TYPE NUMERIC(20, 2);

ALTER TABLE accounts
  ALTER COLUMN gate_contract_acv TYPE NUMERIC(20, 2);

ALTER TABLE account_plays
  ALTER COLUMN value_usd TYPE NUMERIC(20, 2);
