export interface Category {
  id: string;
  name: string;
  parent_id: string | null;
  approved: boolean;
}

export interface Geography {
  id: string;
  name: string;
  region: string;
}
