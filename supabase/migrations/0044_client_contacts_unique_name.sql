-- Defense-in-depth for Bug 4: an earlier batch of Mondelez MoM extractions
-- (May 12, before the route-level dedup landed) left 28 duplicate name rows
-- on client_contacts. Routes/contacts.py:create_contact now blocks new
-- duplicates with a preflight name check, but a partial unique index makes
-- it impossible for any future code path to bypass the rule.
--
-- Shape mirrors `ux_client_contacts_account_email`: case-insensitive on the
-- trimmed value, scoped to a single account, ignored when the row is
-- soft-deleted (so restoring a row is safe — the index only counts live
-- rows).

create unique index if not exists ux_client_contacts_account_name
  on client_contacts (account_id, lower(trim(name)))
  where deleted_at is null;
