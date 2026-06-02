// Mirrors apps/api/app/schemas/leadership.py.

export interface RenewalOutcomeCounts {
  renewed: number;
  at_risk: number;
  not_renewed: number;
  undecided: number;
  total: number;
}

export interface ValueDeliveredTotals {
  identified_musd: number;
  committed_musd: number;
  implemented_musd: number;
  contributing_accounts: number;
}

export interface OverdueCheckpointAccount {
  account_id: string;
  account_name: string;
  overdue_count: number;
  oldest_scheduled_date: string | null;
}

export interface OverdueCheckpoints {
  total_overdue: number;
  accounts: OverdueCheckpointAccount[];
}

export interface OpenRedFlag {
  account_id: string;
  account_name: string;
  type: string;
  note: string | null;
  raised_at: string | null;
}

// ============================================================
// Prototype-style additions: per-account list + KPIs + Pipeline.
// Matches prototype/beroe_awb_v20.html Leadership View.
// ============================================================

export interface AccountRow {
  account_id: string;
  name: string;
  slug: string;
  csm_name: string | null;
  co_name: string | null;
  current_acv_usd: number;
  target_acv_usd: number;
  health_score: number | null;
  mode: string | null;
  tier: string | null;
  account_type: string | null;
  dr_outcome: string | null;
  renewal_date: string | null;
  days_to_renewal: number | null;
  success_contract_locked: boolean;
  vdd_locked: boolean;
  overdue_checkpoint_count: number;
  open_red_flag_count: number;
  critical_signal_count: number;
  top_play_title: string | null;
  top_play_value_usd: number;
  top_play_prob: number | null;
}

export interface LeaderKPIs {
  accounts_total: number;
  current_acv_total_usd: number;
  at_risk_acv_usd: number;
  not_renewed_acv_usd: number;
  critical_signals: number;
  overdue_checkpoints_total: number;
  expand_weighted_pipeline_usd: number;
}

export interface PipelinePlay {
  account_id: string;
  account_name: string;
  title: string;
  value_usd: number;
  prob: number;
  weighted_usd: number;
  when_text: string | null;
  role: string | null;
  added_by_name: string | null;
}

export interface PipelineCO {
  co_name: string;
  co_initials: string;
  accounts: string[];
  total_weighted_usd: number;
  plays: PipelinePlay[];
}

export interface LeadershipPortfolio {
  renewals: RenewalOutcomeCounts;
  value_delivered: ValueDeliveredTotals;
  overdue_checkpoints: OverdueCheckpoints;
  open_red_flags: OpenRedFlag[];
  generated_at: string;
  kpis: LeaderKPIs;
  accounts: AccountRow[];
  pipeline_by_co: PipelineCO[];
}
