// 08-Jun · In-app CSV / XLSX upload for the 5 offline Intelligence
// sources (Cirtuo / nnamu / Upply / Training / NPS). Drag-drop or click
// to pick — POSTs to /api/v1/intel/upload?source=<src> with a multipart
// body, then invalidates the matching bundle query so the dashboard
// re-fetches and the NA pills flip to live numbers.
//
// Permission gating is server-side (admin / cs_director / vp_csm only).
// Frontend always renders the button; backend 403s are surfaced inline.

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

export type IntelUploadSource =
  | "nnamu"
  | "upply"
  | "cirtuo"
  | "training"
  | "nps";

interface UploadResponse {
  source: IntelUploadSource;
  table: string;
  rows_upserted: number;
  filename: string;
  distinct_companies?: string[];
}

interface Props {
  source: IntelUploadSource;
  label?: string;
  /** Canonical company name used in the staging tables for the account
   *  currently being viewed (= account.redshift_company_name ?? account.name).
   *  When provided, we warn after upload if no row in the loaded file
   *  matches this account — explains why the dashboard didn't change. */
  currentCompanyName?: string | null;
}

/** Small inline upload affordance. Sits at the top of each offline
 *  Intelligence sub-tab so the CSM can drop a fresh CSV / XLSX and
 *  watch the dashboard light up within ~1 second. */
export function IntelUploadButton({ source, label, currentCompanyName }: Props) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<
    {
      filename: string;
      rows: number;
      currentInFile: boolean;
      companies: string[];
    } | null
  >(null);

  async function handleFile(file: File) {
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await api.postForm<UploadResponse>(
        `/api/v1/intel/upload?source=${source}`,
        fd,
      );
      const companies = res.distinct_companies ?? [];
      // Case-insensitive trimmed match — same normalization used by the
      // bundles when filtering by company_name.
      const normCurrent = (currentCompanyName ?? "").trim().toLowerCase();
      const currentInFile = !!normCurrent && companies.some(
        (c) => c.trim().toLowerCase() === normCurrent,
      );
      setSuccess({
        filename: res.filename,
        rows: res.rows_upserted,
        currentInFile,
        companies,
      });
      qc.invalidateQueries({ queryKey: ["intel-bundle"] });
      qc.invalidateQueries({ queryKey: ["intel-all"] });
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message || `Upload failed (HTTP ${e.status})`);
      } else if (e instanceof Error) {
        setError(e.message);
      } else {
        setError("Upload failed.");
      }
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
          }}
          className="hidden"
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className={cn(
            "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-semibold transition",
            busy
              ? "bg-beroe-bg text-text-muted cursor-wait"
              : "bg-beroe-blue text-white hover:bg-beroe-blue/90",
          )}
        >
          {busy ? (
            <>
              <span className="inline-block w-2 h-2 rounded-full bg-white/70 animate-pulse" />
              Loading…
            </>
          ) : (
            <>
              <span>⬆</span>
              {label ?? `Upload ${source} export`}
            </>
          )}
        </button>
        <span className="text-[10px] text-text-muted">.csv or .xlsx · max 10 MB</span>
      </div>
      {success && success.currentInFile && (
        <div className="text-[11px] text-beroe-green bg-beroe-green/10 border border-beroe-green/30 rounded-md px-2.5 py-1">
          ✓ Loaded <span className="font-semibold">{success.filename}</span> —
          {" "}{success.rows} row{success.rows === 1 ? "" : "s"}. Dashboard
          refreshing…
        </div>
      )}
      {success && !success.currentInFile && currentCompanyName && (
        <div className="text-[11px] text-beroe-amber bg-beroe-amber/10 border border-beroe-amber/40 rounded-md px-2.5 py-1.5">
          ⚠ Loaded <span className="font-semibold">{success.filename}</span>
          {" "}({success.rows} row{success.rows === 1 ? "" : "s"}), but{" "}
          <span className="font-semibold">{currentCompanyName}</span> isn't in
          the file — so this account's dashboard won't change.
          {success.companies.length > 0 && (
            <>
              {" "}File contains:{" "}
              <span className="font-medium">
                {success.companies.slice(0, 8).join(", ")}
                {success.companies.length > 8
                  ? `, +${success.companies.length - 8} more`
                  : ""}
              </span>
              .
            </>
          )}
        </div>
      )}
      {success && !success.currentInFile && !currentCompanyName && (
        <div className="text-[11px] text-beroe-green bg-beroe-green/10 border border-beroe-green/30 rounded-md px-2.5 py-1">
          ✓ Loaded <span className="font-semibold">{success.filename}</span> —
          {" "}{success.rows} row{success.rows === 1 ? "" : "s"} across
          {" "}{success.companies.length} compan
          {success.companies.length === 1 ? "y" : "ies"}.
        </div>
      )}
      {error && (
        <div className="text-[11px] text-beroe-red bg-beroe-red/10 border border-beroe-red/30 rounded-md px-2.5 py-1">
          {error}
        </div>
      )}
    </div>
  );
}
