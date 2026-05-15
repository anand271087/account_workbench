import { Routes, Route, Navigate, useSearchParams, useNavigate } from "react-router-dom";

import { RequireAuth } from "@/components/RequireAuth";
import LoginPage from "@/routes/_auth/login";
import ResetPasswordPage from "@/routes/_auth/reset-password";
import AccountListPage from "@/routes/accounts/AccountListPage";
import AccountProfileLayout from "@/routes/accounts/AccountProfileLayout";
import AccountKitLayout from "@/routes/accounts/AccountKitLayout";
import SuccessManagementLayout from "@/routes/accounts/SuccessManagementLayout";
import VDDTab from "@/routes/accounts/tabs/sm/VDDTab";
import ContractGoalsTab from "@/routes/accounts/tabs/sm/ContractGoalsTab";
import ValueTrackingTab from "@/routes/accounts/tabs/sm/ValueTrackingTab";
import CheckpointsTab from "@/routes/accounts/tabs/sm/CheckpointsTab";
import DeliveryRenewalTab from "@/routes/accounts/tabs/sm/DeliveryRenewalTab";
import BriefTab from "@/routes/accounts/tabs/BriefTab";
import CSOnboardingTab from "@/routes/accounts/tabs/CSOnboardingTab";
import GoalsTab from "@/routes/accounts/tabs/GoalsTab";
import OverviewTab from "@/routes/accounts/tabs/OverviewTab";
import PreSalesTab from "@/routes/accounts/tabs/PreSalesTab";
import ContactsTab from "@/routes/accounts/tabs/ContactsTab";
import SalesHandoffTab from "@/routes/accounts/tabs/SalesHandoffTab";
import SolutioningTab from "@/routes/accounts/tabs/SolutioningTab";
import UsersPage from "@/routes/admin/UsersPage";
import CategoriesPage from "@/routes/admin/CategoriesPage";
import { useAuth } from "@/components/AuthProvider";
import { ValueDefinitionPlaceholder } from "@/routes/accounts/tabs/PlaceholderTab";

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { me, isLoading } = useAuth();
  if (isLoading) return null;
  if (!me?.permissions.is_global_admin) {
    return <Navigate to="/access-denied" replace />;
  }
  return <>{children}</>;
}

function AccessDenied() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const from = params.get("from");
  const detail = params.get("detail");
  return (
    <div className="min-h-screen flex items-center justify-center bg-beroe-bg p-6">
      <div className="bg-white border border-slate-200 rounded-2xl p-8 max-w-md text-center shadow-sm">
        <div className="text-4xl mb-3">🚫</div>
        <h1 className="text-lg font-bold text-text-primary mb-2">Access denied</h1>
        <p className="text-sm text-text-secondary">
          Your role doesn’t have permission to view this resource.
        </p>
        {detail && (
          <p className="mt-3 text-xs text-text-muted bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
            {detail}
          </p>
        )}
        {from && (
          <p className="mt-3 text-[11px] text-text-muted">
            Tried to open: <code>{from}</code>
          </p>
        )}
        <button
          onClick={() => nav("/accounts")}
          className="mt-5 px-4 py-1.5 rounded-lg bg-beroe-blue text-white text-sm font-semibold"
        >
          Back to accounts
        </button>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/access-denied" element={<AccessDenied />} />
      <Route
        path="/accounts"
        element={
          <RequireAuth>
            <AccountListPage />
          </RequireAuth>
        }
      />
      <Route
        path="/admin/users"
        element={
          <RequireAuth>
            <RequireAdmin>
              <UsersPage />
            </RequireAdmin>
          </RequireAuth>
        }
      />
      <Route
        path="/admin/categories"
        element={
          <RequireAuth>
            <RequireAdmin>
              <CategoriesPage />
            </RequireAdmin>
          </RequireAuth>
        }
      />
      <Route
        path="/accounts/:accountId"
        element={
          <RequireAuth>
            <AccountProfileLayout />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="overview" replace />} />
        <Route path="overview" element={<OverviewTab />} />

        {/* M17 — Account Kit group: Pre-Sales / Brief / Solutioning / Sales Handoff / CS Onboarding */}
        <Route path="account-kit" element={<AccountKitLayout />}>
          <Route index element={<Navigate to="pre-sales" replace />} />
          <Route path="pre-sales"     element={<PreSalesTab />} />
          <Route path="brief"         element={<BriefTab />} />
          <Route path="solutioning"   element={<SolutioningTab />} />
          <Route path="sales-handoff" element={<SalesHandoffTab />} />
          <Route path="cs-onboarding" element={<CSOnboardingTab />} />
        </Route>

        {/* Back-compat: old deep links → new Account Kit URLs */}
        <Route path="pre-sales"     element={<Navigate to="../account-kit/pre-sales"     replace />} />
        <Route path="brief"         element={<Navigate to="../account-kit/brief"         replace />} />
        <Route path="solutioning"   element={<Navigate to="../account-kit/solutioning"   replace />} />
        <Route path="sales-handoff" element={<Navigate to="../account-kit/sales-handoff" replace />} />
        <Route path="cs-onboarding" element={<Navigate to="../account-kit/cs-onboarding" replace />} />
        <Route path="documents"     element={<Navigate to="../account-kit/pre-sales"     replace />} />

        {/* M18 — Success Management group: VDD / Contract+Goals / Value Tracking / Checkpoints / Delivery+Renewal */}
        <Route path="success-management" element={<SuccessManagementLayout />}>
          <Route index element={<Navigate to="vdd" replace />} />
          <Route path="vdd"               element={<VDDTab />} />
          <Route path="contract-goals"    element={<ContractGoalsTab />} />
          <Route path="value-tracking"    element={<ValueTrackingTab />} />
          <Route path="checkpoints"       element={<CheckpointsTab />} />
          <Route path="delivery-renewal"  element={<DeliveryRenewalTab />} />
        </Route>

        <Route path="contacts" element={<ContactsTab />} />
        <Route path="value-def" element={<ValueDefinitionPlaceholder />} />
        <Route path="goals" element={<GoalsTab />} />
      </Route>
      <Route path="/" element={<Navigate to="/accounts" replace />} />
      <Route path="*" element={<Navigate to="/accounts" replace />} />
    </Routes>
  );
}
