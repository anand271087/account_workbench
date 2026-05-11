-- Replace the dummy seed categories with Beroe's canonical list.
--
-- `account_engagement.target_categories` is `text[]` (not FK), so wiping
-- and re-inserting the lookup rows does NOT touch existing engagement
-- selections — those keep their previous category names verbatim. If a
-- legacy engagement references a category that's no longer in the list,
-- the picker just shows it without an "approved" tag.
--
-- All 23 rows below are admin-approved so they appear in the picker
-- immediately (no `/admin/categories` approval step required).

begin;

delete from lookup_categories;

insert into lookup_categories (id, name, approved) values
  (gen_random_uuid(), 'Capex & MRO',                          true),
  (gen_random_uuid(), 'Chemicals',                            true),
  (gen_random_uuid(), 'Industrial Manufacturing and Durables',true),
  (gen_random_uuid(), 'Pharma Directs',                       true),
  (gen_random_uuid(), 'Logistics',                            true),
  (gen_random_uuid(), 'MMM',                                  true),
  (gen_random_uuid(), 'Packaging',                            true),
  (gen_random_uuid(), 'Facilities Management',                true),
  (gen_random_uuid(), 'E&C and Oil and Gas',                  true),
  (gen_random_uuid(), 'Pharma R&D',                           true),
  (gen_random_uuid(), 'IT',                                   true),
  (gen_random_uuid(), 'Agro Commodities and Ingredients',     true),
  (gen_random_uuid(), 'Marketing Services',                   true),
  (gen_random_uuid(), 'GBS',                                  true),
  (gen_random_uuid(), 'HR Services',                          true),
  (gen_random_uuid(), 'Marketing Agency',                     true),
  (gen_random_uuid(), 'Energy and Sustainability',            true),
  (gen_random_uuid(), 'Professional Services and Travel',     true),
  (gen_random_uuid(), 'Others',                               true),
  (gen_random_uuid(), 'IMD',                                  true),
  (gen_random_uuid(), 'Engineering & Construction',           true),
  (gen_random_uuid(), 'Marketing',                            true),
  (gen_random_uuid(), 'Oil and Gas',                          true);

commit;
