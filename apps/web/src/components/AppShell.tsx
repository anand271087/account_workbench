import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { useAuth } from "./AuthProvider";
import { ROLE_LABELS } from "@/types/auth";
import { initials } from "@/lib/format";
import { useFavoriteAccounts } from "@/lib/use-favorites";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { AccountListResponse } from "@/types/account";

/** Common app chrome — sidebar + top bar — wraps every authenticated page. */
export function AppShell({ children, title }: { children: ReactNode; title?: string }) {
  const { me, signOut } = useAuth();
  const fav = useFavoriteAccounts(me?.user.id);

  // "My portfolio" — accounts where I'm the CSM. Skipped for global readers
  // and admin (their dropdown is "everyone's accounts" — sidebar would be huge).
  const ownsAPortfolio =
    me?.user.role === "csm" || me?.user.role === "cs_team_manager";
  const portfolio = useQuery<AccountListResponse>({
    queryKey: ["sidebar-portfolio", me?.user.id],
    queryFn: () =>
      api.get<AccountListResponse>(
        `/api/v1/accounts?csm_user_id=${me!.user.id}&page_size=10&sort=last_activity_at&sort_dir=desc`,
      ),
    enabled: !!me && ownsAPortfolio,
    staleTime: 60_000,
  });

  if (!me) return null;
  const isPath = (p: string) =>
    typeof window !== "undefined" && window.location.pathname.startsWith(p);
  const currentAccountId =
    typeof window !== "undefined"
      ? window.location.pathname.match(/^\/accounts\/([0-9a-f-]{36})/)?.[1]
      : undefined;

  return (
    <div className="flex min-h-screen bg-beroe-bg font-sans">
      {/* Sidebar — mirrors prototype `.sb` (224px wide, navy bg).
          Bug 5 — fix logout sticking. The aside must be viewport-locked
          (sticky + h-screen) so the bottom footer with the avatar +
          sign-out stays visible while the inner <nav> scrolls. Without
          this the aside grows to match the longer main content and the
          footer slides off-screen on long account lists. */}
      <aside className="w-[224px] bg-beroe-navy border-r border-beroe-navy-4 flex flex-col flex-shrink-0 sticky top-0 h-screen self-start">
        {/* Brand lockup — white Beroe wordmark per brand book page 9
            (white inverted variant on Midnight background). */}
        <div className="px-4 py-3 border-b border-beroe-navy-4">
          <img
            src="/beroe-wordmark-white.svg"
            alt="Beroe"
            className="h-7 w-auto block"
          />
          <div className="text-[10px] text-text-muted mt-1 tracking-wide">
            Account Work Bench
          </div>
        </div>
        <nav className="flex-1 px-2 pt-3 pb-2 overflow-y-auto">
          <SbSection>Workspace</SbSection>
          <SbBtn href="/accounts" icon="📋" active={isPath("/accounts") && !currentAccountId}>
            All accounts
          </SbBtn>

          {/* Pinned (favourites) */}
          <SbSection>Pinned</SbSection>
          {fav.favorites.length === 0 ? (
            <div className="px-2.5 py-1.5 text-[10px] text-[#5a7ea0] leading-snug">
              ★ Star an account to pin it here.
            </div>
          ) : (
            fav.favorites.map((f) => (
              <SbAccount
                key={f.id}
                href={`/accounts/${f.id}/overview`}
                name={f.name}
                active={currentAccountId === f.id}
              />
            ))
          )}

          {/* My portfolio (CSMs only) */}
          {ownsAPortfolio && (
            <>
              <SbSection>My portfolio</SbSection>
              {portfolio.isLoading ? (
                <div className="px-2.5 py-1.5 text-[10px] text-[#5a7ea0]">Loading…</div>
              ) : (portfolio.data?.items.length ?? 0) === 0 ? (
                <div className="px-2.5 py-1.5 text-[10px] text-[#5a7ea0] leading-snug">
                  No accounts assigned to you yet.
                </div>
              ) : (
                portfolio.data!.items.slice(0, 8).map((a) => (
                  <SbAccount
                    key={a.id}
                    href={`/accounts/${a.id}/overview`}
                    name={a.name}
                    active={currentAccountId === a.id}
                  />
                ))
              )}
            </>
          )}

          {/* M24 — Leadership view (director/VP/admin only). */}
          {me.permissions.can_view_leadership && (
            <>
              <SbSection>Leadership</SbSection>
              <SbBtn href="/leadership" icon="📈" active={isPath("/leadership")}>
                Leadership View
              </SbBtn>
            </>
          )}

          {/* LIVE-003 — Admin section is admin-exact (matches RequireAdmin). */}
          {me.permissions.can_view_admin_panel && (
            <>
              <SbSection>Admin</SbSection>
              <SbBtn href="/admin/users" icon="👥" active={isPath("/admin/users")}>Users</SbBtn>
              <SbBtn href="/admin/categories" icon="🏷️" active={isPath("/admin/categories")}>Categories</SbBtn>
            </>
          )}
        </nav>
        <div className="border-t border-beroe-navy-4 px-3 py-3 flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-beroe-blue/30 border-2 border-beroe-blue flex items-center justify-center text-[10px] font-bold text-white shrink-0">
            {initials(me.user.full_name || me.user.email)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[12px] text-white font-semibold truncate">
              {me.user.full_name || me.user.email}
            </div>
            <div className="text-[10px] text-[#9bb0c8]">{ROLE_LABELS[me.user.role]}</div>
          </div>
          <button
            onClick={() => signOut()}
            title="Sign out"
            aria-label="Sign out"
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[#9bb0c8] hover:text-white hover:bg-beroe-navy-4 border border-beroe-navy-4 transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar — title (left) + global search (right).
            Matches prototype/beroe_awb_v20.html line 2363: "Search
            accounts, signals, contacts..." with cmd-K shortcut. */}
        <div className="bg-white border-b border-beroe-card-border px-6 py-2.5 flex items-center justify-between gap-4">
          <h1 className="text-base font-bold text-text-primary whitespace-nowrap">
            {title ?? "Account Work Bench"}
          </h1>
          <GlobalSearch />
        </div>
        <div className="flex-1 overflow-auto">{children}</div>
      </main>
    </div>
  );
}

// ============================================================
// Global search input — top-right of every page.
// Matches prototype line 2363: "Search accounts, signals, contacts..."
// with a ⌘K keyboard shortcut. Submitting navigates to the Account
// List filtered by `?q=<query>`; the existing list page already
// supports searching across name / slug / industry / country / CSM
// email / primary contact name.
// ============================================================

function GlobalSearch() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const ref = useRef<HTMLInputElement | null>(null);

  // Keyboard shortcut: ⌘K (mac) / Ctrl+K (else) focuses the input.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        ref.current?.focus();
        ref.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const isMac =
    typeof navigator !== "undefined" &&
    navigator.platform.toUpperCase().includes("MAC");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const term = q.trim();
        if (!term) return;
        navigate(`/accounts?q=${encodeURIComponent(term)}`);
      }}
      className="relative flex items-center"
    >
      <span className="absolute left-2.5 text-text-muted text-[12px] pointer-events-none">
        🔎
      </span>
      <input
        ref={ref}
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search accounts, signals, contacts…"
        className="text-[12px] rounded-md border border-beroe-card-border bg-beroe-bg/50 hover:bg-white focus:bg-white pl-7 pr-12 py-1.5 w-[280px] sm:w-[340px] focus:outline-none focus:border-beroe-blue focus:ring-1 focus:ring-beroe-blue/30 transition-colors"
      />
      <span
        className="absolute right-2 text-[10px] font-bold text-text-muted bg-white border border-beroe-card-border rounded px-1.5 py-0.5 leading-none pointer-events-none"
        title={isMac ? "⌘K to focus" : "Ctrl+K to focus"}
      >
        {isMac ? "⌘K" : "Ctrl K"}
      </span>
    </form>
  );
}

