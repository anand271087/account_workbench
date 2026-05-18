-- M30 — Intelligence & Reports · Analytics section.
--
-- Extends accounts.platform_intel (from migration 0039) with three more
-- top-level keys that power the Analytics sub-tabs:
--
--   * usage         12-month logins + active users + adoption breakdown
--   * modules       current-period totals + 12-month monthly trend per
--                   module (Market Monitor / Abi / Supplier Discovery /
--                   Downloads / Benchmarks)
--   * super_users   top user roster — logins, CW views, Abi queries,
--                   SD searches, platform hours
--
-- Same single-jsonb pattern as M29 — single column carries the snapshot.
-- Real telemetry ingestion lands in v1.1.

-- ============================================================
-- Mondelez
-- ============================================================
update accounts
set platform_intel = platform_intel || jsonb_build_object(
  'usage', jsonb_build_object(
    'months', jsonb_build_array('Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar'),
    'monthly_logins', jsonb_build_array(165, 180, 192, 210, 220, 245, 260, 275, 280, 305, 290, 312),
    'monthly_active', jsonb_build_array(28, 30, 32, 35, 36, 38, 41, 43, 44, 46, 44, 48),
    'licensed_users', 60,
    'active_seats', 48,
    'inactive_seats', 12
  ),
  'modules', jsonb_build_object(
    'mmd', 184,
    'abi', 312,
    'sd', 96,
    'dl', 142,
    'bm', 73,
    'monthly', jsonb_build_object(
      'mmd', jsonb_build_array(11, 12, 14, 14, 15, 16, 17, 17, 18, 18, 16, 16),
      'abi', jsonb_build_array(18, 21, 22, 23, 25, 27, 28, 28, 30, 30, 30, 30),
      'sd',  jsonb_build_array(6, 7, 7, 8, 8, 9, 9, 9, 9, 9, 8, 7),
      'dl',  jsonb_build_array(10, 11, 11, 12, 12, 12, 12, 13, 13, 12, 12, 12),
      'bm',  jsonb_build_array(5, 5, 6, 6, 6, 7, 7, 7, 7, 6, 6, 5)
    )
  ),
  'super_users', jsonb_build_array(
    jsonb_build_object('name', 'Jordan Mills', 'role', 'Procurement Lead', 'logins', 152, 'cw_views', 84, 'abi_queries', 38, 'sd_searches', 14, 'hours', 52),
    jsonb_build_object('name', 'Dave Kowalski', 'role', 'Senior Buyer', 'logins', 132, 'cw_views', 68, 'abi_queries', 30, 'sd_searches', 9, 'hours', 36),
    jsonb_build_object('name', 'Ana Reyes', 'role', 'Category Manager — Cocoa', 'logins', 108, 'cw_views', 48, 'abi_queries', 18, 'sd_searches', 22, 'hours', 30),
    jsonb_build_object('name', 'Marcus Chen', 'role', 'VP Procurement', 'logins', 58, 'cw_views', 32, 'abi_queries', 9, 'sd_searches', 3, 'hours', 18),
    jsonb_build_object('name', 'Priya Nair', 'role', 'Sourcing Analyst', 'logins', 48, 'cw_views', 30, 'abi_queries', 6, 'sd_searches', 2, 'hours', 14)
  )
)
where slug = 'mondelez';

-- ============================================================
-- Siemens Energy
-- ============================================================
update accounts
set platform_intel = platform_intel || jsonb_build_object(
  'usage', jsonb_build_object(
    'months', jsonb_build_array('Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar'),
    'monthly_logins', jsonb_build_array(120, 132, 138, 148, 156, 162, 170, 180, 175, 188, 190, 198),
    'monthly_active', jsonb_build_array(22, 24, 25, 27, 28, 30, 32, 33, 32, 34, 33, 36),
    'licensed_users', 50,
    'active_seats', 36,
    'inactive_seats', 14
  ),
  'modules', jsonb_build_object(
    'mmd', 154,
    'abi', 198,
    'sd', 72,
    'dl', 118,
    'bm', 56,
    'monthly', jsonb_build_object(
      'mmd', jsonb_build_array(10, 11, 12, 12, 13, 13, 14, 14, 13, 14, 14, 14),
      'abi', jsonb_build_array(14, 15, 16, 16, 17, 17, 18, 18, 17, 18, 18, 16),
      'sd',  jsonb_build_array(5, 5, 6, 6, 7, 6, 6, 7, 6, 6, 6, 6),
      'dl',  jsonb_build_array(9, 9, 10, 10, 10, 10, 11, 11, 10, 10, 9, 9),
      'bm',  jsonb_build_array(4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 4, 4)
    )
  ),
  'super_users', jsonb_build_array(
    jsonb_build_object('name', 'Klaus Richter', 'role', 'VP Procurement', 'logins', 138, 'cw_views', 74, 'abi_queries', 32, 'sd_searches', 11, 'hours', 44),
    jsonb_build_object('name', 'Tanya Sarna', 'role', 'Procurement Lead', 'logins', 122, 'cw_views', 60, 'abi_queries', 26, 'sd_searches', 7, 'hours', 32),
    jsonb_build_object('name', 'Aditya Pherwani', 'role', 'Senior Buyer', 'logins', 92, 'cw_views', 41, 'abi_queries', 14, 'sd_searches', 18, 'hours', 26),
    jsonb_build_object('name', 'Snehal Rushikesh', 'role', 'Category Manager — Steel', 'logins', 50, 'cw_views', 28, 'abi_queries', 7, 'sd_searches', 3, 'hours', 14),
    jsonb_build_object('name', 'Priya Menon', 'role', 'Sourcing Analyst', 'logins', 40, 'cw_views', 24, 'abi_queries', 4, 'sd_searches', 1, 'hours', 11)
  )
)
where slug = 'siemens-energy';
