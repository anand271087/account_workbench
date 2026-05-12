/**
 * MoM-extraction draft handoff.
 *
 * When the user clicks "Extract fields" on a MoM upload, we don't fan-out
 * PATCHes immediately — instead we stash the engagement + brief slices in
 * localStorage as "drafts" and let the existing engagement / brief forms
 * pick them up the next time they mount (or via the custom event below if
 * the form is already mounted).
 *
 * The form merges draft over its server-loaded value → it auto-becomes
 * dirty, the sticky save bar appears, and the existing unsaved-changes
 * guard stops the user navigating away without saving.
 *
 * Contacts don't have a save bar to wire into, so KindUploadCard creates
 * them immediately (additive, 409-dedupe-handled).
 */

import type {
  ExtractedBrief,
  ExtractedEngagement,
} from "@/types/mom_extraction";

const PREFIX = "awb:extraction-draft";
export const EXTRACTION_APPLIED_EVENT = "awb:extraction-applied";

export interface ExtractionDraft {
  filename: string;
  appliedAt: string; // ISO timestamp
  engagement?: ExtractedEngagement;
  brief?: ExtractedBrief;
}

function key(accountId: string): string {
  return `${PREFIX}:${accountId}`;
}

export function saveExtractionDraft(accountId: string, draft: ExtractionDraft): void {
  try {
    localStorage.setItem(key(accountId), JSON.stringify(draft));
    // Notify already-mounted forms so they pick the draft up without a remount.
    window.dispatchEvent(
      new CustomEvent(EXTRACTION_APPLIED_EVENT, { detail: { accountId } }),
    );
  } catch {
    /* localStorage disabled — drop silently */
  }
}

export function peekExtractionDraft(accountId: string): ExtractionDraft | null {
  try {
    const raw = localStorage.getItem(key(accountId));
    if (!raw) return null;
    return JSON.parse(raw) as ExtractionDraft;
  } catch {
    return null;
  }
}

/** One-shot read — returns the draft AND clears storage. */
export function consumeExtractionDraft(accountId: string): ExtractionDraft | null {
  const draft = peekExtractionDraft(accountId);
  if (draft) {
    try {
      localStorage.removeItem(key(accountId));
    } catch {
      /* swallow */
    }
  }
  return draft;
}

/** Read + clear ONLY the engagement slice (brief stays for the Brief tab to consume). */
export function consumeEngagementSlice(accountId: string): ExtractedEngagement | null {
  const draft = peekExtractionDraft(accountId);
  if (!draft?.engagement) return null;
  const remaining: ExtractionDraft = { ...draft };
  delete remaining.engagement;
  try {
    if (remaining.brief) {
      localStorage.setItem(key(accountId), JSON.stringify(remaining));
    } else {
      localStorage.removeItem(key(accountId));
    }
  } catch {
    /* swallow */
  }
  return draft.engagement;
}

/** Read + clear ONLY the brief slice. */
export function consumeBriefSlice(accountId: string): ExtractedBrief | null {
  const draft = peekExtractionDraft(accountId);
  if (!draft?.brief) return null;
  const remaining: ExtractionDraft = { ...draft };
  delete remaining.brief;
  try {
    if (remaining.engagement) {
      localStorage.setItem(key(accountId), JSON.stringify(remaining));
    } else {
      localStorage.removeItem(key(accountId));
    }
  } catch {
    /* swallow */
  }
  return draft.brief;
}
