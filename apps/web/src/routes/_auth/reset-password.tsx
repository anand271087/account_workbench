import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { authProvider } from "@/lib/auth";

// Beroe brand palette (Sept 2025 brand book).
const MIDNIGHT = "#001137";
const INDIGO = "#4A00F8";
const RISK_RED = "#CF4548";
const RISK_GREEN = "#6EC457";
const MIDNIGHT_PANEL = "#001a45";
const MIDNIGHT_INPUT = "#000a20";

export default function ResetPasswordPage() {
  const nav = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    try {
      await authProvider.updatePassword(password);
      setDone(true);
      window.setTimeout(() => nav("/login", { replace: true }), 2000);
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message.toLowerCase().includes("expired")
            ? "Reset link has expired. Request a new one from the sign-in screen."
            : err.message
          : "Could not update password.";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: MIDNIGHT }}
    >
      <div
        className="w-full max-w-md rounded-2xl p-8 shadow-2xl"
        style={{ background: MIDNIGHT_PANEL, border: "1px solid #001a45" }}
      >
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
          Set a new password
        </h1>
        <p className="text-text-muted text-xs mb-5">
          You came in via a 30-minute reset link.
        </p>
        {done ? (
          <p
            className="text-sm text-center"
            style={{ color: RISK_GREEN }}
          >
            Password updated. Redirecting to sign in…
          </p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-3">
            <input
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="New password (min 8)"
              className="w-full px-3 py-2.5 rounded-lg text-sm text-white focus:outline-none focus:border-beroe-blue"
              style={{
                background: MIDNIGHT_INPUT,
                border: "1px solid #001a45",
              }}
            />
            <input
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Confirm new password"
              className="w-full px-3 py-2.5 rounded-lg text-sm text-white focus:outline-none focus:border-beroe-blue"
              style={{
                background: MIDNIGHT_INPUT,
                border: "1px solid #001a45",
              }}
            />
            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 rounded-lg text-sm font-bold text-white disabled:opacity-50"
              style={{ background: INDIGO }}
            >
              {submitting ? "Updating…" : "Update password"}
            </button>
            {error && (
              <p
                role="alert"
                className="text-xs text-center"
                style={{ color: RISK_RED }}
              >
                {error}
              </p>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
