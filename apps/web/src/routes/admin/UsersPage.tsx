import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/components/AuthProvider";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  ROLE_LABELS,
  type RoleKey,
  type UserInvite,
  type UserOut,
  type UserStatus,
  type UserUpdate,
} from "@/types/auth";

const ALL_ROLES: RoleKey[] = [
  "csm", "cs_team_manager", "cs_director", "vp_csm",
  "commercial_owner", "vp_sales",
  "solutioning_manager", "vp_solutioning",
  "inside_sales_manager", "vp_inside_sales",
  "admin",
];

export default function UsersPage() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const [roleFilter, setRoleFilter] = useState<string>("");
  const [includeDeactivated, setIncludeDeactivated] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<UserOut | null>(null);

  const queryKey = ["admin-users", roleFilter, includeDeactivated];
  const { data, isLoading, isError, error } = useQuery<UserOut[]>({
    queryKey,
    queryFn: () => {
      const qs = new URLSearchParams();
      if (roleFilter) qs.set("role", roleFilter);
      if (includeDeactivated) qs.set("include_deactivated", "true");
      const suffix = qs.toString() ? `?${qs.toString()}` : "";
      return api.get<UserOut[]>(`/api/v1/users${suffix}`);
    },
  });

  const inviteMutation = useMutation({
    mutationFn: (body: UserInvite) => api.post<UserOut>("/api/v1/users", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      setInviting(false);
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: UserUpdate }) =>
      api.patch<UserOut>(`/api/v1/users/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      setEditing(null);
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/v1/users/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-users"] }),
  });

  const resendMutation = useMutation({
    mutationFn: (id: string) => api.post<UserOut>(`/api/v1/users/${id}/resend-invite`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-users"] }),
  });

  return (
    <AppShell>
      <div className="px-6 py-5">
        <div className="flex items-end justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold text-text-primary">Users</h1>
            <p className="text-xs text-text-muted mt-1">
              Invite teammates, set their role and team. Beroe SSO will replace
              the password step in Phase 2 — role assignments stay here either way.
            </p>
          </div>
          <button
            onClick={() => setInviting(true)}
            className="px-3 py-1.5 rounded-lg bg-beroe-blue text-white text-sm font-semibold hover:bg-beroe-blue/90"
          >
            + Invite user
          </button>
        </div>

        <div className="flex items-center gap-3 mb-3">
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white text-text-secondary focus:outline-none focus:border-beroe-blue"
          >
            <option value="">All roles</option>
            {ALL_ROLES.map((r) => (
              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={includeDeactivated}
              onChange={(e) => setIncludeDeactivated(e.target.checked)}
            />
            Show deactivated
          </label>
        </div>

        {isError && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-3 text-sm text-red-800">
            <b>Error</b> — {(error as Error)?.message}
          </div>
        )}
        {isLoading && <div className="text-sm text-text-muted">Loading users…</div>}

        {data && (
          <div className="bg-white rounded-card border border-beroe-card-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-beroe-bg text-text-muted text-[11px] uppercase tracking-wider">
                <tr>
                  <th className="text-left px-4 py-2.5 font-bold">Name</th>
                  <th className="text-left px-4 py-2.5 font-bold">Email</th>
                  <th className="text-left px-4 py-2.5 font-bold">Role</th>
                  <th className="text-left px-4 py-2.5 font-bold">Status</th>
                  <th className="text-right px-4 py-2.5 font-bold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.map((u) => {
                  const isSelf = me?.user.id === u.id;
                  return (
                    <tr key={u.id} className="border-t border-beroe-card-border/60">
                      <td className="px-4 py-3 font-semibold text-text-primary">
                        {u.full_name ?? "—"}
                        {isSelf && <span className="ml-2 text-[10px] text-text-muted">(you)</span>}
                      </td>
                      <td className="px-4 py-3 text-text-secondary text-xs">{u.email}</td>
                      <td className="px-4 py-3">
                        <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-text-secondary font-semibold">
                          {ROLE_LABELS[u.role]}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <StatusPill status={u.status ?? "active"} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-3">
                          {u.status === "pending" && (
                            <button
                              onClick={() => resendMutation.mutate(u.id)}
                              className="text-xs text-beroe-blue hover:underline font-semibold"
                            >
                              Resend
                            </button>
                          )}
                          {u.status !== "deactivated" && (
                            <button
                              onClick={() => setEditing(u)}
                              className="text-xs text-beroe-blue hover:underline font-semibold"
                            >
                              Edit
                            </button>
                          )}
                          {!isSelf && u.status !== "deactivated" && (
                            <button
                              onClick={() => {
                                if (confirm(`Deactivate ${u.full_name || u.email}? They will lose access immediately.`))
                                  deactivateMutation.mutate(u.id);
                              }}
                              className="text-xs text-red-700 hover:underline font-semibold"
                            >
                              Deactivate
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {inviting && (
          <UserModal
            title="Invite user"
            mode="invite"
            onClose={() => setInviting(false)}
            onSubmit={async (body) => {
              await inviteMutation.mutateAsync(body as UserInvite);
            }}
            isPending={inviteMutation.isPending}
          />
        )}

        {editing && (
          <UserModal
            title={`Edit ${editing.full_name || editing.email}`}
            mode="edit"
            initial={editing}
            onClose={() => setEditing(null)}
            onSubmit={async (body) => {
              await editMutation.mutateAsync({ id: editing.id, body: body as UserUpdate });
            }}
            isPending={editMutation.isPending}
          />
        )}
      </div>
    </AppShell>
  );
}

function StatusPill({ status }: { status: UserStatus }) {
  const tone =
    status === "active" ? "bg-green-100 text-green-800"
      : status === "pending" ? "bg-amber-100 text-amber-800"
        : "bg-slate-100 text-text-muted";
  const label = status === "active" ? "Active" : status === "pending" ? "Invited" : "Deactivated";
  return <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded-full", tone)}>{label}</span>;
}

function UserModal({
  title,
  mode,
  initial,
  onClose,
  onSubmit,
  isPending,
}: {
  title: string;
  mode: "invite" | "edit";
  initial?: UserOut;
  onClose: () => void;
  onSubmit: (body: UserInvite | UserUpdate) => Promise<unknown>;
  isPending: boolean;
}) {
  const [email, setEmail] = useState(initial?.email ?? "");
  const [fullName, setFullName] = useState(initial?.full_name ?? "");
  const [role, setRole] = useState<RoleKey | "">(initial?.role ?? "csm");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (mode === "invite" && (!email || !email.includes("@"))) {
      return setError("Enter a valid email.");
    }
    if (fullName.trim().length < 2) return setError("Full name is required (≥ 2 chars).");
    if (!role) return setError("Pick a role.");
    try {
      if (mode === "invite") {
        await onSubmit({ email: email.trim().toLowerCase(), full_name: fullName.trim(), role: role as RoleKey });
      } else {
        await onSubmit({ full_name: fullName.trim(), role: role as RoleKey });
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Save failed.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <h3 className="text-base font-bold text-text-primary mb-3">{title}</h3>

        <label className="block text-[11px] uppercase tracking-wider text-text-muted font-bold mb-1">
          Email {mode === "edit" && <span className="text-text-muted">(read-only)</span>}
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={mode === "edit"}
          className={cn(
            "w-full px-3 py-1.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:border-beroe-blue mb-3",
            mode === "edit" && "bg-slate-50 text-text-secondary",
          )}
          placeholder="alice@beroe-inc.com"
        />

        <label className="block text-[11px] uppercase tracking-wider text-text-muted font-bold mb-1">
          Full name *
        </label>
        <input
          type="text"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          className="w-full px-3 py-1.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:border-beroe-blue mb-3"
        />

        <label className="block text-[11px] uppercase tracking-wider text-text-muted font-bold mb-1">
          Role *
        </label>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as RoleKey)}
          className="w-full px-3 py-1.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:border-beroe-blue"
        >
          {ALL_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
        </select>

        {mode === "invite" && (
          <p className="mt-3 text-[11px] text-text-muted">
            We'll email a 30-minute link to set their password. (When Beroe SSO is wired up, they'll skip this step.)
          </p>
        )}

        {error && (
          <div className="mt-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-sm border border-slate-200 text-text-secondary"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={isPending}
            className="px-4 py-1.5 rounded-lg bg-beroe-blue text-white text-sm font-semibold disabled:opacity-50"
          >
            {isPending ? "Saving…" : mode === "invite" ? "Invite" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
