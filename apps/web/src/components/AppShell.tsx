import type { ReactNode } from "react";

import { useAuth } from "./AuthProvider";
import { ROLE_LABELS } from "@/types/auth";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Common app chrome — sidebar + top bar — wraps every authenticated page. */
export function AppShell({ children, title }: { children: ReactNode; title?: string }) {
  const { me, signOut } = useAuth();
  if (!me) return null;
  const isPath = (p: string) =>
    typeof window !== "undefined" && window.location.pathname.startsWith(p);

  return (
    <div className="flex min-h-screen bg-beroe-bg">
      {/* Sidebar */}
      <aside className="w-56 bg-beroe-navy border-r border-beroe-navy-3 flex flex-col">
        <div className="px-4 py-3 border-b border-beroe-navy-3 flex items-center gap-2">
          <div className="w-7 h-7 bg-gradient-to-br from-beroe-blue to-[#3800CC] rounded-md flex items-center justify-center font-extrabold text-[11px] text-white">
            B
          </div>
          <div>
            <div className="text-white text-[13px] font-extrabold tracking-wider">BEROE</div>
            <div className="text-[9px] text-[#2a4060]">Account Work Bench</div>
          </div>
        </div>
        <nav className="flex-1 px-2 pt-3">
          <div className="text-[9px] uppercase tracking-widest text-[#1e3a6c] font-bold px-2 pb-1">
            Workspace
          </div>
          <a
            href="/accounts"
            className={cn(
              "flex items-center gap-2 px-3 py-2 rounded-md text-[12px] font-bold",
              isPath("/accounts")
                ? "text-white bg-[#001e52]"
                : "text-[#9eb3cc] hover:text-white",
            )}
          >
            <span>📋</span> Accounts
          </a>

          {me.permissions.is_global_admin && (
            <>
              <div className="text-[9px] uppercase tracking-widest text-[#1e3a6c] font-bold px-2 pb-1 pt-4">
                Admin
              </div>
              <a
                href="/admin/users"
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-md text-[12px] font-bold",
                  isPath("/admin/users")
                    ? "text-white bg-[#001e52]"
                    : "text-[#9eb3cc] hover:text-white",
                )}
              >
                <span>👥</span> Users
              </a>
            </>
          )}
        </nav>
        <div className="border-t border-beroe-navy-3 p-3 flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-beroe-blue/30 border-2 border-beroe-blue flex items-center justify-center text-[9px] font-bold text-white">
            {initials(me.user.full_name || me.user.email)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] text-[#d0dcea] font-semibold truncate">
              {me.user.full_name || me.user.email}
            </div>
            <div className="text-[9px] text-[#2a4060]">{ROLE_LABELS[me.user.role]}</div>
          </div>
          <button
            onClick={() => signOut()}
            className="text-[#2a4060] hover:text-white text-sm leading-none"
            title="Sign out"
          >
            ⏻
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {title && (
          <div className="bg-white border-b border-slate-200 px-6 py-3">
            <h1 className="text-base font-bold text-text-primary">{title}</h1>
          </div>
        )}
        <div className="flex-1 overflow-auto">{children}</div>
      </main>
    </div>
  );
}
