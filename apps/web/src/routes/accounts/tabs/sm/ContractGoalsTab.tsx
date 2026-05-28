// M19 — Success Contract + Goals + Initiatives.
//
// 28-May — restyled to match prototype/beroe_awb_v20.html
// bContractAndGoals (line 3041-3268) and Beroe brand palette.
//
// Layout:
//   1. SuccessContractCard — locked or 3-lock draft editor (prototype
//      line 3115-3170). Auto-draft banner included inside the card.
//   2. Goals & Initiatives section — Aqua uppercase heading matching
//      VDD's section style (prototype line 3173-3174). GoalsTab content
//      below.

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

      {/* Goals & Initiatives — Aqua section heading matches the VDD
          tab's heading vocabulary so all SM tabs share one visual
          rhythm. Heading colour ported from prototype line 3397
          (#35E1D4 Aqua, already on the Beroe brand palette). */}
      <div>
        <div
          className="text-[11px] font-bold uppercase mb-2"
          style={{ color: "#35E1D4", letterSpacing: "0.05em" }}
        >
          Goals &amp; Initiatives
        </div>
        <GoalsTab />
      </div>
    </div>
  );
}
