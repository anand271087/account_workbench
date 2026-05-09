/**
 * useUnsavedChangesGuard — keep users from losing edits.
 *
 * Strategy (works with `<BrowserRouter>`, no data-router migration needed):
 *   1. **Browser-level** (refresh / close / external nav): `beforeunload` —
 *      browser shows its own native "leave site?" dialog.
 *   2. **In-app nav** (click another sub-tab, sidebar item, etc.):
 *      capture-phase click handler intercepts <a href> clicks that would
 *      change the URL pathname. If dirty, we cancel the click and surface
 *      a `pendingHref` for the page to render its own dialog.
 *   3. **Cmd / Ctrl + S**: triggers `onSaveShortcut` so power users save
 *      without clicking. The handler is gated to avoid double-fires while
 *      a save is already in flight.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface UnsavedChangesGuard {
  /** href the user tried to navigate to (null when no pending nav). */
  pendingHref: string | null;
  /** Acknowledge the dialog and proceed to the pending href. */
  proceed: () => void;
  /** Stay on the current page; clears pendingHref. */
  stay: () => void;
}

export function useUnsavedChangesGuard(opts: {
  dirty: boolean;
  /** Called on Cmd / Ctrl + S. Should resolve when the save is committed. */
  onSaveShortcut?: () => void;
  /** Optional: extra check to skip blocking (e.g. user already confirmed). */
  isSaving?: boolean;
}): UnsavedChangesGuard {
  const { dirty, onSaveShortcut, isSaving } = opts;
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  // 1) Browser-level — refresh, close, hard nav.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Chrome shows a generic message regardless of returnValue.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // 2) In-app — intercept clicks on internal anchors that change pathname.
  useEffect(() => {
    const onClickCapture = (e: MouseEvent) => {
      if (!dirtyRef.current) return;
      // Modifier keys → let the browser handle (open in new tab etc.).
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (e.button !== 0) return;
      // Walk up to find an <a> with an href.
      let el: HTMLElement | null = e.target as HTMLElement | null;
      while (el && el !== document.body) {
        if (el.tagName === "A" && (el as HTMLAnchorElement).href) {
          const a = el as HTMLAnchorElement;
          // Only intercept same-origin navigations that change the pathname.
          if (a.origin !== window.location.origin) return;
          if (a.pathname === window.location.pathname) return;
          if (a.target && a.target !== "_self") return;
          e.preventDefault();
          e.stopPropagation();
          setPendingHref(a.pathname + a.search + a.hash);
          return;
        }
        el = el.parentElement;
      }
    };
    document.addEventListener("click", onClickCapture, /*capture*/ true);
    return () => document.removeEventListener("click", onClickCapture, true);
  }, []);

  // 3) Cmd/Ctrl + S — trigger save shortcut.
  useEffect(() => {
    if (!onSaveShortcut) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (!isSaving && dirtyRef.current) onSaveShortcut();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onSaveShortcut, isSaving]);

  const proceed = useCallback(() => {
    if (pendingHref) {
      const href = pendingHref;
      setPendingHref(null);
      // Use history API directly so we don't get re-intercepted; the next
      // tick's React Router subscription picks up the change.
      window.history.pushState({}, "", href);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }
  }, [pendingHref]);

  const stay = useCallback(() => setPendingHref(null), []);

  return { pendingHref, proceed, stay };
}
