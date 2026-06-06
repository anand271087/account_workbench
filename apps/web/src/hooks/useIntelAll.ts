// 05-Jun · Intelligence & Reports — TanStack Query hook for /intel/all.
// One call fetches every bundle (Account & Subs, Category Watch, Abi,
// SD, Custom Usage, TL, IW, Alerts, Super Users, plus the offline
// placeholders for Cirtuo / nnamu / Upply / Training / NPS). Backend
// caches each bundle for 5 minutes per-worker.

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { IntelAll } from "@/types/intel";
import { periodToWindow } from "@/types/intel";
import { type AccountPeriod } from "@/routes/accounts/AccountProfileLayout";

export function useIntelAll(
  accountId: string,
  period: AccountPeriod,
): UseQueryResult<IntelAll> {
  const window = periodToWindow(period);
  return useQuery<IntelAll>({
    queryKey: ["intel-all", accountId, window],
    queryFn: () =>
      api.get<IntelAll>(`/api/v1/accounts/${accountId}/intel/all?window=${window}`),
    staleTime: 60_000,
    retry: (count, err: unknown) => {
      // Don't auto-retry on 409 (account not mapped to redshift_company_name)
      const status = (err as { status?: number } | null)?.status;
      if (status === 409) return false;
      return count < 2;
    },
  });
}
