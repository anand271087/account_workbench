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
