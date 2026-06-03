/**
 * In-app confirm / alert / toast system.
 *
 * Replaces the browser-native `confirm(...)` and `alert(...)` dialogs (which
 * read "localhost:5173 says…" and look unprofessional) with brand-styled
 * modals + toasts that match the rest of the app.
 *
 * Usage:
 *
 *   const confirm = useConfirm();
 *   const ok = await confirm({
 *     title: "Delete contact?",
 *     body: "Admins can restore within 30 days.",
 *     confirmLabel: "Delete",
 *     danger: true,
 *   });
 *   if (ok) { ... }
 *
 *   const notify = useNotify();
 *   notify({ title: "Saved.", tone: "success" });
 *   notify({ title: "Couldn't save", body: e.message, tone: "error" });
 *
 * Mount <DialogProvider> once at the root so the hooks resolve.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { cn } from "@/lib/utils";

// ---------------- Types ----------------

export type DialogTone = "info" | "success" | "warning" | "error";

export interface ConfirmOptions {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  tone?: DialogTone;
}

export interface AlertOptions {
  title: string;
  body?: string;
  tone?: DialogTone;
  okLabel?: string;
}

export interface PromptOptions {
  title: string;
  body?: string;
  placeholder?: string;
  initial?: string;
  /** Minimum input length to enable Confirm (server-side rules). */
  minLength?: number;
  maxLength?: number;
  /** Render the input as a textarea instead of a single-line input. */
  multiline?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: DialogTone;
}

export interface ToastOptions {
  title: string;
  body?: string;
  tone?: DialogTone;
  /** ms — defaults to 4000 for success/info, 7000 for warning/error. */
  duration?: number;
}

interface ToastItem extends ToastOptions {
  id: string;
}

interface ConfirmPending {
  opts: ConfirmOptions;
  resolve: (ok: boolean) => void;
}

interface AlertPending {
  opts: AlertOptions;
  resolve: () => void;
}

interface PromptPending {
  opts: PromptOptions;
  resolve: (value: string | null) => void;
}

interface DialogCtx {
  confirm: (o: ConfirmOptions) => Promise<boolean>;
  alert: (o: AlertOptions) => Promise<void>;
  prompt: (o: PromptOptions) => Promise<string | null>;
  notify: (o: ToastOptions) => void;
}

const Ctx = createContext<DialogCtx | null>(null);

// ---------------- Provider ----------------

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [confirmState, setConfirmState] = useState<ConfirmPending | null>(null);
  const [alertState, setAlertState] = useState<AlertPending | null>(null);
  const [promptState, setPromptState] = useState<PromptPending | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const api = useMemo<DialogCtx>(
    () => ({
      confirm: (opts) =>
        new Promise<boolean>((resolve) =>
          setConfirmState({ opts, resolve }),
        ),
      alert: (opts) =>
        new Promise<void>((resolve) => setAlertState({ opts, resolve })),
      prompt: (opts) =>
        new Promise<string | null>((resolve) =>
          setPromptState({ opts, resolve }),
        ),
      notify: (opts) => {
        const id = `t-${++idRef.current}`;
        const tone = opts.tone ?? "info";
        const duration =
          opts.duration ??
          (tone === "warning" || tone === "error" ? 7000 : 4000);
        setToasts((cur) => [...cur, { ...opts, id, tone }]);
        if (duration > 0) {
          window.setTimeout(() => {
            setToasts((cur) => cur.filter((t) => t.id !== id));
          }, duration);
        }
      },
    }),
    [],
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      {confirmState && (
        <ConfirmModal
          opts={confirmState.opts}
          onResult={(ok) => {
            confirmState.resolve(ok);
            setConfirmState(null);
          }}
        />
      )}
      {alertState && (
        <AlertModal
          opts={alertState.opts}
          onClose={() => {
            alertState.resolve();
            setAlertState(null);
          }}
        />
      )}
      {promptState && (
        <PromptModal
          opts={promptState.opts}
          onResult={(value) => {
            promptState.resolve(value);
            setPromptState(null);
          }}
        />
      )}
      <ToastTray
        items={toasts}
        onDismiss={(id) => setToasts((cur) => cur.filter((t) => t.id !== id))}
      />
    </Ctx.Provider>
  );
}

// ---------------- Hooks ----------------

function useCtx(): DialogCtx {
  const v = useContext(Ctx);
  if (!v) {
    throw new Error(
      "useConfirm/useAlert/useNotify must be called inside <DialogProvider>.",
    );
  }
  return v;
}

export function useConfirm() {
  return useCtx().confirm;
}

export function useAlertDialog() {
  return useCtx().alert;
}

export function usePrompt() {
  return useCtx().prompt;
}

export function useNotify() {
  return useCtx().notify;
}

