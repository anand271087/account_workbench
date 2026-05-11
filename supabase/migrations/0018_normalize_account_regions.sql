-- Migrate legacy region codes to the canonical list shown in the AK01
-- + New Account dropdown (set in M11):
--
--   North America · Europe · APAC · MEA · Rest of the World · LATAM
--
-- Mapping rationale:
--   AMER  → North America  (Beroe's AMER is overwhelmingly North America;
--                            LATAM is already a separate row)
--   EMEA  → Europe         (closest single-region match; if you need to
--                            distinguish Europe from MEA on specific
--                            accounts, edit them by hand afterwards)
--   APAC  → APAC           (unchanged)
--   LATAM → LATAM          (unchanged)
--
-- Idempotent — re-running is a no-op.

update accounts set region = 'North America' where region = 'AMER';
update accounts set region = 'Europe'        where region = 'EMEA';
