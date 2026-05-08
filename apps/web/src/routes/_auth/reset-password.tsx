import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { authProvider } from "@/lib/auth";
import { cn } from "@/lib/utils";

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
    <div className="min-h-screen flex items-center justify-center bg-beroe-navy px-4">
      <div className="w-full max-w-md bg-[#000d28] border border-beroe-navy-3 rounded-2xl p-8 shadow-2xl">
        <h1 className="text-white text-lg font-semibold mb-1">Set a new password</h1>
        <p className="text-[#5a7896] text-xs mb-5">
          You came in via a 30-minute reset link.
        </p>
        {done ? (
          <p className="text-[#7ad29a] text-sm text-center">
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
              className={cn(
                "w-full px-3 py-2.5 rounded-lg text-sm",
                "bg-[#000a20] border border-beroe-navy-3 text-[#c8ddf0]",
                "focus:outline-none focus:border-beroe-blue",
              )}
            />
            <input
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Confirm new password"
              className={cn(
                "w-full px-3 py-2.5 rounded-lg text-sm",
                "bg-[#000a20] border border-beroe-navy-3 text-[#c8ddf0]",
                "focus:outline-none focus:border-beroe-blue",
              )}
            />
            <button
              type="submit"
              disabled={submitting}
              className={cn(
                "w-full py-2.5 rounded-lg text-sm font-bold text-white",
                "bg-gradient-to-br from-[#4A00F8] to-[#3800CC]",
                "disabled:opacity-50",
              )}
            >
              {submitting ? "Updating…" : "Update password"}
            </button>
            {error && (
              <p role="alert" className="text-[#ff7080] text-xs text-center">
                {error}
              </p>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