// ---------------- Modals ----------------

const TONE_CONF: Record<
  DialogTone,
  { ring: string; icon: string; titleClr: string; btnBg: string }
> = {
  info: {
    ring: "border-beroe-blue/30",
    icon: "ℹ️",
    titleClr: "text-text-primary",
    btnBg: "bg-beroe-blue",
  },
  success: {
    ring: "border-beroe-green/40",
    icon: "✓",
    titleClr: "text-text-primary",
    btnBg: "bg-beroe-green",
  },
  warning: {
    ring: "border-beroe-amber/40",
    icon: "⚠️",
    titleClr: "text-text-primary",
    btnBg: "bg-beroe-amber",
  },
  error: {
    ring: "border-beroe-red/40",
    icon: "✕",
    titleClr: "text-beroe-red",
    btnBg: "bg-beroe-red",
  },
};

function ConfirmModal({
  opts,
  onResult,
}: {
  opts: ConfirmOptions;
  onResult: (ok: boolean) => void;
}) {
  const tone: DialogTone = opts.danger ? "error" : opts.tone ?? "warning";
  const conf = TONE_CONF[tone];
  // ESC = cancel, ENTER = confirm.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onResult(false);
      if (e.key === "Enter") onResult(true);
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onResult]);

  return (
    <ModalShell onBackdrop={() => onResult(false)} ringClass={conf.ring}>
      <div className="flex items-start gap-3 mb-3">
        <span className="text-[22px] leading-none mt-0.5">{conf.icon}</span>
        <div className="flex-1 min-w-0">
          <h3 className={cn("text-sm font-bold", conf.titleClr)}>
            {opts.title}
          </h3>
          {opts.body && (
            <p className="mt-1 text-[12px] text-text-secondary whitespace-pre-line">
              {opts.body}
            </p>
          )}
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button
          onClick={() => onResult(false)}
          className="px-3 py-1.5 rounded-lg text-sm border border-beroe-card-border text-text-secondary hover:bg-beroe-bg"
        >
          {opts.cancelLabel ?? "Cancel"}
        </button>
        <button
          onClick={() => onResult(true)}
          autoFocus
          className={cn(
            "px-4 py-1.5 rounded-lg text-white text-sm font-semibold",
            conf.btnBg,
          )}
        >
          {opts.confirmLabel ?? "Confirm"}
        </button>
      </div>
    </ModalShell>
  );
}

function AlertModal({
  opts,
  onClose,
}: {
  opts: AlertOptions;
  onClose: () => void;
}) {
  const tone: DialogTone = opts.tone ?? "info";
  const conf = TONE_CONF[tone];
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter") onClose();
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <ModalShell onBackdrop={onClose} ringClass={conf.ring}>
      <div className="flex items-start gap-3 mb-3">
        <span className="text-[22px] leading-none mt-0.5">{conf.icon}</span>
        <div className="flex-1 min-w-0">
          <h3 className={cn("text-sm font-bold", conf.titleClr)}>
            {opts.title}
          </h3>
          {opts.body && (
            <p className="mt-1 text-[12px] text-text-secondary whitespace-pre-line">
              {opts.body}
            </p>
          )}
        </div>
      </div>
      <div className="flex justify-end">
        <button
          onClick={onClose}
          autoFocus
          className={cn(
            "px-4 py-1.5 rounded-lg text-white text-sm font-semibold",
            conf.btnBg,
          )}
        >
          {opts.okLabel ?? "OK"}
        </button>
      </div>
    </ModalShell>
  );
}

