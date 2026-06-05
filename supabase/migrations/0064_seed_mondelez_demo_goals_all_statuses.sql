-- 05-Jun — demo seed: 5 goals on Mondelez, one per Goal-Validation filter
-- status (Pending · In progress · Ready to freeze · Frozen · Flagged), so
-- stakeholder demos can see every filter populated end-to-end.
--
-- Idempotent: titles prefixed "[DEMO]" — re-running deletes any prior demo
-- rows and re-inserts the fresh batch.

do $$
declare
  v_account_id uuid;
begin
  select id into v_account_id from accounts where slug = 'mondelez';
  if v_account_id is null then
    raise notice 'mondelez account not found — skipping demo seed';
    return;
  end if;

  -- Idempotency — hard-delete prior demo rows (only the [DEMO]-prefixed ones).
  delete from cs_goals
   where account_id = v_account_id
     and title like '[DEMO]%';

  -- =====================================================================
  -- 1. PENDING — no Q answered. Shows under "Needs alignment".
  -- =====================================================================
  insert into cs_goals (
    account_id, title, category, target_value, target_date, owner,
    alignment_status, validation_status,
    phase_a, phase_b, phase_c
  ) values (
    v_account_id,
    '[DEMO] Reduce electronics direct-spend by 6%',
    'cost_reduction',
    '$2.4M',
    '2026-12-31',
    'Anika Sharma',
    'not_started',
    'pending',
    '{}'::jsonb, '{}'::jsonb, '{}'::jsonb
  );

  -- =====================================================================
  -- 2. IN PROGRESS — Q1 + Q2 done, Q3 not. Still "Needs alignment".
  -- =====================================================================
  insert into cs_goals (
    account_id, title, category, target_value, target_date, owner,
    alignment_status, validation_status,
    phase_a, phase_a_completed_at,
    phase_b, phase_b_completed_at,
    phase_c
  ) values (
    v_account_id,
    '[DEMO] Cocoa price hedging — Olam renegotiation',
    'cost_reduction',
    '$1.6M',
    '2026-09-30',
    'Snehal Rushikesh',
    'partial',
    'pending',
    jsonb_build_object(
      'q1_means', jsonb_build_array(
        'Direct unit-price reduction',
        'Cost avoidance (vs market inflation)'
      ),
      'q1_other_text', '',
      'q1_confirmation',
        'Jordan confirmed baseline = FY24 actuals. $1.6M = 2.4% on $68M baseline. Methodology signed off via Q3 QBR.',
      'phase_a_complete', true
    ),
    now() - interval '14 days',
    jsonb_build_object(
      'q2_has_background', 'Yes, partial',
      'q2_done_by', jsonb_build_array('Internal client team', 'Previous Beroe work'),
      'q2_done_by_other', '',
      'q2_background_notes',
        'Mondelez had FY24 baseline data ready. Beroe ran the supplier-side benchmark.',
      'q2_beroe_offer', jsonb_build_array('Benchmarking', 'Inflation Watch'),
      'q2_cadence', 'Monthly Inflation Watch refresh · quarterly benchmark refresh',
      'phase_b_complete', true
    ),
    now() - interval '7 days',
    '{}'::jsonb
  );

  -- =====================================================================
  -- 3. READY TO FREEZE (Aligned) — all 3 Q done, not yet locked.
  -- =====================================================================
  insert into cs_goals (
    account_id, title, category, target_value, target_date, owner,
    alignment_status, validation_status,
    phase_a, phase_a_completed_at,
    phase_b, phase_b_completed_at,
    phase_c, phase_c_completed_at
  ) values (
    v_account_id,
    '[DEMO] Flexible packaging benchmark savings',
    'cost_reduction',
    '$2.4M',
    '2025-12-31',
    'Lisa Chen',
    'aligned',
    'pending',
    jsonb_build_object(
      'q1_means', jsonb_build_array(
        'Direct unit-price reduction',
        'Total cost of ownership reduction'
      ),
      'q1_other_text', '',
      'q1_confirmation',
        'Lisa Chen confirmed 32-supplier list is current. 18% markup matches her internal benchmark.',
      'phase_a_complete', true
    ),
    now() - interval '21 days',
    jsonb_build_object(
      'q2_has_background', 'Yes, complete',
      'q2_done_by', jsonb_build_array('Previous Beroe work'),
      'q2_done_by_other', '',
      'q2_background_notes',
        'Beroe ran a complete benchmark in FY24. Numbers are still current.',
      'q2_beroe_offer', jsonb_build_array(
        'Benchmarking',
        'Should-cost Modeling (Prism)'
      ),
      'q2_cadence', 'Monthly with Lisa · quarterly should-cost refresh',
      'phase_b_complete', true
    ),
    now() - interval '14 days',
    jsonb_build_object(
      'q3_category_focus',
        'Flexible packaging — laminates, films, pouches across 8 plants',
      'q3_baseline', '$13.3M annual spend across 32 suppliers (FY24)',
      'q3_agreed_target', '$2.4M savings (18% on $13.3M)',
      'q3_measure_method',
        'Negotiated price changes vs incumbent, audited by Lisa quarterly',
      'q3_timeline', '2025-12-31',
      'phase_c_complete', true
    ),
    now() - interval '3 days'
  );

  -- =====================================================================
  -- 4. FROZEN — locked, with 3 initiatives at varying stages.
  -- =====================================================================
  insert into cs_goals (
    account_id, title, category, target_value, target_date, owner,
    alignment_status, validation_status,
    phase_a, phase_a_completed_at,
    phase_b, phase_b_completed_at,
    phase_c, phase_c_completed_at,
    initiatives
  ) values (
    v_account_id,
    '[DEMO] Supplier consolidation (Packaging + Vanilla)',
    'enhanced_supplier_discovery',
    '$900,000',
    '2025-12-31',
    'Snehal Rushikesh',
    'aligned',
    'accepted',
    jsonb_build_object(
      'q1_means', jsonb_build_array(
        'Reduce supplier count',
        'Consolidate spend on fewer vendors'
      ),
      'q1_other_text', '',
      'q1_confirmation',
        'Ana confirmed Tier 2/3 redundancies in packaging + vanilla — 12 suppliers, target consolidate to 4.',
      'phase_a_complete', true
    ),
    now() - interval '60 days',
    jsonb_build_object(
      'q2_has_background', 'Yes, partial',
      'q2_done_by', jsonb_build_array('Internal client team', 'Previous Beroe work'),
      'q2_done_by_other', '',
      'q2_background_notes',
        'Procurement team ran initial spend analysis. Beroe ran supplier discovery for vanilla.',
      'q2_beroe_offer', jsonb_build_array(
        'Supplier Discovery',
        'Custom Research / Advisory',
        'Benchmarking'
      ),
      'q2_cadence', 'Bi-weekly with Ana · quarterly review with category council',
      'phase_b_complete', true
    ),
    now() - interval '50 days',
    jsonb_build_object(
      'q3_category_focus',
        'Flexible packaging films + vanilla flavour suppliers',
      'q3_baseline', '12 suppliers across packaging + vanilla',
      'q3_agreed_target',
        '4 strategic suppliers (8 displaced) · $900K savings',
      'q3_measure_method',
        'Validated by Q4 spend audit + signed-off SCM',
      'q3_timeline', '2025-12-31',
      'phase_c_complete', true
    ),
    now() - interval '45 days',
    jsonb_build_array(
      jsonb_build_object(
        'name', 'Q3 Cocoa Price Forecast for Olam renegotiation',
        'status', 'delivered',
        'value_stage', 'implemented',
        'value_target', '$400000',
        'value_delivered', '$320000',
        'client_acknowledged', 'yes',
        'evidence', null,
        'value_fields', jsonb_build_object(
          'id', 'i_demo_1',
          'type', 'Market Intel Report',
          'module', 'LiVE.Ai',
          'owner', 'Snehal Rushikesh',
          'updatedAt', '2024-09-22'
        ),
        'client_data', '[]'::jsonb,
        'value_history', '[]'::jsonb
      ),
      jsonb_build_object(
        'name', 'Wheat spec consolidation analysis',
        'status', 'in_progress',
        'value_stage', 'committed',
        'value_target', '$300000',
        'value_delivered', '$160000',
        'client_acknowledged', 'pending',
        'evidence', null,
        'value_fields', jsonb_build_object(
          'id', 'i_demo_2',
          'type', 'Custom Research',
          'module', 'Custom Credits',
          'owner', 'Snehal Rushikesh',
          'updatedAt', '2024-11-08'
        ),
        'client_data', '[]'::jsonb,
        'value_history', '[]'::jsonb
      ),
      jsonb_build_object(
        'name', 'Sugar Hedging Benchmark',
        'status', 'not_started',
        'value_stage', 'identified',
        'value_target', '$200000',
        'value_delivered', '$0',
        'client_acknowledged', 'pending',
        'evidence', null,
        'value_fields', jsonb_build_object(
          'id', 'i_demo_3',
          'type', 'Benchmarking',
          'module', 'Benchmarking',
          'owner', 'Snehal Rushikesh',
          'updatedAt', '2025-01-10'
        ),
        'client_data', '[]'::jsonb,
        'value_history', '[]'::jsonb
      )
    )
  );

  -- =====================================================================
  -- 5. FLAGGED — Q1 done, but flagged by CSM for client review.
  -- =====================================================================
  insert into cs_goals (
    account_id, title, category, target_value, target_date, owner,
    alignment_status, validation_status, flag_note,
    phase_a, phase_a_completed_at,
    phase_b, phase_c
  ) values (
    v_account_id,
    '[DEMO] EUDR traceability — cocoa & palm oil',
    'esg_responsible_sourcing',
    '100% Tier-2 coverage',
    '2026-12-31',
    'Jordan Mills',
    'partial',
    'flagged',
    'Client legal team requested formal scope memo before signing off on the 100% Tier-2 target. Awaiting Mondelez legal response by 15-Jun.',
    jsonb_build_object(
      'q1_means', jsonb_build_array('Regulatory compliance (EUDR / CSDDD)'),
      'q1_other_text', '',
      'q1_confirmation',
        'Jordan confirmed: regulatory compliance, not nice-to-have. Dec 2026 EUDR is the trigger. 100% traceability is the legal threshold.',
      'phase_a_complete', true
    ),
    now() - interval '10 days',
    jsonb_build_object(
      'q2_has_background', 'Yes, partial',
      'q2_done_by', jsonb_build_array('Internal client team', 'Other consultant'),
      'q2_done_by_other', 'PwC EUDR readiness assessment',
      'q2_beroe_offer', jsonb_build_array(
        'Custom Research / Advisory',
        'Supplier Discovery'
      ),
      'q2_cadence', '',
      'phase_b_complete', false
    ),
    '{}'::jsonb
  );

  raise notice '[DEMO] seeded 5 cs_goals on Mondelez (pending/in-progress/aligned/frozen/flagged)';
end $$;
