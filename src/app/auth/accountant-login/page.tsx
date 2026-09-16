"use client"

import { useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { persistAuthenticatedSession } from "@/lib/roleAccess"

export default function AccountantLogin() {
  const router = useRouter()

  const [email,    setEmail]    = useState("")
  const [password, setPassword] = useState("")
  const [showPw,   setShowPw]   = useState(false)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState("")

  const handleLogin = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError("")

    if (!email || !password) {
      setError("Email and password are required")
      return
    }

    try {
      setLoading(true)

      const post = () => fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      })
      const res = await post().catch(post)
      const data = await res.json()
      const failureMessage = typeof data?.message === "string" ? data.message : "Invalid credentials"

      if (res.ok && data?.success) {
        persistAuthenticatedSession(localStorage, data.data, "accountant")
        window.dispatchEvent(new Event("omsons-auth-changed"))
        router.push("/dashboard/accountant")
      } else {
        setError(failureMessage)
      }
    } catch {
      setError("Server error. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="h-screen overflow-hidden text-slate-950">
      <div className="flex h-full w-full">
        <section className="grid w-full overflow-hidden bg-white lg:grid-cols-[0.86fr_1.14fr]">

          {/* ── Form panel ─────────────────────────────────────────────── */}
          <form
            className="flex min-h-0 flex-col justify-center p-0"
            onSubmit={handleLogin}
          >
            <div className="mx-auto w-full max-w-[330px] px-8">

              {/* Header */}
              <div className="mb-4">
                <div className="mb-3 flex items-center gap-3">
                  <img
                    src="https://omsonslabs.com/wp-content/uploads/elementor/thumbs/Logo-White-rjr8rdx3pqxz9p6ypfegb07hgtpvj3g22mnujlpa0w.png"
                    alt="Omsons Logo"
                    width={34}
                    height={34}
                    className="rounded-full bg-[#1d4ed8] p-1"
                  />
                  <div>
                    <p className="text-sm font-semibold text-slate-950">Omsons finance</p>
                    <p className="text-xs text-slate-400">Accountant portal</p>
                  </div>
                </div>
                <h1 className="text-[26px] font-black leading-tight tracking-[-0.01em] text-slate-950">
                  Accountant Login
                </h1>
                <p className="mt-1 text-[13px] text-slate-500">
                  Access invoices, ledgers, and finance dashboards.
                </p>
              </div>

              {/* Fields */}
              <div className="space-y-3">
                <label className="block">
                  <span className="mb-1.5 block text-[12px] font-semibold text-slate-700">Email</span>
                  <input
                    type="text"
                    placeholder="Enter your email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    autoComplete="username"
                    className="h-10 w-full rounded-full border border-slate-200 bg-white px-5 text-[13px] text-slate-900 shadow-sm outline-none transition placeholder:text-slate-300 focus:border-[#5b3ff2] focus:ring-4 focus:ring-[#5b3ff2]/10"
                  />
                </label>

                <label className="block">
                  <span className="mb-1.5 block text-[12px] font-semibold text-slate-700">Password</span>
                  <div className="relative">
                    <input
                      type={showPw ? "text" : "password"}
                      placeholder="Enter your password"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      autoComplete="current-password"
                      className="h-10 w-full rounded-full border border-slate-200 bg-white px-5 pr-12 text-[13px] text-slate-900 shadow-sm outline-none transition placeholder:text-slate-300 focus:border-[#5b3ff2] focus:ring-4 focus:ring-[#5b3ff2]/10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw(v => !v)}
                      className="absolute right-4 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-slate-400 transition hover:bg-slate-50 hover:text-slate-700"
                      tabIndex={-1}
                      aria-label={showPw ? "Hide password" : "Show password"}
                    >
                      {showPw ? (
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                          <line x1="1" y1="1" x2="23" y2="23"/>
                        </svg>
                      ) : (
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                          <circle cx="12" cy="12" r="3"/>
                        </svg>
                      )}
                    </button>
                  </div>
                </label>
              </div>

             

              {/* Error message */}
              {error && (
                <p className="mt-3 rounded-xl border border-red-100 bg-red-50 px-4 py-2.5 text-[12px] font-semibold text-red-600">
                  {error}
                </p>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={loading}
                className="mt-4 flex h-10 w-full items-center justify-center gap-2 rounded-full bg-[#593df4] px-4 text-[13px] font-bold text-white shadow-[0_14px_28px_rgba(89,61,244,0.28)] transition hover:-translate-y-0.5 hover:bg-[#4b31de] active:translate-y-0 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {loading ? (
                  <>
                    <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                    </svg>
                    Signing in...
                  </>
                ) : "Login"}
              </button>

              {/* Back to main login — inline row */}
              <div className="mt-4 flex items-center justify-center gap-3">
                <p className="text-[11px] text-slate-400">Need a different portal?</p>
                <button
                  type="button"
                  onClick={() => router.push("/auth/login")}
                  className="inline-flex h-8 items-center justify-center rounded-full border border-slate-200 bg-white px-4 text-[11px] font-semibold text-slate-600 transition hover:border-[#593df4] hover:text-[#593df4]"
                >
                  Back to main login
                </button>
              </div>

              {/* Footer */}
              <p className="mt-4 text-center text-[11px] text-slate-300">
                ©2026 Omsons. All rights reserved.
              </p>
            </div>
          </form>

          {/* ── Image panel ────────────────────────────────────────────── */}
          <div className="relative hidden bg-[#1177e9] lg:block">
            <img
              src="/login2.png"
              alt="Omsons laboratory glassware"
              className="absolute inset-0 h-full w-full object-cover object-left"
            />
          </div>

        </section>
      </div>
    </main>
  )
}