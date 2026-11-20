"use client"

import { useState, type FormEvent, type Ref } from "react"
import Image from "next/image"
import { Eye, EyeOff, RotateCcw } from "lucide-react"
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp"
import { cn } from "@/lib/utils"

// Shared with page.tsx, which cannot export anything but the page itself.
export const cardClass =
  "mx-auto w-full max-w-[400px] shrink-0 rounded-[2rem] bg-white px-8 py-9 shadow-[0_10px_40px_rgba(15,23,42,0.14)] lg:mx-0"

export const inputClass =
  "h-12 w-full rounded-full bg-[#ebebeb] px-6 text-[15px] text-slate-900 outline-none transition placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-[#0a9bdb]"

const labelClass = "mb-2 block pl-2 text-[17px] text-[#0a9bdb]"

const otpSlotClass =
  "h-11 w-10 rounded-xl border-0 bg-[#ebebeb] text-[15px] font-bold text-slate-900 first:rounded-xl last:rounded-xl data-[active=true]:bg-white data-[active=true]:ring-2 data-[active=true]:ring-[#0a9bdb]"

export const SPAM_FOLDER_HINT = "Didn't receive the code? Please check your spam folder."

// Every code entry box goes through here, so none can ship without the spam-folder hint.
export function OtpCodeField({
  value,
  onChange,
  onComplete,
  disabled,
  inputRef,
  notice,
}: {
  value: string
  onChange: (value: string) => void
  onComplete?: (value: string) => void
  disabled?: boolean
  inputRef?: Ref<HTMLInputElement>
  notice?: string
}) {
  return (
    <>
      <span className="mb-2 block pl-2 text-[15px] text-[#0a9bdb]">Verification Code</span>
      <InputOTP
        maxLength={6}
        value={value}
        onChange={onChange}
        onComplete={onComplete}
        disabled={disabled}
        containerClassName="w-full"
        ref={inputRef}
      >
        <InputOTPGroup className="w-full justify-between gap-1.5">
          {[0, 1, 2, 3, 4, 5].map((slot) => (
            <InputOTPSlot key={slot} index={slot} className={otpSlotClass} />
          ))}
        </InputOTPGroup>
      </InputOTP>

      {notice && <p className="mt-2 text-[12px] text-slate-500">{notice}</p>}
      <p className="mt-1 text-[11px] text-slate-400">{SPAM_FOLDER_HINT}</p>
    </>
  )
}

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "include",
  })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok && data?.status !== false, message: typeof data?.message === "string" ? data.message : "" }
}

export default function ForgotPasswordForm({
  initialEmail,
  onDone,
  onBack,
}: {
  initialEmail: string
  onDone: (email: string, message: string) => void
  onBack: () => void
}) {
  const [email, setEmail] = useState(initialEmail)
  const [codeSent, setCodeSent] = useState(false)
  const [notice, setNotice] = useState("")
  const [otp, setOtp] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const codeComplete = otp.length === 6

  const sendCode = async () => {
    setError("")
    if (!email.trim()) return setError("Email or username is required")

    try {
      setLoading(true)
      const res = await postJson("/api/auth/password-reset/request", { email })
      if (!res.ok) return setError("Unable to send the code. Please try again.")
      setCodeSent(true)
      setOtp("")
      setNotice(res.message)
    } catch (err: unknown) {
      console.error("Password reset request error:", err)
      setError("Server error")
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!codeSent) return sendCode()

    setError("")
    if (!codeComplete) return setError("Enter the 6-digit code")
    if (password.length < 10) return setError("Password must be at least 10 characters")
    if (password !== confirm) return setError("Passwords do not match")

    try {
      setLoading(true)
      const res = await postJson("/api/auth/password-reset/confirm", { email, otp, newPassword: password })
      if (!res.ok) return setError(res.message || "Invalid or expired code")
      onDone(email, res.message)
    } catch (err: unknown) {
      console.error("Password reset confirm error:", err)
      setError("Server error")
    } finally {
      setLoading(false)
    }
  }

  return (
    <form className={cardClass} onSubmit={handleSubmit}>
      <Image
        src="/Omsons_Logo.png"
        alt="Omsons Germany"
        width={7052}
        height={4172}
        sizes="120px"
        className="h-auto w-[120px] hue-rotate-[185deg]"
      />
      <h1 className="mt-10 text-[34px] font-bold leading-none text-slate-900">Reset Password</h1>
      <p className="mt-3 text-[15px] leading-snug text-slate-400">
        {codeSent
          ? "Enter the code we emailed you, then choose a new password."
          : "We'll email you a code to reset your password."}
      </p>

      <div className="mt-8 space-y-6">
        <label className="block">
          <span className={labelClass}>Email or Username</span>
          <input
            type="text"
            placeholder="Enter your email or username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={codeSent}
            autoComplete="username"
            className={cn(inputClass, "disabled:text-slate-500")}
          />
          {!codeSent && (
            <span className="mt-2 block pl-2 text-[12px] text-slate-400">
              Admins and accountants: contact your administrator to reset your password.
            </span>
          )}
        </label>

        {codeSent && (
          <div>
            <OtpCodeField value={otp} onChange={setOtp} disabled={loading} notice={notice} />
            <div className="mt-2 flex justify-end">
              <button
                type="button"
                onClick={sendCode}
                disabled={loading}
                className="flex items-center gap-1.5 text-[12px] font-semibold text-brand-600 hover:text-brand-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RotateCcw size={12} />
                Resend Code
              </button>
            </div>
          </div>
        )}

        {/* The new password fields appear once the full code is in. */}
        {codeSent && codeComplete && (
          <>
            <label className="block">
              <span className={labelClass}>New Password</span>
              <div className="relative">
                <input
                  type={showPw ? "text" : "password"}
                  placeholder="At least 10 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  maxLength={200}
                  autoComplete="new-password"
                  autoFocus
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

            <label className="block">
              <span className={labelClass}>Confirm Password</span>
              <input
                type={showPw ? "text" : "password"}
                placeholder="Re-enter the new password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                maxLength={200}
                autoComplete="new-password"
                className={inputClass}
              />
            </label>
          </>
        )}
      </div>

      {error && (
        <p className="mt-4 rounded-xl border border-red-100 bg-red-50 px-4 py-2.5 text-[12px] font-semibold text-red-600">
          {error}
        </p>
      )}

      <div className="mt-10 flex items-center justify-between gap-4">
        <button type="button" onClick={onBack} className="text-[13px] text-brand-600 hover:text-brand-500">
          Back to Login
        </button>
        <button
          type="submit"
          disabled={loading || (codeSent && !codeComplete)}
          className="h-12 min-w-[150px] rounded-full bg-[#0a9bdb] px-6 text-[17px] font-semibold text-white shadow-[0_10px_24px_rgba(10,155,219,0.3)] transition hover:-translate-y-0.5 hover:bg-[#088bc6] active:translate-y-0 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {loading ? "Please wait..." : codeSent ? "Update Password" : "Send Code"}
        </button>
      </div>
    </form>
  )
}
