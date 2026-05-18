-- M29 — Intelligence & Reports · Intelligence section.
--
-- accounts.platform_intel jsonb stores the per-account platform
-- intelligence snapshot that powers the 6 sub-tabs:
--   * cat_intel        Category Watch
--   * supplier_watch   Supplier Watch
--   * abi              Abi Engagement (query stats + complexity mix)
--   * benchmark        Industry Benchmark averages
--   * engagement       Engagement Activeness + user segmentation
--   * nps              NPS score + Voice-of-Customer testimonials
--
-- Single column rather than 6 tables because:
--   - data shape evolves with the prototype every iteration
--   - it's read 1:1 from the Intelligence tab (no cross-account queries)
--   - real ingestion (platform telemetry pipeline) lands in v1.1; for
--     now the column carries seeded demo content per account
--
-- Seeded values for two demo accounts (Mondelez + Siemens Energy) so
-- the tab has non-empty content for stakeholder reviews.

alter table accounts
  add column if not exists platform_intel jsonb not null default '{}'::jsonb;

alter table accounts
  drop constraint if exists chk_accounts_platform_intel_object;
alter table accounts
  add constraint chk_accounts_platform_intel_object
  check (jsonb_typeof(platform_intel) = 'object');

-- ============================================================
-- Demo seed: Mondelez
-- ============================================================
update accounts
set platform_intel = jsonb_build_object(
  'cat_intel', jsonb_build_object(
    'section_avg', jsonb_build_object(
      'price', 4.8, 'supplier', 3.2, 'market', 2.6,
      'forecast', 5.4, 'risk', 1.9
    ),
    'top_cats', jsonb_build_array(
      jsonb_build_object('name', 'Cocoa', 'visits', 62, 'heat', 'hot'),
      jsonb_build_object('name', 'Palm Oil', 'visits', 41, 'heat', 'warm'),
      jsonb_build_object('name', 'Wheat', 'visits', 28, 'heat', 'warm'),
      jsonb_build_object('name', 'Sugar', 'visits', 17, 'heat', 'whitespace'),
      jsonb_build_object('name', 'Packaging (Glass)', 'visits', 5, 'heat', 'cold')
    ),
    'insights', jsonb_build_array(
      jsonb_build_object('text', 'Cocoa is the dominant category — 5 of last 10 Power-BI exports referenced cocoa benchmarks.', 'tone', 'ok'),
      jsonb_build_object('text', 'Wheat usage growing 30% MoM — opportunity to introduce spec harmonisation play.', 'tone', 'warn'),
      jsonb_build_object('text', 'Packaging (Glass) is whitespace — no platform visits last 90 days.', 'tone', 'red')
    )
  ),
  'supplier_watch', jsonb_build_object(
    'tracked', 47,
    'by_risk', jsonb_build_object('high', 5, 'med_high', 9, 'med', 18, 'low', 15),
    'suppliers', jsonb_build_array(
      jsonb_build_object('name', 'Olam Cocoa', 'cat', 'Cocoa', 'country', 'Côte d''Ivoire', 'risk', 'high'),
      jsonb_build_object('name', 'Cargill', 'cat', 'Palm Oil', 'country', 'Singapore', 'risk', 'med_high'),
      jsonb_build_object('name', 'Wilmar International', 'cat', 'Palm Oil', 'country', 'Singapore', 'risk', 'med'),
      jsonb_build_object('name', 'ADM', 'cat', 'Wheat', 'country', 'USA', 'risk', 'low'),
      jsonb_build_object('name', 'Tate & Lyle', 'cat', 'Sugar', 'country', 'United Kingdom', 'risk', 'med')
    )
  ),
  'abi', jsonb_build_object(
    'total_queries', 312,
    'queries_per_user', 5.2,
    'resolution_rate', '94%',
    'avg_response', '< 4h (L1)',
    'complexity_mix', jsonb_build_object('l1a', 110, 'l1m', 84, 'l2', 67, 'l3', 38, 'l4', 13),
    'top_types', jsonb_build_array(
      'Price benchmark', 'Supplier shortlist',
      'Forecast & forward curve', 'Risk alert lookup',
      'Should-cost model'
    ),
    'insight', 'Cocoa-related queries make up 38% of the Abi pull this quarter — Procurement Lead is actively triangulating on benchmarks before the Q3 renegotiation.'
  ),
  'benchmark', jsonb_build_object(
    'avg_health', 70,
    'avg_seat_pct', 62,
    'avg_abi', 220,
    'avg_logins', 240,
    'avg_engagement', 38
  ),
  'engagement', jsonb_build_object(
    'alerts', 84,
    'newsletters', 72,
    'webinars', 9,
    'podcasts', 4,
    'training', 12,
    'user_segmentation', jsonb_build_object(
      'cat_managers', 12, 'buyers', 18, 'sourcing_analysts', 7,
      'directors', 4, 'exec_team', 2, 'coe', 1, 'cpo', 1
    )
  ),
  'nps', jsonb_build_object(
    'score', 64,
    'voc', jsonb_build_array(
      jsonb_build_object(
        'quote', 'Beroe''s cocoa benchmark is the most reliable third-party reference we use. Saved us at least $1.4M this quarter.',
        'author', 'Jordan Mills', 'role', 'Procurement Lead — Commodities',
        'sentiment', 'positive', 'date', '2026-04-12'
      ),
      jsonb_build_object(
        'quote', 'The forecast widget needs to expose downside scenarios more clearly — we asked Olam for one and got blank stares.',
        'author', 'Dave Kowalski', 'role', 'Senior Buyer — Packaging',
        'sentiment', 'neutral', 'date', '2026-03-28'
      )
    )
  )
)
where slug = 'mondelez';

