import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { authProvider, type AuthUser } from "@/lib/auth";
import type { MeResponse } from "@/types/auth";

interface AuthCtx {
  /** Supabase auth user — null until we know, undefined while initial check runs. */
  authUser: AuthUser | null | undefined;
  /** Server-confirmed me (user + permissions). Null when not signed in or 403. */
  me: MeResponse | null | undefined;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Manually refresh `me` after a role change, etc. */
  refreshMe: () => void;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authUser, setAuthUser] = useState<AuthUser | null | undefined>(undefined);

  // Initial session check + subscribe to changes.
  useEffect(() => {
    authProvider.getCurrentUser().then(setAuthUser);
    const unsub = authProvider.onAuthChange((u) => setAuthUser(u));
    return () => unsub();
  }, []);

  // Fetch /me once we have an authUser.
  const meQuery = useQuery<MeResponse | null>({
    queryKey: ["me", authUser?.id ?? null],
    queryFn: async () => (authUser ? api.get<MeResponse>("/api/v1/me") : null),
    enabled: authUser !== undefined,
    staleTime: 60_000,
  });

  const value = useMemo<AuthCtx>(
    () => ({
      authUser,
      me: meQuery.data,
      isLoading: authUser === undefined || (authUser !== null && meQuery.isLoading),
      signIn: async (email, password) => {
        await authProvider.signIn(email, password);
      },
      signOut: async () => {
        await authProvider.signOut();
      },
      refreshMe: () => {
        meQuery.refetch();
      },
    }),
    [authUser, meQuery],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside <AuthProvider>");
  return v;
}

/** Convenience hook for role-based UI gating. Returns false until /me loads. */
export function useHasRole(...roles: string[]): boolean {
  const { me } = useAuth();
  if (!me) return false;
  return roles.includes(me.user.role);
}
