export interface Category {
  id: string;
  name: string;
  parent_id: string | null;
  approved: boolean;
  // Added in migration 0050 — Beroe canonical category list.
  domain: string | null;
  availability: string | null;
}

export interface Geography {
  id: string;
  name: string;
  region: string;
}