function PromptModal({
  opts,
  onResult,
}: {
  opts: PromptOptions;
  onResult: (value: string | null) => void;
}) {
  const [value, setValue] = useState(opts.initial ?? "");
  const tone: DialogTone = opts.tone ?? "info";
  const conf = TONE_CONF[tone];
  const min = opts.minLength ?? 0;
  const max = opts.maxLength;
  const trimmedLen = value.trim().length;
  const tooShort = trimmedLen < min;
  const tooLong = max ? value.length > max : false;
  const disabled = tooShort || tooLong;

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onResult(null);
      if (e.key === "Enter" && !opts.multiline && !disabled) onResult(value);
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onResult, opts.multiline, disabled, value]);

  return (
    <ModalShell onBackdrop={() => onResult(null)} ringClass={conf.ring}>
      <div className="flex items-start gap-3 mb-3">
        <span className="text-[22px] leading-none mt-0.5">{conf.icon}</span>
        <div className="flex-1 min-w-0">
          <h3 className={cn("text-sm font-bold", conf.titleClr)}>
            {opts.title}
          </h3>
          {opts.body && (
            <p className="mt-1 text-[12px] text-text-secondary whitespace-pre-line">
              {opts.body}
            </p>
          )}
        </div>
      </div>
      {opts.multiline ? (
        <textarea
          autoFocus
          rows={4}
          value={value}
          placeholder={opts.placeholder}
          onChange={(e) => setValue(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-beroe-card-border text-sm focus:outline-none focus:border-beroe-blue resize-y"
          maxLength={max}
        />
      ) : (
        <input
          autoFocus
          type="text"
          value={value}
          placeholder={opts.placeholder}
          onChange={(e) => setValue(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-beroe-card-border text-sm focus:outline-none focus:border-beroe-blue"
          maxLength={max}
        />
      )}
      <div className="flex items-center justify-between mt-2 gap-2">
        <div
          className={cn(
            "text-[11px] font-semibold flex-1",
            tooShort
              ? "text-beroe-red"
              : tooLong
                ? "text-beroe-red"
                : "text-text-muted",
          )}
        >
          {min > 0 && tooShort && (
            <>
              Need {min - trimmedLen} more character
              {min - trimmedLen === 1 ? "" : "s"} ({trimmedLen}/{min})
            </>
          )}
          {tooLong && (
            <>
              Too long — {value.length}/{max} characters
            </>
          )}
          {!tooShort && !tooLong && max && (
            <span className="text-text-muted font-normal">
              {value.length}/{max} characters
            </span>
          )}
          {!tooShort && !tooLong && !max && min > 0 && (
            <span className="text-beroe-green font-normal">
              ✓ {trimmedLen} characters
            </span>
          )}
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <button
            onClick={() => onResult(null)}
            className="px-3 py-1.5 rounded-lg text-sm border border-beroe-card-border text-text-secondary hover:bg-beroe-bg"
          >
            {opts.cancelLabel ?? "Cancel"}
          </button>
          <button
            onClick={() => onResult(value)}
            disabled={disabled}
            title={
              tooShort
                ? `Need at least ${min} characters`
                : tooLong
                  ? `Maximum ${max} characters`
                  : undefined
            }
            className={cn(
              "px-4 py-1.5 rounded-lg text-white text-sm font-semibold transition-opacity disabled:opacity-40 disabled:cursor-not-allowed",
              conf.btnBg,
            )}
          >
            {opts.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function ModalShell({
  children,
  onBackdrop,
  ringClass,
}: {
  children: React.ReactNode;
  onBackdrop: () => void;
  ringClass: string;
}) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        // Only close when clicking the actual backdrop, not inside the card.
        if (e.target === e.currentTarget) onBackdrop();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          "bg-white rounded-2xl shadow-xl w-full max-w-md p-5 border-l-4",
          ringClass,
        )}
      >
        {children}
      </div>
    </div>
  );
}

// ---------------- Toasts ----------------

const TOAST_TONE: Record<
  DialogTone,
  { bg: string; border: string; text: string; icon: string }
> = {
  info: {
    bg: "bg-white",
    border: "border-beroe-blue/30",
    text: "text-beroe-blue",
    icon: "ℹ️",
  },
  success: {
    bg: "bg-white",
    border: "border-beroe-green/40",
    text: "text-beroe-green",
    icon: "✓",
  },
  warning: {
    bg: "bg-white",
    border: "border-beroe-amber/40",
    text: "text-beroe-amber",
    icon: "⚠️",
  },
  error: {
    bg: "bg-white",
    border: "border-beroe-red/40",
    text: "text-beroe-red",
    icon: "✕",
  },
};

function ToastTray({
  items,
  onDismiss,
}: {
  items: ToastItem[];
  onDismiss: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div
      aria-live="polite"
      className="fixed top-4 right-4 z-[120] flex flex-col gap-2 max-w-sm w-[360px] pointer-events-none"
    >
      {items.map((t) => {
        const tone = TOAST_TONE[t.tone ?? "info"];
        return (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto rounded-lg shadow-lg border px-3 py-2.5 flex items-start gap-2",
              tone.bg,
              tone.border,
            )}
          >
            <span className={cn("text-[16px] leading-none mt-0.5", tone.text)}>
              {tone.icon}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-[12.5px] font-semibold text-text-primary">
                {t.title}
              </div>
              {t.body && (
                <div className="text-[11.5px] text-text-secondary whitespace-pre-line mt-0.5">
                  {t.body}
                </div>
              )}
            </div>
            <button
              onClick={() => onDismiss(t.id)}
              aria-label="Dismiss"
              className="text-text-muted hover:text-text-primary text-[14px] leading-none"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}

// Keep the helper around for callsites that prefer a fire-and-forget signature.
export function notifyHelperFromCtx(ctx: DialogCtx, opts: ToastOptions): void {
  ctx.notify(opts);
}

// Suppress unused linter — used by some callers in non-typed code paths.
export const __noop__ = useCallback;
