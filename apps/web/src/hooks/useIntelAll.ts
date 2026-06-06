// 05-Jun · Intelligence & Reports — TanStack Query hooks.
//
// /intel/all is the full rollup (17 bundles, ~90-120s cold). We use it
// sparingly. Instead, useIntelBundle(...) fetches one section at a
// time so the active sub-tab loads in 5-25s and TanStack Query caches
// each one independently — switching back is instant.

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { IntelAll } from "@/types/intel";
import { periodToWindow } from "@/types/intel";
import { type AccountPeriod } from "@/routes/accounts/AccountProfileLayout";

// Section keys = endpoint paths on /api/v1/accounts/:id/intel/:key
export type IntelSection =
  | "account-subscribers"
  | "category-watch"
  | "abi"
  | "supplier-discovery"
  | "supplier-monitoring"
  | "custom-usage"
  | "thought-leadership"
  | "inflation-watch"
  | "alerts"
  | "super-users";

export function useIntelBundle<T = unknown>(
  accountId: string,
  period: AccountPeriod | undefined,
  section: IntelSection,
  options?: { topN?: number },
): UseQueryResult<T> {
  const window = periodToWindow(period);
  const qs =
    section === "super-users"
      ? `?top_n=${options?.topN ?? 20}`
      : `?window=${window}`;
  return useQuery<T>({
    queryKey: ["intel-bundle", accountId, section, window, options?.topN],
    queryFn: () =>
      api.get<T>(`/api/v1/accounts/${accountId}/intel/${section}${qs}`),
    staleTime: 5 * 60_000, // backend cache TTL is 5 min — match it
    retry: (count, err: unknown) => {
      const status = (err as { status?: number } | null)?.status;
      if (status === 409) return false;
      return count < 1;
    },
  });
}

// Kept for callers that genuinely want every section at once (e.g.
// future Reports view that exports everything). Frontend dashboards
// should prefer useIntelBundle.
export function useIntelAll(
  accountId: string,
  period: AccountPeriod | undefined,
): UseQueryResult<IntelAll> {
  const window = periodToWindow(period);
  return useQuery<IntelAll>({
    queryKey: ["intel-all", accountId, window],
    queryFn: () =>
      api.get<IntelAll>(`/api/v1/accounts/${accountId}/intel/all?window=${window}`),
    staleTime: 5 * 60_000,
    retry: (count, err: unknown) => {
      const status = (err as { status?: number } | null)?.status;
      if (status === 409) return false;
      return count < 1;
    },
  });
}
