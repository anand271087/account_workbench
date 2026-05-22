-- LIVE-004/005/006 — Mondelez Home was rendering "No active signals" + "$0
-- Weighted pipeline" because we never seeded soft_signals / account_plays /
-- success_metrics for the demo accounts. The prototype v20 mock has these;
-- seed them on Mondelez + Siemens so stakeholder demos populate.

-- Mondelez = 22222222, Siemens = 11111111.

-- ============================================================
-- soft_signals — 6 per demo account, mixed type + impact
-- ============================================================

insert into soft_signals (account_id, type, category, signal, description, impact, status, source)
values
  ('22222222-2222-2222-2222-222222222222'::uuid, 'critical', 'commercial',
   'CPO escalated mis-forecast on cocoa', 'October contract priced above market — exec asked for explanation.',
   'critical', 'active', 'CSM call notes'),
  ('22222222-2222-2222-2222-222222222222'::uuid, 'risk', 'product',
   'Champion (Jordan Mills) out for 4 weeks', 'Power user on parental leave; engagement metrics dipped 38%.',
   'high', 'active', 'Slack #cs-mondelez'),
  ('22222222-2222-2222-2222-222222222222'::uuid, 'expansion', 'commercial',
   'Sustainability team requested supplier ESG benchmark', 'New initiative — could unlock Sustainability module upsell.',
   'high', 'active', 'Email thread'),
  ('22222222-2222-2222-2222-222222222222'::uuid, 'positive', 'product',
   'Cocoa price call validated by hedging desk', 'Buyer reported 3.2% favourable swing — wins citation.',
   'medium', 'active', 'Email reply'),
  ('22222222-2222-2222-2222-222222222222'::uuid, 'neutral', 'relationship',
   'New procurement head joining Q3', 'Org shuffle — need rapport-building plan.',
   'medium', 'active', 'LinkedIn post'),
  ('22222222-2222-2222-2222-222222222222'::uuid, 'risk', 'commercial',
   'Renewal procurement RFP timing tight', 'Window is 90 days; legal review burns 30.',
   'high', 'active', 'QBR notes')
on conflict do nothing;

insert into soft_signals (account_id, type, category, signal, description, impact, status, source)
values
  ('11111111-1111-1111-1111-111111111111'::uuid, 'expansion', 'commercial',
   'Transformer core steel volatility unhedged', 'Eastern European supplier exposure flagged in Q2 review.',
   'high', 'active', 'Procurement deck'),
  ('11111111-1111-1111-1111-111111111111'::uuid, 'positive', 'product',
   'Engineering team adopted MMD platform', 'Daily active up 2.5x post-onboarding.',
   'medium', 'active', 'Platform telemetry'),
  ('11111111-1111-1111-1111-111111111111'::uuid, 'risk', 'relationship',
   'Sponsor sentiment softened', 'CFO pushed back on benchmarking value — needs proof point.',
   'high', 'active', 'CSM call notes')
on conflict do nothing;

-- ============================================================
-- account_plays — 6 for Mondelez, 3 for Siemens (mirrors prototype)
-- ============================================================

insert into account_plays (account_id, title, value_usd, prob, when_text, trigger_text, modes, role)
values
  ('22222222-2222-2222-2222-222222222222'::uuid, 'Sustainability module upsell', 180000, 70, 'Q3 2026',
   'Sustainability team explicitly requested supplier ESG benchmark', '{expand}', 'CSM'),
  ('22222222-2222-2222-2222-222222222222'::uuid, 'Cocoa price intelligence renewal at +15%', 95000, 80, 'Q4 2026',
   'Hedging desk validated win — anchors price-rise conversation', '{retain,expand}', 'AE'),
  ('22222222-2222-2222-2222-222222222222'::uuid, 'Custom benchmark report — top 5 commodities', 45000, 60, 'Q3 2026',
   'CPO escalation on cocoa is the wedge', '{retain}', 'CSM'),
  ('22222222-2222-2222-2222-222222222222'::uuid, 'Supplier risk monitoring add-on', 120000, 50, 'Q4 2026',
   'Eastern Europe sourcing review highlighted gap', '{expand}', 'AE'),
  ('22222222-2222-2222-2222-222222222222'::uuid, 'Procurement maturity assessment', 25000, 75, 'Q3 2026',
   'CFO needs proof points before renewal', '{retain}', 'CSM'),
  ('22222222-2222-2222-2222-222222222222'::uuid, 'Multi-year enterprise renewal lock', 280000, 35, 'Q1 2027',
   'Champion return + renewed budget cycle', '{expand}', 'AE')
on conflict do nothing;

insert into account_plays (account_id, title, value_usd, prob, when_text, trigger_text, modes, role)
values
  ('11111111-1111-1111-1111-111111111111'::uuid, 'Transformer steel hedging support', 90000, 70, 'Q3 2026',
   'Volatility flagged by procurement deck', '{expand,retain}', 'CSM'),
  ('11111111-1111-1111-1111-111111111111'::uuid, 'MMD platform tier upgrade', 65000, 65, 'Q4 2026',
   'Engineering team adoption proves ROI', '{expand}', 'AE'),
  ('11111111-1111-1111-1111-111111111111'::uuid, 'Sponsor reset session — CFO proof points', 15000, 80, 'Q3 2026',
   'Sentiment softening — get ahead', '{retain}', 'CSM')
on conflict do nothing;

-- ============================================================
-- success_metrics — 5 per demo account
-- ============================================================

insert into success_metrics (account_id, name, metric_type, unit, target_value, current_value, description)
values
  ('22222222-2222-2222-2222-222222222222'::uuid, 'Documented cocoa savings', 'quantitative', '$',
   '2000000', '1500000', 'Quantified cost avoidance from forecast-led contracts.'),
  ('22222222-2222-2222-2222-222222222222'::uuid, 'Renewal forecast accuracy', 'quantitative', '%',
   '90', '78', 'How close the renewal forecast tracks actuals.'),
  ('22222222-2222-2222-2222-222222222222'::uuid, 'Platform DAU (procurement seats)', 'quantitative', '',
   '14', '11', 'Daily active users on the Mondelez tenant.'),
  ('22222222-2222-2222-2222-222222222222'::uuid, 'Procurement maturity score', 'qualitative', null,
   'high', 'medium', 'CEB-aligned maturity rating from our diagnostic.'),
  ('22222222-2222-2222-2222-222222222222'::uuid, 'Supplier risk coverage', 'quantitative', '%',
   '80', '54', 'Share of tracked suppliers with live risk scores.')
on conflict do nothing;

insert into success_metrics (account_id, name, metric_type, unit, target_value, current_value, description)
values
  ('11111111-1111-1111-1111-111111111111'::uuid, 'Documented commodity savings', 'quantitative', '$',
   '1200000', '900000', 'Steel + aluminium hedging avoided cost.'),
  ('11111111-1111-1111-1111-111111111111'::uuid, 'MMD platform adoption', 'quantitative', '%',
   '60', '42', 'Engineering team licensed-user adoption.'),
  ('11111111-1111-1111-1111-111111111111'::uuid, 'Sponsor engagement', 'qualitative', null,
   'high', 'medium', 'Frequency of CFO / VP interactions.')
on conflict do nothing;
