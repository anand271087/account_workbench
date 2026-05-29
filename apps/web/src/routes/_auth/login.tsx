import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "@/components/AuthProvider";
import { authProvider } from "@/lib/auth";
import { cn } from "@/lib/utils";

const API_BASE = import.meta.env.VITE_API_BASE_URL;

type LoginStatus = {
  blocked: boolean;
  fails_in_window: number;
  minutes_remaining: number;
  threshold: number;
};

async function checkLoginStatus(email: string): Promise<LoginStatus> {
  const r = await fetch(`${API_BASE}/api/v1/auth/login-status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!r.ok) return { blocked: false, fails_in_window: 0, minutes_remaining: 0, threshold: 5 };
  return (await r.json()) as LoginStatus;
}

async function recordLoginFailure(email: string): Promise<void> {
  try {
    await fetch(`${API_BASE}/api/v1/auth/login-record-failure`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
  } catch { /* don't block UX on telemetry */ }
}

export default function LoginPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resetMode, setResetMode] = useState(false);
  const [resetMessage, setResetMessage] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const status = await checkLoginStatus(email);
      if (status.blocked) {
        setError(
          `Too many failed attempts. Account locked for ${status.minutes_remaining} more minute${status.minutes_remaining === 1 ? "" : "s"}.`,
        );
        return;
      }
      try {
        await signIn(email, password);
        navigate("/", { replace: true });
      } catch (err) {
        await recordLoginFailure(email);
        // After recording, re-check to surface "now blocked" message.
        const post = await checkLoginStatus(email);
        if (post.blocked) {
          setError(`Too many failed attempts. Account locked for ${post.minutes_remaining} minute${post.minutes_remaining === 1 ? "" : "s"}.`);
          return;
        }
        const left = Math.max(0, post.threshold - post.fails_in_window);
        const baseMsg =
          err instanceof Error
            ? err.message.includes("Invalid login")
              ? "Invalid email or password"
              : err.message
            : "Sign in failed";
        setError(left > 0 ? `${baseMsg} · ${left} attempt${left === 1 ? "" : "s"} remaining` : baseMsg);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function onSendReset(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setResetMessage(null);
    if (!email) {
      setError("Enter your email above first.");
      return;
    }
    setSubmitting(true);
    try {
      await authProvider.sendPasswordReset(email);
      setResetMessage(
        "If that email is registered, we just sent a reset link. It expires in 30 minutes.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send reset email.");
    } finally {
      setSubmitting(false);
    }
  }

  // Brand palette anchors (Beroe brand book Sept 2025).
  const MIDNIGHT = "#001137";
  const INDIGO = "#4A00F8";
  const RISK_RED = "#CF4548";
  const RISK_GREEN = "#6EC457";
  // Two Midnight tints for the inner panel + input fills (kept on-brand
  // by deriving from Midnight, not by introducing new hex values).
  const MIDNIGHT_PANEL = "#001a45"; // brand-defined `--n2` (Midnight tint)
  const MIDNIGHT_INPUT = "#000a20"; // darker Midnight tint
  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: MIDNIGHT }}
    >
      <div
        className="w-full max-w-md rounded-2xl p-8 shadow-2xl"
        style={{ background: MIDNIGHT_PANEL, border: "1px solid #001a45" }}
      >
        {/* Brand lockup — white Beroe wordmark (brand book page 9). */}
        <div className="mb-6">
          <img
            src="/beroe-wordmark-white.svg"
            alt="Beroe"
            className="h-7 w-auto block"
          />
          <div className="text-text-muted text-[11px] mt-1 tracking-wide">
            Account Work Bench
          </div>
        </div>

        <h1 className="text-white text-lg font-semibold mb-1">
          {resetMode ? "Reset password" : "Sign in"}
        </h1>
        <p className="text-text-muted text-xs mb-5">
          {resetMode
            ? "Enter your Beroe email — we'll send a 30-minute reset link."
            : "Use your Beroe email. 5 failed attempts locks the account for 15 minutes."}
        </p>

        <form
          onSubmit={resetMode ? onSendReset : onSubmit}
          className="space-y-3"
        >
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email@beroe-inc.com"
            className={cn(
              "w-full px-3 py-2.5 rounded-lg text-sm text-white",
              "focus:outline-none focus:border-beroe-blue",
            )}
            style={{
              background: MIDNIGHT_INPUT,
              border: "1px solid #001a45",
            }}
          />
          {!resetMode && (
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className={cn(
                "w-full px-3 py-2.5 rounded-lg text-sm text-white",
                "focus:outline-none focus:border-beroe-blue",
              )}
              style={{
                background: MIDNIGHT_INPUT,
                border: "1px solid #001a45",
              }}
            />
          )}
          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 rounded-lg text-sm font-bold text-white disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: INDIGO }}
          >
            {submitting
              ? "Working…"
              : resetMode
                ? "Send reset link"
                : "Sign in →"}
          </button>
          {error && (
            <p
              role="alert"
              className="text-xs text-center"
              style={{ color: RISK_RED }}
              data-testid="login-error"
            >
              {error}
            </p>
          )}
          {resetMessage && (
            <p
              role="status"
              className="text-xs text-center"
              style={{ color: RISK_GREEN }}
            >
              {resetMessage}
            </p>
          )}
          <button
            type="button"
            onClick={() => {
              setResetMode((m) => !m);
              setError(null);
              setResetMessage(null);
            }}
            className="block mx-auto text-[11px] text-text-muted hover:text-white transition-colors"
          >
            {resetMode ? "← Back to sign in" : "Forgot password?"}
          </button>
        </form>

        <p className="text-[10px] text-center mt-5 text-text-subtle">
          Beroe SSO support arrives in Phase 2.
        </p>
      </div>
    </div>
  );
}
