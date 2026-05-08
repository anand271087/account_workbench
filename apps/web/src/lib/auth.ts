// Auth provider abstraction.
//
// Phase 1 implementation: Supabase Auth (email/password) — see auth-supabase.ts.
// Phase 2 implementation: Beroe SSO — drop in auth-sso.ts and swap the export below.
//
// The rest of the app imports `authProvider` from this file. Switching providers
// is a one-line change here, not a refactor.

import { authProviderSupabase } from "./auth-supabase";

export interface AuthUser {
  id: string;
  email: string;
  fullName: string | null;
  role: string | null;
}

export interface AuthProvider {
  signIn(email: string, password: string): Promise<AuthUser>;
  signOut(): Promise<void>;
  getCurrentUser(): Promise<AuthUser | null>;
  onAuthChange(cb: (user: AuthUser | null) => void): () => void;
  getAccessToken(): Promise<string | null>;
  /** BRD AC-4 — request a password-reset email (30-min link). */
  sendPasswordReset(email: string): Promise<void>;
  /** Called from /reset-password page after user clicks email link. */
  updatePassword(newPassword: string): Promise<void>;
}

export const authProvider: AuthProvider = authProviderSupabase;
