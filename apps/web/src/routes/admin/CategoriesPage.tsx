import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AppShell } from "@/components/AppShell";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Category } from "@/types/lookup";

export default function CategoriesPage() {
  const qc = useQueryClient();
  const [rejecting, setRejecting] = useState<Category | null>(null);

  const { data, isLoading, isError, error } = useQuery<Category[]>({
    queryKey: ["categories"],
    queryFn: () => api.get<Category[]>("/api/v1/lookups/categories"),
    staleTime: 30_000,
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) =>
      api.post<Category>(`/api/v1/lookups/categories/${id}/approve`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["categories"] }),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => {
      const qs = reason ? `?reason=${encodeURIComponent(reason)}` : "";
      return api.delete<void>(`/api/v1/lookups/categories/${id}${qs}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["categories"] });
      setRejecting(null);
    },
  });

  const pending = (data ?? []).filter((c) => !c.approved);
  const approved = (data ?? []).filter((c) => c.approved);

  return (
    <AppShell>
      <div className="px-6 py-5">
        <div className="mb-4">
          <h1 className="text-xl font-bold text-text-primary">Categories</h1>
          <p className="text-xs text-text-muted mt-1">
            CSMs can propose new procurement categories from the Pre-Sales tab.
            They land here as <b>pending</b> — admins approve them so they
            appear in the picker for everyone, or reject them.
          </p>
        </div>

        {isError && (
          <div className="bg-beroe-red/10 border border-beroe-red/30 rounded-lg px-4 py-3 mb-3 text-sm text-beroe-red">
            <b>Error</b> — {(error as Error)?.message}
          </div>
        )}
        {isLoading && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {[0, 1].map((i) => (
              <div
                key={i}
                className="bg-white rounded-card border border-beroe-card-border overflow-hidden"
              >
                <div className="px-5 py-3 border-b border-beroe-card-border h-11 flex items-center">
                  <div className="h-4 w-32 bg-beroe-bg rounded animate-pulse" />
                </div>
                <div className="p-5 space-y-2">
                  {[0, 1, 2, 3].map((j) => (
                    <div
                      key={j}
                      className="h-5 bg-beroe-bg rounded animate-pulse"
                      style={{ width: `${60 + (j * 7) % 30}%` }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {data && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Pending column */}
            <div className="bg-white rounded-card border border-beroe-card-border overflow-hidden">
              <div className="px-5 py-3 border-b border-beroe-card-border flex items-center justify-between">
                <h2 className="text-sm font-bold text-text-primary">
                  Pending review
                </h2>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-beroe-amber/20 text-beroe-amber font-bold">
                  {pending.length}
                </span>
              </div>
              {pending.length === 0 ? (
                <div className="p-8 text-center text-sm text-text-muted">
                  Nothing to review. CSM-proposed categories show up here.
                </div>
              ) : (
                <ul className="divide-y divide-beroe-card-border/60">
                  {pending.map((c) => (
                    <li key={c.id} className="px-5 py-3 flex items-center gap-3">
                      <span className="text-sm font-semibold text-text-primary flex-1 min-w-0 truncate">
                        {c.name}
                      </span>
                      <button
                        onClick={() => setRejecting(c)}
                        disabled={rejectMutation.isPending}
                        className="text-xs px-3 py-1.5 rounded-lg border border-beroe-red/30 text-beroe-red font-semibold hover:bg-beroe-red/10 disabled:opacity-50"
                      >
                        Reject
                      </button>
                      <button
                        onClick={() => approveMutation.mutate(c.id)}
                        disabled={approveMutation.isPending}
                        className="text-xs px-3 py-1.5 rounded-lg bg-beroe-blue text-white font-semibold disabled:opacity-50"
                      >
                        Approve
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Approved column */}
            <div className="bg-white rounded-card border border-beroe-card-border overflow-hidden">
              <div className="px-5 py-3 border-b border-beroe-card-border flex items-center justify-between">
                <h2 className="text-sm font-bold text-text-primary">Approved</h2>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-beroe-green/20 text-beroe-green font-bold">
                  {approved.length}
                </span>
              </div>
              {approved.length === 0 ? (
                <div className="p-8 text-center text-sm text-text-muted">
                  No approved categories yet.
                </div>
              ) : (
                <ul className="divide-y divide-beroe-card-border/60 max-h-[600px] overflow-y-auto">
                  {approved.map((c) => (
                    <li
                      key={c.id}
                      className="px-5 py-2.5 text-sm text-text-primary flex items-center gap-2"
                    >
                      <span className={cn("inline-block w-1.5 h-1.5 rounded-full bg-beroe-green")} />
                      {c.name}
                    </li>
                  ))}
                </ul>
              )}
              <div className="px-5 py-2 border-t border-beroe-card-border/60 text-[11px] text-text-muted">
                Approved categories appear in the Pre-Sales target-categories
                picker for every user.
              </div>
            </div>
          </div>
        )}

        {rejecting && (
          <RejectCategoryModal
            category={rejecting}
            onClose={() => setRejecting(null)}
            onSubmit={(reason) =>
              rejectMutation.mutateAsync({ id: rejecting.id, reason })
            }
            isPending={rejectMutation.isPending}
          />
        )}
      </div>
    </AppShell>
  );
}

function RejectCategoryModal({
  category,
  onClose,
  onSubmit,
  isPending,
}: {
  category: Category;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<unknown>;
  isPending: boolean;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const PRESETS = [
    "Duplicate of an existing category",
    "Too narrow / one-off use case",
    "Spelling or naming error",
    "Should be a sub-category of an existing one",
  ];

  async function submit() {
    setError(null);
    if (reason.trim().length < 5) {
      setError("Add a short reason (at least 5 characters) so the proposer learns from it.");
      return;
    }
    try {
      await onSubmit(reason.trim());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Reject failed.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-card shadow-xl w-full max-w-md p-6">
        <div className="flex items-start gap-3">
          <div className="text-2xl">🚫</div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-bold text-text-primary">
              Reject "{category.name}"?
            </h3>
            <p className="text-xs text-text-muted mt-1">
              The category will be removed. The proposer + reason are written to
              the audit log so anyone can see why later.
            </p>
          </div>
        </div>

        {/* Quick-pick presets */}
        <div className="mt-4 flex flex-wrap gap-1">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setReason(p)}
              className={cn(
                "text-[11px] px-2 py-0.5 rounded-full border",
                reason === p
                  ? "bg-beroe-blue/10 border-beroe-blue/30 text-beroe-blue font-semibold"
                  : "border-beroe-card-border text-text-secondary hover:bg-beroe-bg/40",
              )}
            >
              {p}
            </button>
          ))}
        </div>

        <label className="block text-[11px] uppercase tracking-wider text-text-muted font-bold mt-4 mb-1">
          Reason for rejecting *
        </label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          maxLength={500}
          autoFocus
          placeholder="e.g. Duplicate of 'Direct Materials'. Use that one instead."
          className="w-full px-3 py-2 rounded-lg border border-beroe-card-border text-sm focus:outline-none focus:border-beroe-blue resize-none"
        />
        <div className="text-[10px] text-text-muted text-right mt-0.5">
          {reason.length}/500
        </div>

        {error && (
          <div className="mt-2 text-xs text-beroe-red bg-beroe-red/10 border border-beroe-red/30 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-sm border border-beroe-card-border text-text-secondary"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={isPending || reason.trim().length < 5}
            className="px-4 py-1.5 rounded-lg bg-beroe-red text-white text-sm font-semibold disabled:opacity-50 hover:bg-beroe-red"
          >
            {isPending ? "Rejecting…" : "Reject category"}
          </button>
        </div>
      </div>
    </div>
  );
}
