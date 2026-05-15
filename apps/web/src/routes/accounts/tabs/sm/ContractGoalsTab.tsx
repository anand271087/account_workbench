// M19 — Success Contract + Goals + Initiatives.
//
// Three-panel layout:
//   1. Success Contract card (3-lock)         — new in M19
//   2. (existing GoalsTab content)            — reused from M15 below the contract
//
// The /goals top-level tab redirects here so this is the single source of
// truth going forward.

import { useAuth } from "@/components/AuthProvider";
import { SuccessContractCard } from "@/components/SuccessContractCard";
import { useAccountFromLayout } from "../../AccountProfileLayout";
import GoalsTab from "../GoalsTab";

export default function ContractGoalsTab() {
  const account = useAccountFromLayout();
  const { me } = useAuth();
  const isAdmin = !!me?.permissions?.is_global_admin;

  return (
    <div className="space-y-4">
      <SuccessContractCard accountId={account.id} isAdmin={isAdmin} />

      {/* Goals & Initiatives — the M15 view, kept as-is for now. */}
      <div>
        <div className="text-[11px] font-bold uppercase tracking-wider text-text-muted mb-2">
          Goals & Initiatives
        </div>
        <GoalsTab />
      </div>
    </div>
  );
}
