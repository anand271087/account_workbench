// Shape persisted on documents.vpd_extracted_fields (jsonb).
// Worker writes the dict returned by claude.py:extract_vpd_fields()
// — proposed_solution + engagement_* + value_themes + value_definition +
// estimated_value_musd + is_stub.

import type { EngagementType } from "./solutioning";

export interface ExtractedVpd {
  proposed_solution: string | null;
  engagement_type: EngagementType | null;
  engagement_duration_months: number | null;
  value_themes: string[];
  value_definition: string | null;
  estimated_value_musd: number | null;
  is_stub: boolean;
}