/** Sidebar section heading. Brightened from the prototype's #1e3a6c so it
 *  stays legible on the navy background — was unreadable in user testing. */
function SbSection({ children }: { children: ReactNode }) {
  return (
    <div className="text-[10px] uppercase tracking-[0.14em] text-[#7a93b3] font-bold px-2 pt-3 pb-1.5">
      {children}
    </div>
  );
}

/** Account row in the sidebar — small avatar + truncated name. */
function SbAccount({
  href,
  name,
  active,
}: {
  href: string;
  name: string;
  active: boolean;
}) {
  return (
    <a
      href={href}
      title={name}
      className={cn(
        "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12px] mb-px transition-colors duration-150 truncate",
        active
          ? "bg-beroe-navy-4 text-white font-bold"
          : "text-[#b0c0d8] hover:bg-beroe-navy-3 hover:text-white",
      )}
    >
      <div
        className={cn(
          "w-5 h-5 rounded text-[9px] font-extrabold flex items-center justify-center shrink-0 border",
          active
            ? "bg-beroe-blue/30 border-beroe-blue text-white"
            : "bg-beroe-navy-3 border-beroe-navy-4 text-[#9bb0c8]",
        )}
      >
        {initials(name)}
      </div>
      <span className="truncate">{name}</span>
    </a>
  );
}

/** Sidebar button — matches prototype `.sb-btn` with brightened idle text. */
function SbBtn({
  href, icon, active, children,
}: { href: string; icon: ReactNode; active: boolean; children: ReactNode }) {
  return (
    <a
      href={href}
      className={cn(
        "w-full flex items-center gap-2 px-2.5 py-[7px] rounded-lg text-[12px] mb-px text-left transition-colors duration-150",
        active
          ? "bg-beroe-navy-4 text-white font-bold shadow-sm"
          : "text-[#b0c0d8] hover:bg-beroe-navy-3 hover:text-white",
      )}
    >
      <span className="text-[13px] leading-none">{icon}</span> {children}
    </a>
  );
}
