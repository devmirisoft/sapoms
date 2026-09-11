"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

const MIN_LENGTH = 10;

interface DealerPasswordModalProps {
  userName?: string;
  onChanged: (passwordUpdatedAt: string) => void;
}

let refreshPromise: Promise<boolean> | null = null;

async function refreshSession() {
  if (!refreshPromise) {
    refreshPromise = fetch("/api/auth/refresh", { method: "POST", credentials: "include", cache: "no-store" })
      .then((response) => response.ok)
      .catch(() => false)
      .finally(() => {
        refreshPromise = null;
      });
  }

  return refreshPromise;
}

async function postNewPassword(newPassword: string) {
  const send = () =>
    fetch("/api/dealer/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      cache: "no-store",
      body: JSON.stringify({ newPassword }),
    });

  const response = await send();
  if (response.status !== 401) return response;

  const refreshed = await refreshSession();
  if (!refreshed) return response;

  return send();
}

function PasswordField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</label>
      <div className="relative">
        <input
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete="new-password"
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 pr-10 text-sm text-slate-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-slate-900"
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? "Hide password" : "Show password"}
          className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-600"
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

export default function DealerPasswordModal({ userName = "Dealer", onChanged }: DealerPasswordModalProps) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = password.length >= MIN_LENGTH && password === confirmPassword;

  async function handleSubmit() {
    if (!canSubmit) return;
    setIsSubmitting(true);
    setError(null);

    try {
      const res = await postNewPassword(password);
      const payload = await res.json().catch(() => null);
      if (!res.ok) throw new Error(payload?.msg || payload?.message || "Failed to update password.");

      // The change bumps tokenVersion, so the live access token is stale until refreshed.
      await refreshSession();
      onChanged(String(payload?.data?.passwordUpdatedAt || new Date().toISOString()));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSignOut() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" }).catch(() => undefined);
    window.location.href = "/auth/login";
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/90 backdrop-blur-sm">
      <div className="relative mx-4 flex w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="border-b border-slate-100 px-8 pb-5 pt-8">
          <div className="mb-1 flex items-center gap-3">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-slate-900">
              <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </span>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">Set your own password</h1>
          </div>
          <p className="ml-12 text-sm text-slate-500">
            Your account still uses the password created for you. Choose a new one to continue.
          </p>
        </div>

        <form
          className="space-y-4 px-8 py-6"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          <PasswordField label="New password" value={password} onChange={setPassword} />
          <PasswordField label="Confirm new password" value={confirmPassword} onChange={setConfirmPassword} />

          <p className="text-xs text-slate-400">At least {MIN_LENGTH} characters.</p>

          {confirmPassword.length > 0 && password !== confirmPassword && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-600">
              Passwords do not match.
            </p>
          )}

          {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-500">{error}</p>}

          <button
            type="submit"
            disabled={!canSubmit || isSubmitting}
            className={`w-full rounded-xl py-3 text-sm font-semibold tracking-wide transition-all duration-200 ${
              canSubmit && !isSubmitting
                ? "bg-slate-900 text-white shadow-sm hover:bg-slate-700 active:scale-[0.98]"
                : "cursor-not-allowed bg-slate-200 text-slate-400"
            }`}
          >
            {isSubmitting ? "Updating password..." : "Update password"}
          </button>

          <p className="text-center text-xs text-slate-400">
            Signed in as <span className="font-medium text-slate-600">{userName}</span> -{" "}
            <button type="button" onClick={() => void handleSignOut()} className="font-medium text-slate-500 underline hover:text-slate-700">
              sign out
            </button>
          </p>
        </form>
      </div>
    </div>
  );
}
