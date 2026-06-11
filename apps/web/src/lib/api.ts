// Typed fetch client for the FastAPI backend.
// Attaches the Supabase JWT to every request automatically.

import { authProvider } from "./auth";

// Empty string is valid — means all API paths are absolute from the same origin.
// Paths in this codebase already include /api/v1/, so BASE="" works with the
// nginx proxy_pass rule that forwards /api/ to the backend container.
const BASE: string = import.meta.env.VITE_API_BASE_URL ?? "";

if (BASE === undefined || BASE === null) {
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

// FastAPI returns 422 validation errors as { detail: [{loc, msg, type}, ...] }
// — coerce that (or any other shape) into a readable single-line string so the
// frontend toasts never display "[object Object]".
function formatDetail(d: unknown): string | null {
  if (d == null) return null;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) {
    const parts = d
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") {
          const o = item as { loc?: unknown[]; msg?: string; type?: string };
          const field = Array.isArray(o.loc)
            ? o.loc
                .filter((x) => x !== "body" && typeof x !== "number")
                .join(".")
            : "";
          const msg = o.msg || o.type || "invalid";
          return field ? `${field}: ${msg}` : msg;
        }
        try {
          return JSON.stringify(item);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    return parts.length > 0 ? parts.join("; ") : null;
  }
  if (typeof d === "object") {
    const o = d as { msg?: string; message?: string; detail?: unknown };
    if (typeof o.msg === "string") return o.msg;
    if (typeof o.message === "string") return o.message;
    if (o.detail !== undefined) return formatDetail(o.detail);
    try {
      return JSON.stringify(d);
    } catch {
      return null;
    }
  }
  return String(d);
}

async function request<T>(
  path: string,
  init?: RequestInit & { isFormData?: boolean },
): Promise<T> {
  const token = await authProvider.getAccessToken();
  const headers = new Headers(init?.headers);
  // Multipart upload: let the browser set Content-Type (with the boundary).
  // Default to JSON for everything else.
  if (!init?.isFormData) {
    headers.set("Content-Type", "application/json");
  }
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const r = await fetch(`${BASE}${path}`, { ...init, headers });

  if (!r.ok) {
    let body: unknown = null;
    try {
      body = await r.json();
    } catch {
      /* swallow */
    }
    const rawDetail = (body as { detail?: unknown } | null)?.detail;
    const detail = formatDetail(rawDetail) || `HTTP ${r.status}`;
    // BRD §3.2 — RBAC denials should land on /access-denied — but ONLY
    // when the user explicitly tried to view a page they can't see (a GET
    // on the visible route). Background writes (PATCH/POST/DELETE) that
    // 403 should surface a toast on the originating component, not boot
    // the user off the page entirely. 04-Jun bug — CSM was being kicked
    // to Access Denied whenever an auto-PATCH (e.g. extraction auto-
    // apply, brief auto-populate) fired against a write-locked field.
    if (r.status === 403 && typeof window !== "undefined") {
      const method = (init?.method || "GET").toUpperCase();
      const here = window.location.pathname;
      const isReadGet = method === "GET";
      // Heuristic: only redirect when the failed GET path matches the
      // currently-rendered tab. A GET to /users that 403s while the user
      // is browsing /accounts shouldn't yank them off Accounts.
      const isCurrentView =
        isReadGet &&
        // Either the path itself starts with the current URL (e.g.
        // /accounts/123/foo → 403 while on /accounts/123) …
        (path.startsWith("/api/v1" + here) ||
          // … or it's a /me / /users top-level call from a guarded route.
          path === "/api/v1/me");
      if (
        isCurrentView &&
        !here.startsWith("/access-denied") &&
        !here.startsWith("/login")
      ) {
        const params = new URLSearchParams({ from: here, detail: detail.slice(0, 200) });
        window.dispatchEvent(new CustomEvent("awb:forbidden", { detail: { path: here, message: detail } }));
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
  // Multipart upload — e.g. contract document upload (Row 50).
  postForm: <T>(path: string, formData: FormData) =>
    request<T>(path, { method: "POST", body: formData, isFormData: true }),
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