-- ============================================================
-- Demo seed: Siemens Energy
-- ============================================================
update accounts
set platform_intel = jsonb_build_object(
  'cat_intel', jsonb_build_object(
    'section_avg', jsonb_build_object(
      'price', 3.4, 'supplier', 4.1, 'market', 3.0,
      'forecast', 2.8, 'risk', 4.8
    ),
    'top_cats', jsonb_build_array(
      jsonb_build_object('name', 'Steel (HRC)', 'visits', 54, 'heat', 'hot'),
      jsonb_build_object('name', 'Copper', 'visits', 38, 'heat', 'warm'),
      jsonb_build_object('name', 'Aluminium', 'visits', 22, 'heat', 'warm'),
      jsonb_build_object('name', 'Transformer Oil', 'visits', 9, 'heat', 'whitespace'),
      jsonb_build_object('name', 'Switchgear', 'visits', 2, 'heat', 'cold')
    ),
    'insights', jsonb_build_array(
      jsonb_build_object('text', 'Steel HRC dominates pulls — Phase 2 SRM benchmarks tie back to it.', 'tone', 'ok'),
      jsonb_build_object('text', 'Transformer Oil usage near zero despite being in scope — training gap.', 'tone', 'warn')
    )
  ),
  'supplier_watch', jsonb_build_object(
    'tracked', 32,
    'by_risk', jsonb_build_object('high', 4, 'med_high', 6, 'med', 14, 'low', 8),
    'suppliers', jsonb_build_array(
      jsonb_build_object('name', 'ArcelorMittal', 'cat', 'Steel', 'country', 'Luxembourg', 'risk', 'med_high'),
      jsonb_build_object('name', 'Aurubis', 'cat', 'Copper', 'country', 'Germany', 'risk', 'med'),
      jsonb_build_object('name', 'Norsk Hydro', 'cat', 'Aluminium', 'country', 'Norway', 'risk', 'low'),
      jsonb_build_object('name', 'Nynas', 'cat', 'Transformer Oil', 'country', 'Sweden', 'risk', 'high')
    )
  ),
  'abi', jsonb_build_object(
    'total_queries', 198,
    'queries_per_user', 3.7,
    'resolution_rate', '88%',
    'avg_response', '< 6h (L1)',
    'complexity_mix', jsonb_build_object('l1a', 72, 'l1m', 54, 'l2', 38, 'l3', 24, 'l4', 10),
    'top_types', jsonb_build_array(
      'Price benchmark', 'Should-cost model',
      'Supplier shortlist', 'Risk alert lookup',
      'Geopolitical exposure'
    ),
    'insight', 'Risk-flavoured queries spiked 40% after Q2 — geopolitics in Eastern Europe is driving the procurement team to re-validate alternate suppliers.'
  ),
  'benchmark', jsonb_build_object(
    'avg_health', 68,
    'avg_seat_pct', 55,
    'avg_abi', 180,
    'avg_logins', 200,
    'avg_engagement', 32
  ),
  'engagement', jsonb_build_object(
    'alerts', 58,
    'newsletters', 50,
    'webinars', 7,
    'podcasts', 3,
    'training', 9,
    'user_segmentation', jsonb_build_object(
      'cat_managers', 9, 'buyers', 14, 'sourcing_analysts', 6,
      'directors', 3, 'exec_team', 1, 'coe', 1, 'cpo', 0
    )
  ),
  'nps', jsonb_build_object(
    'score', 38,
    'voc', jsonb_build_array(
      jsonb_build_object(
        'quote', 'The risk-signal feed is genuinely useful — caught the Transformer Oil shortage two weeks before our own audit did.',
        'author', 'Klaus Richter', 'role', 'VP Procurement',
        'sentiment', 'positive', 'date', '2026-04-02'
      ),
      jsonb_build_object(
        'quote', 'SSO rollout took longer than expected. Adoption is climbing now but Q1 was painful.',
        'author', 'Priya Menon', 'role', 'Category Manager — Industrial',
        'sentiment', 'negative', 'date', '2026-02-18'
      )
    )
  )
)
where slug = 'siemens-energy';
