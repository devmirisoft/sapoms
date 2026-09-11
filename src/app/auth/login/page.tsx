"use client"

import { useEffect, useRef, useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { Eye, EyeOff, RotateCcw } from "lucide-react"
import { persistAuthenticatedSession, type StoredUser } from "@/lib/roleAccess"
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp"
import { cn } from "@/lib/utils"


const LOGO_SRC = "/omsons_logo.jpeg"

export default function Login() {
  const router = useRouter()

  const [showNotice, setShowNotice] = useState(true)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPw, setShowPw] = useState(false)
  const [otpRequired, setOtpRequired] = useState(false)
  const [notice, setNotice] = useState("")
  const [otpCode, setOtpCode] = useState("")
  const [otpLoading, setOtpLoading] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  // Only the server opens the code panel, and only for a dealer whose password already checked out.
  const showOtp = otpRequired
  const otpInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (showOtp) otpInputRef.current?.focus()
  }, [showOtp])

  useEffect(() => {
    if (!showNotice) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowNotice(false)
      }
    }

    window.addEventListener("keydown", handleKeyDown)

    return () => {
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [showNotice])

  const completeLogin = (userData: StoredUser) => {
    const session = persistAuthenticatedSession(localStorage, userData)
    if (!session || session.status !== "authenticated") {
      setError("Invalid credentials")
      return
    }

    const clientRole = session.role
    window.dispatchEvent(new Event("omsons-auth-changed"))

    setEmail("")
    setPassword("")
    setOtpCode("")
    setOtpRequired(false)
    setNotice("")

    if (clientRole === "staff") router.push("/dashboard/staff")
    else if (clientRole === "dealer") router.push("/home")
    else if (clientRole === "admin") router.push("/dashboard/admin")
    else if (clientRole === "accountant") router.push("/dashboard/accountant")
  }

  const resetOtp = () => {
    setOtpRequired(false)
    setOtpCode("")
    setNotice("")
    setError("")
  }

  const handleLogin = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError("")

    // Once the panel is open the same button verifies the code.
    if (showOtp) return handleVerifyOtp()

    if (!email || !password) {
      setError("Email or username and password are required")
      return
    }

    try {
      setLoading(true)

      const formData = new FormData()
      formData.append("email", email)
      formData.append("password", password)

      const res = await fetch("/api/auth/login", {
        method: "POST",
        body: formData,
        credentials: "include",
      })
      const data = await res.json()
      const responseMessage = typeof data?.message === "string" ? data.message : "Invalid credentials"

      if (res.ok && data?.status) {
        // Dealers need a second factor; staff and admins already hold a session here.
        if (data?.data?.otpRequired) {
          setOtpRequired(true)
          setOtpCode("")
          setNotice(responseMessage)
          return
        }
        completeLogin(data.data || { email })
      } else {
        setError(responseMessage)
      }
    } catch (err: unknown) {
      console.error("Login error:", err)

      setError("Server error")
    } finally {
      setLoading(false)
    }
  }

  const handleRequestOtp = async () => {
    setError("")
    if (!email) {
      setError("Email or username is required")
      return
    }

    try {
      setOtpLoading(true)
      const res = await fetch("/api/auth/email-otp/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
        credentials: "include",
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof data?.message === "string" ? data.message : "Unable to send verification code")
      }
    } catch (err: unknown) {
      console.error("OTP request error:", err)
      setError("Server error")
    } finally {
      setOtpLoading(false)
    }
  }

  // The code arrives as an argument from onComplete, where `otpCode` state is still a render behind.
  const handleVerifyOtp = async (code: string = otpCode) => {
    setError("")
    if (!email || !code) {
      setError("Email or username and verification code are required")
      return
    }

    try {
      setOtpLoading(true)
      const res = await fetch("/api/auth/email-otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, otp: code }),
        credentials: "include",
      })
      const data = await res.json().catch(() => ({}))
      const failureMessage = typeof data?.message === "string" ? data.message : "Invalid verification code"
      if (res.ok && data?.status) {
        completeLogin(data.data || { email })
      } else {
        setError(failureMessage)
      }
    } catch (err: unknown) {
      console.error("OTP verify error:", err)
      setError("Server error")
    } finally {
      setOtpLoading(false)
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
                    src={LOGO_SRC}
                    alt="Omsons Logo"
                    width={34}
                    height={34}
                    className="h-9 w-9 rounded-full bg-[#1d4ed8] object-contain p-1"
                  />
                  <div>
                    <p className="text-sm font-semibold text-slate-950">Omsons</p>
                    <p className="text-xs text-slate-400">Dealer network</p>
                  </div>
                </div>
                <h1 className="text-[26px] font-black leading-tight tracking-[-0.01em] text-slate-950">
                  Login
                </h1>
                <p className="mt-1 text-[13px] text-slate-500">
                  Sign in with your assigned account. Your role is detected automatically.
                </p>
              </div>

              {/* Fields */}
              <div className="space-y-3">
                <label className="block">
                  <span className="mb-1.5 block text-[12px] font-semibold text-slate-700">Email or Username</span>
                  <input
                    type="text"
                    placeholder="Enter your email or username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
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
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="current-password"
                      className="h-10 w-full rounded-full border border-slate-200 bg-white px-5 pr-12 text-[13px] text-slate-900 shadow-sm outline-none transition placeholder:text-slate-300 focus:border-[#5b3ff2] focus:ring-4 focus:ring-[#5b3ff2]/10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw((visible) => !visible)}
                      className="absolute right-4 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-slate-400 transition hover:bg-slate-50 hover:text-slate-700"
                      aria-label={showPw ? "Hide password" : "Show password"}
                      title={showPw ? "Hide password" : "Show password"}
                    >
                      {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </label>
              </div>

              {/* Dealer second factor: slides open only after the password check passes. */}
              <div
                className={cn(
                  "grid transition-all duration-300 ease-out",
                  showOtp ? "mt-3 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
                )}
              >
                  <div className="overflow-hidden">
                    <span className="mb-1.5 block text-[12px] font-semibold text-slate-700">Verification Code</span>
                    <InputOTP
                      maxLength={6}
                      value={otpCode}
                      onChange={setOtpCode}
                      onComplete={handleVerifyOtp}
                      disabled={!showOtp || otpLoading}
                      containerClassName="w-full"
                      ref={otpInputRef}
                    >
                      <InputOTPGroup className="w-full justify-between gap-1.5">
                        {[0, 1, 2, 3, 4, 5].map((slot) => (
                          <InputOTPSlot
                            key={slot}
                            index={slot}
                            className="h-10 w-9 rounded-xl border border-slate-200 bg-white text-[15px] font-bold text-slate-900 shadow-sm first:rounded-xl last:rounded-xl data-[active=true]:border-[#5b3ff2] data-[active=true]:ring-4 data-[active=true]:ring-[#5b3ff2]/10"
                          />
                        ))}
                      </InputOTPGroup>
                    </InputOTP>

                    {notice && <p className="mt-2 text-[11px] text-slate-500">{notice}</p>}

                    <div className="mt-2 flex items-center justify-between">
                      <button
                        type="button"
                        onClick={resetOtp}
                        className="text-[11px] font-semibold text-slate-500 hover:text-slate-800"
                      >
                        Use Password
                      </button>
                      <button
                        type="button"
                        onClick={handleRequestOtp}
                        disabled={otpLoading}
                        className="flex items-center gap-1.5 text-[11px] font-semibold text-[#4f35dc] hover:text-[#321fbd] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <RotateCcw size={12} />
                        Resend Code
                      </button>
                    </div>
                  </div>
              </div>

              {/* Forgot password */}
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  className="text-[11px] font-semibold text-[#4f35dc] hover:text-[#321fbd]"
                >
                  Forgot Password?
                </button>
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
                disabled={loading || otpLoading}
                className="mt-4 h-10 w-full rounded-full bg-[#593df4] px-4 text-[13px] font-bold text-white shadow-[0_14px_28px_rgba(89,61,244,0.28)] transition hover:-translate-y-0.5 hover:bg-[#4b31de] active:translate-y-0 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {showOtp ? (otpLoading ? "Verifying..." : "Verify & Login") : loading ? "Signing in..." : "Login"}
              </button>

{/* Footer */}
              <p className="mt-4 text-center text-[11px] text-slate-300">
                ©2026 Omsons. All rights reserved.
              </p>
            </div>
          </form>

          {/* ── Image panel ────────────────────────────────────────────── */}
          {/*
            overflow-hidden on the section clips the image.
            absolute inset-0 makes the img fill the div exactly.
            object-cover + object-left-center covers without distortion,
            cropping from the right side while keeping the subject visible.
          */}
          <div className="relative hidden bg-[#0150C6] lg:block">
            <img
              src="/login2.png"
              alt="Omsons laboratory glassware"
              className="absolute inset-0 h-full w-full object-cover"
            />
          </div>

        </section>
      </div>

      {showNotice && (
        <div>
          <div
  className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-4 py-6 backdrop-blur-md"
  onClick={() => setShowNotice(false)}
  aria-hidden="true"
>
  <div
    role="dialog"
    aria-modal="true"
    aria-labelledby="testing-phase-title"
    className="relative w-full max-w-[460px] rounded-3xl bg-zinc-100 p-6 text-center text-slate-900 shadow-[0_30px_80px_rgba(15,23,42,0.28)] ring-1 ring-black/5 sm:p-7"
    onClick={(event) => event.stopPropagation()}
  >
    {/* Close button */}
    <button
      type="button"
      onClick={() => setShowNotice(false)}
      aria-label="Close"
      className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus:ring-4 focus:ring-slate-100"
    >
    </button>

    {/* Icon */}
    <div className="mx-auto flex h-19 w-19 items-center justify-center rounded-full ">
      <img
        src={LOGO_SRC}
        alt="Omsons Logo"
        className="h-19 w-19 object-contain"
      />
    </div>

    <p className="mt-4 text-xs font-semibold uppercase tracking-[0.14em] text-black">
Welcome to the Omsons Partner Portal
    </p>

    <p
      id="testing-phase-title"
      className="mt-2 text-lg font-semibold tracking-[-0.01em] text-slate-950 sm:text-xl"
    >
      Thank You for Being With Us
    </p>

    <p className="mt-3 text-sm leading-6 text-slate-600 sm:text-[15px]">
     We appreciate your continued trust in Omsons. Our new Order Management System is designed to provide a seamless, transparent, and efficient ordering experience, empowering you to serve your customers with confidence.
    </p>

    <div className="mt-5 rounded-2xl  px-4 py-3 text-sm leading-6">
Together, we build success.    </div>

    <div className="mt-6 flex justify-center">
      {/* <button
        type="button"
        onClick={() => setShowNotice(false)}
        className="inline-flex h-11 w-full items-center justify-center rounded-full bg-amber-500 px-5 text-sm font-semibold text-white shadow-[0_12px_24px_rgba(245,158,11,0.28)] transition hover:bg-amber-600 focus:outline-none focus:ring-4 focus:ring-amber-200 sm:w-auto sm:px-8"
      >
        Let's Get Started
      </button> */}
    </div>
  </div>
</div>
        </div>
      )}
    </main>
  )
}
