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

export interface LeadershipPortfolio {
  renewals: RenewalOutcomeCounts;
  value_delivered: ValueDeliveredTotals;
  overdue_checkpoints: OverdueCheckpoints;
  open_red_flags: OpenRedFlag[];
  generated_at: string;
}
