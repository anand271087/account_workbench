import { Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";

import { useAuth } from "./AuthProvider";

interface Props {
  children: ReactNode;
  /** If set, only these roles may access the route. */
  roles?: string[];
}

export function RequireAuth({ children, roles }: Props) {
  const { authUser, me, isLoading } = useAuth();
  const loc = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-text-muted text-sm">
        Loading…
      </div>
    );
  }

  if (!authUser) {
    return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  }

  // Auth user exists but not provisioned in public.users → 403 from /me.
  if (!me) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-beroe-bg p-6">
        <div className="bg-white border border-slate-200 rounded-2xl p-8 max-w-md text-center shadow-sm">
          <div className="text-4xl mb-3">🔒</div>
          <h1 className="text-lg font-bold text-text-primary mb-2">Access denied</h1>
          <p className="text-sm text-text-secondary">
            Your account is signed in but isn’t provisioned in this workspace. Contact your admin.
          </p>
        </div>
      </div>
    );
  }

  if (roles && !roles.includes(me.user.role)) {
    return <Navigate to="/access-denied" replace />;
  }

  return <>{children}</>;
}
