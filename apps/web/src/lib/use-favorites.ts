/**
 * useFavoriteAccounts — pinned-account list, persistent across devices.
 *
 * Phase 2 (this): backed by `user_favorites` table via /api/v1/me/favorites.
 *   - Cross-device sync, RLS-protected, server-enforced cap of 10.
 *   - Optimistic update so the star feels instant.
 *
 * Phase 1 leftover (auto-migration): if the browser has Phase-1 localStorage
 * pins from earlier, we POST them to the server on first load, then wipe
 * the local key. One-time, idempotent.
 *
 * Public API of this hook is unchanged from Phase 1 — every caller works.
 */

import { useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "./api";

const LEGACY_KEY_PREFIX = "awb:favorites:"; // Phase-1 localStorage namespace
const MIGRATED_FLAG_PREFIX = "awb:favorites-migrated:";
const MAX_FAVORITES = 10;

interface FavoriteOut {
  id: string;
  name: string;
  slug: string;
  pinned_at: string;
}

export interface FavoriteAccount {
  id: string;
  name: string;
  slug: string;
  pinnedAt: number;
}

/** Old localStorage payload shape, for migration. */
interface LegacyEntry {
  id: string;
  name: string;
  slug: string;
  pinnedAt: number;
}

function legacyKey(userId: string | null | undefined): string {
  return `${LEGACY_KEY_PREFIX}${userId ?? "anon"}`;
}
function migratedFlagKey(userId: string | null | undefined): string {
  return `${MIGRATED_FLAG_PREFIX}${userId ?? "anon"}`;
}

function readLegacy(userId: string | null | undefined): LegacyEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(legacyKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function useFavoriteAccounts(userId: string | null | undefined) {
  const qc = useQueryClient();
  const enabled = !!userId;

  const query = useQuery<FavoriteOut[]>({
    queryKey: ["favorites", userId],
    queryFn: () => api.get<FavoriteOut[]>("/api/v1/me/favorites"),
    enabled,
    staleTime: 60_000,
  });

  // ---- One-shot migration of Phase-1 localStorage entries ----
  useEffect(() => {
    if (!userId || typeof window === "undefined") return;
    if (window.localStorage.getItem(migratedFlagKey(userId))) return;
    const legacy = readLegacy(userId);
    if (legacy.length === 0) {
      window.localStorage.setItem(migratedFlagKey(userId), "1");
      return;
    }
    // Push each to the server (oldest first so newest pin order survives).
    const sorted = [...legacy].sort((a, b) => a.pinnedAt - b.pinnedAt).slice(-MAX_FAVORITES);
    Promise.all(
      sorted.map((e) =>
        api.post(`/api/v1/me/favorites/${e.id}`).catch(() => null /* drop dupes */),
      ),
    ).then(() => {
      try {
        window.localStorage.removeItem(legacyKey(userId));
        window.localStorage.setItem(migratedFlagKey(userId), "1");
      } catch { /* ignore */ }
      qc.invalidateQueries({ queryKey: ["favorites", userId] });
    });
  }, [userId, qc]);

  const pinMutation = useMutation({
    mutationFn: (account: { id: string; name: string; slug: string }) =>
      api.post<FavoriteOut[]>(`/api/v1/me/favorites/${account.id}`),
    // Optimistic — make the star feel instant.
    onMutate: async (account) => {
      await qc.cancelQueries({ queryKey: ["favorites", userId] });
      const prev = qc.getQueryData<FavoriteOut[]>(["favorites", userId]) ?? [];
      const optimistic: FavoriteOut[] = [
        { id: account.id, name: account.name, slug: account.slug, pinned_at: new Date().toISOString() },
        ...prev.filter((p) => p.id !== account.id),
      ].slice(0, MAX_FAVORITES);
      qc.setQueryData(["favorites", userId], optimistic);
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(["favorites", userId], ctx.prev);
    },
    onSuccess: (server) => qc.setQueryData(["favorites", userId], server),
  });

  const unpinMutation = useMutation({
    mutationFn: (id: string) => api.delete<FavoriteOut[]>(`/api/v1/me/favorites/${id}`),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["favorites", userId] });
      const prev = qc.getQueryData<FavoriteOut[]>(["favorites", userId]) ?? [];
      qc.setQueryData(["favorites", userId], prev.filter((p) => p.id !== id));
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(["favorites", userId], ctx.prev);
    },
    onSuccess: (server) => qc.setQueryData(["favorites", userId], server),
  });

  const favorites: FavoriteAccount[] = useMemo(
    () =>
      (query.data ?? []).map((f) => ({
        id: f.id,
        name: f.name,
        slug: f.slug,
        pinnedAt: new Date(f.pinned_at).getTime(),
      })),
    [query.data],
  );

  const isFavorite = (accountId: string) => favorites.some((f) => f.id === accountId);

  const toggle = (account: { id: string; name: string; slug: string }) => {
    if (isFavorite(account.id)) {
      unpinMutation.mutate(account.id);
    } else {
      pinMutation.mutate(account);
    }
  };

  return { favorites, isFavorite, toggle, max: MAX_FAVORITES };
}
