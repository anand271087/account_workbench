// Typed fetch client for the FastAPI backend.
// Attaches the Supabase JWT to every request automatically.

import { authProvider } from "./auth";

const BASE = import.meta.env.VITE_API_BASE_URL;

if (!BASE) {
  throw new Error("Missing VITE_API_BASE_URL — copy apps/web/.env.example to apps/web/.env");
}

export class ApiError extends Error {
  status: number;
  data: unknown;
  constructor(status: number, message: string, data?: unknown) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await authProvider.getAccessToken();
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const r = await fetch(`${BASE}${path}`, { ...init, headers });

  if (!r.ok) {
    let body: unknown = null;
    try {
      body = await r.json();
    } catch {
      /* swallow */
    }
    const detail =
      (body as { detail?: string } | null)?.detail || `HTTP ${r.status}`;
    // BRD §3.2 — RBAC denials must land on the access-denied page.
    // We don't redirect on every 403 (modals etc. handle their own state),
    // only when the path looks like a top-level navigation away from the
    // current view. The hash on `?` lets pages opt out by suppressing.
    if (r.status === 403 && typeof window !== "undefined") {
      const here = window.location.pathname;
      if (!here.startsWith("/access-denied") && !here.startsWith("/login")) {
        const params = new URLSearchParams({ from: here, detail: detail.slice(0, 200) });
        window.dispatchEvent(new CustomEvent("awb:forbidden", { detail: { path: here, message: detail } }));
        // Soft-redirect via history; AppShell listens and React Router picks it up.
        window.history.pushState({}, "", `/access-denied?${params.toString()}`);
        window.dispatchEvent(new PopStateEvent("popstate"));
      }
    }
    throw new ApiError(r.status, detail, body);
  }

  if (r.status === 204) return undefined as T;
  return (await r.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: "GET" }),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  // DELETE accepts an optional body — needed for soft-delete endpoints
  // that capture a mandatory reason (e.g. /api/v1/cs-goals/:id).
  delete: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "DELETE",
      body: body ? JSON.stringify(body) : undefined,
    }),
};
