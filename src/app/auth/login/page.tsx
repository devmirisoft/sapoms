"use client"

import { useEffect, useRef, useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import Image from "next/image"
import {
  ChartColumnIncreasing,
  Eye,
  EyeOff,
  Globe,
  Handshake,
  Lightbulb,
  RotateCcw,
  Settings,
  ShieldCheck,
  Users,
  UsersRound,
} from "lucide-react"
import { persistAuthenticatedSession, type StoredUser } from "@/lib/roleAccess"
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp"
import { cn } from "@/lib/utils"


const LOGO_SRC = "/Omsons_Logo.png"

const PILLARS = [
  { icon: Handshake, label: "Stronger Partnerships" },
  { icon: ChartColumnIncreasing, label: "Better Business" },
  { icon: Settings, label: "Efficient Operations" },
  { icon: Users, label: "Shared Growth" },
]

const HIGHLIGHTS = [
  { icon: Lightbulb, top: "Innovation for a", bottom: "Brighter Tomorrow" },
  { icon: UsersRound, top: "Customer", bottom: "Satisfaction" },
  { icon: Globe, top: "Delivering Quality to", bottom: "80+ Countries" },
  { icon: ShieldCheck, top: "Trusted for", bottom: "40+ Years" },
]

const inputClass =
  "h-12 w-full rounded-full bg-[#ebebeb] px-6 text-[15px] text-slate-900 outline-none transition placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-[#0a9bdb]"

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

      // A keep-alive connection the dev/prod server closes mid-POST surfaces as
      // "Failed to fetch" before the request is ever handled. One retry covers it.
      const post = () => fetch("/api/auth/login", {
        method: "POST",
        body: formData,
        credentials: "include",
      })
      const res = await post().catch(post)
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
    <main className="relative h-screen overflow-hidden bg-[#f6f6f6] text-slate-950">
      <Image src="/background.png" alt="" fill priority sizes="100vw" className="object-cover" />

      <div className="relative flex h-full items-center gap-10 px-4 sm:px-10 xl:gap-14 xl:px-16">

        {/* ── Form card ──────────────────────────────────────────────── */}
        <form
          className="mx-auto w-full max-w-[400px] shrink-0 rounded-[2rem] bg-white px-8 py-9 shadow-[0_10px_40px_rgba(15,23,42,0.14)] lg:mx-0"
          onSubmit={handleLogin}
        >
          {/* Header */}
          {/* ponytail: hue-rotate recolors the transparent orange logo to brand blue; swap for a blue PNG if one is made */}
          <Image
            src="/Omsons_Logo.png"
            alt="Omsons Germany"
            width={7052}
            height={4172}
            sizes="120px"
            className="h-auto w-[120px] hue-rotate-[185deg]"
          />
          <h1 className="mt-10 text-[34px] font-bold leading-none text-slate-900">Login</h1>
          <p className="mt-3 text-[15px] leading-snug text-slate-400">
            Sign in with your assigned account. Your role is detected automatically
          </p>

          {/* Fields */}
          <div className="mt-8 space-y-6">
            <label className="block">
              <span className="mb-2 block pl-2 text-[17px] text-[#0a9bdb]">Email or Username</span>
              <input
                type="text"
                placeholder="Enter your email or username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                className={inputClass}
              />
            </label>

            <label className="block">
              <span className="mb-2 block pl-2 text-[17px] text-[#0a9bdb]">Password</span>
              <div className="relative">
                <input
                  type={showPw ? "text" : "password"}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  className={cn(inputClass, "pr-14")}
                />
                <button
                  type="button"
                  onClick={() => setShowPw((visible) => !visible)}
                  className="absolute right-4 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-slate-400 transition hover:bg-white hover:text-slate-700"
                  aria-label={showPw ? "Hide password" : "Show password"}
                  title={showPw ? "Hide password" : "Show password"}
                >
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </label>
          </div>

          {/* Dealer second factor: slides open only after the password check passes. */}
          <div
            className={cn(
              "grid transition-all duration-300 ease-out",
              showOtp ? "mt-4 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
            )}
          >
            <div className="overflow-hidden">
              <span className="mb-2 block pl-2 text-[15px] text-[#0a9bdb]">Verification Code</span>
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
                      className="h-11 w-10 rounded-xl border-0 bg-[#ebebeb] text-[15px] font-bold text-slate-900 first:rounded-xl last:rounded-xl data-[active=true]:bg-white data-[active=true]:ring-2 data-[active=true]:ring-[#0a9bdb]"
                    />
                  ))}
                </InputOTPGroup>
              </InputOTP>

              {notice && <p className="mt-2 text-[12px] text-slate-500">{notice}</p>}

              <div className="mt-2 flex items-center justify-between">
                <button
                  type="button"
                  onClick={resetOtp}
                  className="text-[12px] font-semibold text-slate-500 hover:text-slate-800"
                >
                  Use Password
                </button>
                <button
                  type="button"
                  onClick={handleRequestOtp}
                  disabled={otpLoading}
                  className="flex items-center gap-1.5 text-[12px] font-semibold text-[#0a9bdb] hover:text-[#077bb0] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <RotateCcw size={12} />
                  Resend Code
                </button>
              </div>
            </div>
          </div>

          {/* Forgot password */}
          <div className="mt-3 flex justify-end">
            <button type="button" className="text-[13px] text-[#0a9bdb] hover:text-[#077bb0]">
              Forgot Password?
            </button>
          </div>

          {/* Error message */}
          {error && (
            <p className="mt-4 rounded-xl border border-red-100 bg-red-50 px-4 py-2.5 text-[12px] font-semibold text-red-600">
              {error}
            </p>
          )}

          {/* Submit */}
          <div className="mt-10 flex justify-end">
            <button
              type="submit"
              disabled={loading || otpLoading}
              className="h-12 min-w-[150px] rounded-full bg-[#0a9bdb] px-8 text-[20px] font-semibold text-white shadow-[0_10px_24px_rgba(10,155,219,0.3)] transition hover:-translate-y-0.5 hover:bg-[#088bc6] active:translate-y-0 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {showOtp ? (otpLoading ? "Verifying..." : "Verify & Login") : loading ? "Signing in..." : "Login"}
            </button>
          </div>
        </form>

        {/* ── Brand panel ────────────────────────────────────────────── */}
        <section className="relative hidden h-full min-w-0 flex-1 items-center lg:flex">
          <div className="relative z-10 w-full max-w-[480px] shrink-0">
            <h2 className="text-[clamp(2rem,3vw,3.25rem)] font-bold leading-[1.1] tracking-tight text-[#0a9bdb]">
              Welcome to <br />
              <span className="whitespace-nowrap text-[#2dbe60]">Dealer Management</span> <br />
              Software
            </h2>
            <div className="mt-5 h-1 w-40 rounded-full bg-[#2dbe60]" />
            <p className="mt-6 text-[17px] leading-relaxed text-slate-700">
              Your partner in Laboratory Glassware, Filtration Products and Laboratory Solutions.
            </p>

            <ul className="mt-10 flex gap-6">
              {PILLARS.map(({ icon: Icon, label }) => (
                <li key={label} className="flex w-20 flex-col items-center text-center">
                  <span className="grid h-16 w-16 place-items-center rounded-full bg-white/80 text-[#2dbe60] shadow-[0_4px_12px_rgba(15,23,42,0.15)]">
                    <Icon size={30} strokeWidth={1.8} />
                  </span>
                  <span className="mt-3 text-[13px] leading-tight text-slate-600">{label}</span>
                </li>
              ))}
            </ul>

            <ul className="mt-12 grid grid-cols-2 gap-x-8 gap-y-8">
              {HIGHLIGHTS.map(({ icon: Icon, top, bottom }) => (
                <li key={bottom} className="flex items-center gap-3">
                  <Icon size={44} strokeWidth={1.5} className="shrink-0 text-[#0a9bdb]" />
                  <span className="text-[12px] leading-tight text-slate-700">
                    {top}
                    <span className="block text-[14px] font-semibold text-[#2dbe60]">{bottom}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/*
            Products: cartridge, volumetric flask, hot plate. Everything is sized in --u (1% of the
            hot plate's height), capped by viewport height and by the free width (1.3cqw ≈ 100/76.5,
            the group being 76.5u wide). Margins are measured from the opaque pixels so the cartridge
            body, flask bulb and beaker sit an equal 4u apart; the hot plate image starts its beaker
            41% in, hence its large negative margin, and the flask sits in front of the plate base.
          */}
          <div className="hidden min-w-0 flex-1 self-stretch py-[4vh] [container-type:inline-size] xl:flex">
            <div className="flex w-full items-end justify-end [--u:min(0.92vh,1.3cqw)]">
              <Image
                src="/cartridge.png"
                alt="Omsons filtration cartridge"
                width={1460}
                height={3023}
                sizes="15vw"
                className="mb-[calc(var(--u)*17)] h-[calc(var(--u)*48)] w-auto"
              />
              <Image
                src="/volumetric%20flask.png"
                alt="Omsons volumetric flask"
                width={1361}
                height={4002}
                sizes="15vw"
                className="relative z-10 mb-[calc(var(--u)*15)] ml-[calc(var(--u)*1.5)] h-[calc(var(--u)*62)] w-auto"
              />
              <Image
                src="/hot%20plate.png"
                alt="Omsons hotplate with magnetic stirrer"
                width={2593}
                height={5616}
                sizes="25vw"
                className="ml-[calc(var(--u)*-15.5)] h-[calc(var(--u)*100)] w-auto"
              />
            </div>
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
      {/* hue-rotate + brightness turns the orange logo sky blue (~#0891E2) */}
      <img
        src={LOGO_SRC}
        alt="Omsons Logo"
        className="h-19 w-19 object-contain hue-rotate-[190deg] brightness-110"
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
