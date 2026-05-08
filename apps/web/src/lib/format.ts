// Display-formatting helpers shared across pages.

export function formatACV(v: string | null): string {
  if (!v) return "—";
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n.toFixed(0)}`;
}

export function formatRenewalDays(days: number | null): { label: string; tone: "ok" | "warn" | "danger" | "muted" } {
  if (days === null) return { label: "—", tone: "muted" };
  if (days < 0) return { label: `${Math.abs(days)}d overdue`, tone: "danger" };
  if (days <= 30) return { label: `${days}d`, tone: "danger" };
  if (days <= 90) return { label: `${days}d`, tone: "warn" };
  return { label: `${days}d`, tone: "ok" };
}

export function formatRelativeDate(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.floor((now - then) / 1000); // seconds
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  const days = Math.floor(diff / 86400);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export function healthBucket(score: number | null): { label: string; tone: "ok" | "warn" | "danger" | "muted" } {
  if (score === null) return { label: "—", tone: "muted" };
  if (score >= 65) return { label: "Healthy", tone: "ok" };
  if (score >= 48) return { label: "At Risk", tone: "warn" };
  return { label: "Unhealthy", tone: "danger" };
}

export function initials(name: string): string {
  return name
    .replace(/[^A-Za-z ]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}
