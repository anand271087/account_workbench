import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, ApiError } from "@/lib/api";
import type { AccountListItem } from "@/types/account";
import type { UserOut } from "@/types/auth";

interface Props {
  account: AccountListItem;
  onClose: () => void;
}

/** Admin-only modal for reassigning an account's CSM. */
export function ReassignOwnerModal({ account, onClose }: Props) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string>(account.csm_user_id ?? "");
  const [error, setError] = useState<string | null>(null);

  const { data: csms, isLoading } = useQuery<UserOut[]>({
    queryKey: ["users", "csm"],
    queryFn: () => api.get<UserOut[]>("/api/v1/users?role=csm"),
    staleTime: 30_000,
  });

  // Also fetch cs_team_managers (they can also own accounts per matrix)
  const { data: tms } = useQuery<UserOut[]>({
    queryKey: ["users", "cs_team_manager"],
    queryFn: () => api.get<UserOut[]>("/api/v1/users?role=cs_team_manager"),
    staleTime: 30_000,
  });

  const candidates = [...(csms ?? []), ...(tms ?? [])];

  const mutation = useMutation({
    mutationFn: (csm_user_id: string) =>
      api.patch<AccountListItem>(`/api/v1/accounts/${account.id}/owner`, { csm_user_id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      onClose();
    },
    onError: (e: ApiError) => setError(e.message),
  });

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
        <div className="flex items-start justify-between mb-1">
          <h2 className="text-lg font-bold text-text-primary">Reassign owner</h2>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <p className="text-xs text-text-muted mb-4">
          <b>{account.name}</b> · current owner:{" "}
          {account.csm_full_name || <em>unassigned</em>}
        </p>

        <label className="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-1.5">
          New CSM
        </label>
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          disabled={isLoading || mutation.isPending}
          className="w-full px-3 py-2 border border-beroe-card-border rounded-lg text-sm bg-white focus:outline-none focus:border-beroe-blue disabled:opacity-60"
        >
          <option value="">— Select —</option>
          {candidates.map((u) => (
            <option key={u.id} value={u.id}>
              {u.full_name || u.email} ({u.role})
            </option>
          ))}
        </select>

        {error && (
          <p className="mt-3 text-xs text-beroe-red bg-beroe-red/10 border border-beroe-red/30 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <div className="flex gap-2 mt-5 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg border border-beroe-card-border text-sm text-text-secondary hover:bg-beroe-bg"
          >
            Cancel
          </button>
          <button
            onClick={() => selected && mutation.mutate(selected)}
            disabled={!selected || mutation.isPending || selected === account.csm_user_id}
            className="px-4 py-1.5 rounded-lg bg-beroe-blue text-white text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {mutation.isPending ? "Saving…" : "Reassign"}
          </button>
        </div>
      </div>
    </div>
  );
}
