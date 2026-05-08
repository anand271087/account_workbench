// Phase 1 auth implementation — Supabase Auth (email/password).
// Real wiring lands in M2; this is the interface contract only.

import { supabase } from "./supabase";
import type { AuthProvider, AuthUser } from "./auth";

function mapUser(user: { id: string; email?: string; user_metadata?: Record<string, unknown> } | null): AuthUser | null {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email ?? "",
    fullName: (user.user_metadata?.full_name as string) ?? null,
    role: (user.user_metadata?.role as string) ?? null,
  };
}

export const authProviderSupabase: AuthProvider = {
  async signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    const u = mapUser(data.user);
    if (!u) throw new Error("Sign-in succeeded but no user returned");
    return u;
  },

  async signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  },

  async getCurrentUser() {
    const { data } = await supabase.auth.getUser();
    return mapUser(data.user);
  },

  onAuthChange(cb) {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      cb(mapUser(session?.user ?? null));
    });
    return () => data.subscription.unsubscribe();
  },

  async getAccessToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  },

  async sendPasswordReset(email) {
    const redirectTo = `${window.location.origin}/reset-password`;
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw error;
  },

  async updatePassword(newPassword) {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
  },
};
