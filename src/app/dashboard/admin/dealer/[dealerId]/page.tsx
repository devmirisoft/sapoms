'use client'

import { useMemo, useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import {
  Eye, EyeOff, ArrowLeft, User, KeyRound, Wallet,
  ShieldCheck, Users, FileText, Search, Check, X, Loader2,
} from 'lucide-react'
import { normalizeDealerContacts, type DealerContact } from '@/lib/dealerForm'

type DealerStatus = "active" | "inactive" | "suspended"

function normalizeDealerStatus(value: unknown): DealerStatus {
  const normalized = String(value ?? "").trim().toLowerCase()
  if (normalized === "active") return "active"
  if (normalized === "suspended") return "suspended"
  return "inactive"
}

function toApiStatus(value: DealerStatus) {
  return value === "active" ? "ACTIVE" : value === "suspended" ? "SUSPENDED" : "INACTIVE"
}

type StaffOption = {
  staff_id: string
  staff_name: string
  staff_roletype: string
  role?: string
  status?: string
}

type DiagnosticPassword = {
  id: string
  expiresAt: string
  revokedAt: string | null
  lastUsedAt: string | null
  createdAt: string
  createdBy: string
}

const ADMIN_DEALERS_URL = "/api/admin/dealers"
const ADMIN_STAFF_URL = "/api/admin/staff"
const DEALER_LIST_ROUTE = "/dashboard/admin/dealer/DealerList"

async function parseJsonResponse<T>(res: Response): Promise<T> {
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  if (/^\s*</.test(text)) throw new Error("Expected JSON but received HTML")
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error("Invalid JSON response")
  }
}

function staffRoleLabel(staff: StaffOption) {
  const roleType = String(staff.staff_roletype || staff.role || "").toUpperCase()
  if (roleType === "1") return "Exe"
  if (roleType === "2") return "Field Exe"
  if (roleType === "RSM") return "RSM"
  if (roleType === "ASM") return "ASM"
  return "Staff"
}

function splitCsv(value: unknown) {
  if (Array.isArray(value)) return value.map(String).map(s => s.trim()).filter(Boolean)
  return String(value || "").split(",").map(s => s.trim()).filter(Boolean)
}

function SectionCard({
  title, icon, children,
}: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
      <div className="flex items-center gap-2 mb-5 pb-3 border-b border-gray-100">
        <span className="text-indigo-500">{icon}</span>
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">{title}</h2>
      </div>
      {children}
    </div>
  )
}

function InputField({
  label, value, onChange, type = "text", placeholder, required = true, hint,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  placeholder?: string
  required?: boolean
  hint?: string
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">
        {label}
        {required && <span className="text-orange-500 ml-0.5">*</span>}
      </label>
      <input
        required={required}
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder || label}
        className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-900 bg-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
      />
      {hint && <p className="text-[11px] text-gray-400">{hint}</p>}
    </div>
  )
}

function PriorityPill() {
  return (
    <span
      title="Priority person — used for calls"
      className="rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white"
    >
      Priority
    </span>
  )
}

const STATUS_STYLES: Record<DealerStatus, string> = {
  active: "bg-emerald-50 text-emerald-700 border-emerald-200",
  inactive: "bg-gray-100 text-gray-500 border-gray-200",
  suspended: "bg-red-50 text-red-600 border-red-200",
}

function StatusBadge({ status }: { status: DealerStatus }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${STATUS_STYLES[status]}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  )
}

export default function EditDealerPage() {
  const router = useRouter()
  const params = useParams()
  const dealerId = String(params.dealerId || "")

  const [isLoading,  setIsLoading]  = useState(false)
  const [isSaving,   setIsSaving]   = useState(false)
  const [toastMsg,   setToastMsg]   = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>([])
  const [staffSearch, setStaffSearch] = useState("")

  // Form fields
  const [name,           setName]           = useState("")
  const [email,          setEmail]          = useState("")
  const [number,         setNumber]         = useState("")
  const [city,           setCity]           = useState("")
  const [address,        setAddress]        = useState("")
  const [pincode,        setPincode]        = useState("")
  const [username,       setUsername]       = useState("")
  const [diagnosticPassword, setDiagnosticPassword] = useState("")
  const [dealercode,     setDealercode]     = useState("")
  const [gst,            setGst]            = useState("")
  const [discount,       setDiscount]       = useState("")
  const [creditdays,     setCreditdays]     = useState("")
  const [annualtarget,   setAnnualtarget]   = useState("")
  const [currentlimit,   setCurrentlimit]   = useState("")
  const [notes,          setNotes]          = useState("")
  const [priorityPerson, setPriorityPerson] = useState<"primary" | "secondary">("primary")
  const [secondaryContactName,  setSecondaryContactName]  = useState("")
  const [secondaryContactPhone, setSecondaryContactPhone] = useState("")
  const [secondaryContactEmail, setSecondaryContactEmail] = useState("")
  const [additionalContacts, setAdditionalContacts] = useState<DealerContact[]>([])
  const updateAdditionalContact = (index: number, field: keyof DealerContact, value: string) =>
    setAdditionalContacts(prev => prev.map((contact, position) => (position === index ? { ...contact, [field]: value } : contact)))
  const [dealerid,       setDealerid]       = useState("")
  const [status,         setStatus]         = useState<DealerStatus>("active")
  const [walletStatus,   setWalletStatus]   = useState<"active" | "inactive">("inactive")
  const [statusSaving,   setStatusSaving]   = useState(false)
  const [showDiagnosticPassword, setShowDiagnosticPassword] = useState(false)
  const [diagnosticExpiryHours, setDiagnosticExpiryHours] = useState("24")
  const [diagnosticSaving, setDiagnosticSaving] = useState(false)
  const [diagnosticRevoking, setDiagnosticRevoking] = useState(false)
  const [activeDiagnosticPassword, setActiveDiagnosticPassword] = useState<DiagnosticPassword | null>(null)
  const [assignedStaffIds, setAssignedStaffIds] = useState<string[]>([])
  const [initialAssignedStaffIds, setInitialAssignedStaffIds] = useState<string[]>([])
  const [existingStaffNames, setExistingStaffNames] = useState("")

  // Toast auto-dismiss
  useEffect(() => {
    if (!toastMsg) return
    const t = setTimeout(() => setToastMsg(null), 3500)
    return () => clearTimeout(t)
  }, [toastMsg])

  useEffect(() => {
    let active = true

    const loadDealer = async () => {
      if (!dealerId) return
      setIsLoading(true)
      try {
        const res = await fetch(`${ADMIN_DEALERS_URL}/${encodeURIComponent(dealerId)}`, { credentials: "include" })
        const json = await parseJsonResponse<any>(res)
        if (!active) return
        if (json.status) {
          const d = json.data
          setName(d.Dealer_Name        || "")
          setEmail(d.Dealer_Email       || "")
          setNumber(d.Dealer_Number     || "")
          setCity(d.Dealer_City         || "")
          setPincode(d.Dealer_Pincode   || "")
          setAddress(d.Dealer_Address   || "")
          setUsername(d.Dealer_Username || "")
          setDiscount(d.discount        || "")
          setDealercode(d.Dealer_Dealercode || "")
          setGst(d.gst                  || "")
          setCreditdays(d.creditdays    || "")
          setNotes(d.Dealer_Notes       || "")
          setDealerid(d.Dealer_Id       || "")
          setAnnualtarget(d.annualtarget || "")
          setCurrentlimit(d.currentlimit || "")
          setPriorityPerson(d.priorityContact === "secondary" ? "secondary" : "primary")
          setSecondaryContactName(d.secondaryContactName || "")
          setSecondaryContactPhone(d.secondaryContactPhone || "")
          setSecondaryContactEmail(d.secondaryContactEmail || "")
          setAdditionalContacts(normalizeDealerContacts(d.additionalContacts))
          setExistingStaffNames(d.staffname || "")
          const initialStaffIds = splitCsv(d.assignedstaff)
          setAssignedStaffIds(initialStaffIds)
          setInitialAssignedStaffIds(initialStaffIds)
          setStatus(normalizeDealerStatus(d.status))
          setWalletStatus(String(d.walletStatus || "").toLowerCase() === "active" ? "active" : "inactive")
        } else {
          setToastMsg({ text: json.msz || "Failed to load dealer", type: 'error' })
        }
      } catch {
        if (active) setToastMsg({ text: "Failed to load dealer data", type: 'error' })
      } finally {
        if (active) setIsLoading(false)
      }
    }

    const loadDiagnosticPassword = async () => {
      try {
        const res = await fetch(`${ADMIN_DEALERS_URL}/${encodeURIComponent(dealerId)}/diagnostic-password`, { credentials: "include" })
        const json = await parseJsonResponse<any>(res)
        if (active) setActiveDiagnosticPassword(json.data || null)
      } catch {
        if (active) setActiveDiagnosticPassword(null)
      }
    }

    const loadStaff = async () => {
      try {
        const res = await fetch(`${ADMIN_STAFF_URL}?page=1&limit=100`, { credentials: "include" })
        const json = await parseJsonResponse<any>(res)
        if (active) {
          setStaffOptions((json.data || []).filter((staff: StaffOption) => {
            const role = String(staff.role || "").toUpperCase()
            const status = String(staff.status || "").toUpperCase()
            return ["STAFF", "RSM", "ASM"].includes(role) && (!status || status === "ACTIVE")
          }))
        }
      } catch {
        console.error("Failed to fetch staff")
      }
    }

    loadDealer()
    loadDiagnosticPassword()
    loadStaff()
    return () => { active = false }
  }, [dealerId])

  const toggleStaffId = (id: string) => {
    setAssignedStaffIds(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id])
  }

  const isWalletActive = walletStatus === "active"

  const filteredStaffOptions = useMemo(() => {
    const q = staffSearch.trim().toLowerCase()
    if (!q) return staffOptions
    return staffOptions.filter(s =>
      s.staff_name.toLowerCase().includes(q) || staffRoleLabel(s).toLowerCase().includes(q)
    )
  }, [staffOptions, staffSearch])

  const selectAllFiltered = () => {
    setAssignedStaffIds(prev => Array.from(new Set([...prev, ...filteredStaffOptions.map(s => s.staff_id)])))
  }

  const clearAllStaff = () => setAssignedStaffIds([])

  // Derive staffname string from current selection (matches what AddDealerForm does)
  const getStaffNames = () =>
    assignedStaffIds
      .map(id => staffOptions.find(s => s.staff_id === id)?.staff_name ?? "")
      .filter(Boolean)
      .join(",") || existingStaffNames

  const handleDiagnosticPasswordSave = async () => {
    const incompleteContact = additionalContacts.findIndex((contact) => !contact.name.trim() || !contact.phone.trim() || !contact.email.trim())
    if (incompleteContact >= 0) {
      setToastMsg({ text: `Contact ${incompleteContact + 3} needs a name, phone and email`, type: 'error' })
      return
    }
    const resolvedDealerId = dealerid || dealerId
    if (!resolvedDealerId) {
      setToastMsg({ text: "Missing dealer id", type: "error" })
      return
    }
    if (diagnosticPassword.length < 5) {
      setToastMsg({ text: "Diagnostic password must be at least 5 characters", type: "error" })
      return
    }

    setDiagnosticSaving(true)
    try {
      const response = await fetch(`${ADMIN_DEALERS_URL}/${encodeURIComponent(resolvedDealerId)}/diagnostic-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ password: diagnosticPassword, expiryHours: diagnosticExpiryHours }),
      })
      const payload = await response.json()
      if (!response.ok || !payload.success) throw new Error(payload.message ?? "Failed to save diagnostic password")
      setActiveDiagnosticPassword(payload.data || null)
      setToastMsg({ text: "Diagnostic password saved", type: "success" })
    } catch (error) {
      setToastMsg({ text: error instanceof Error ? error.message : "Failed to save diagnostic password", type: "error" })
    } finally {
      setDiagnosticSaving(false)
    }
  }

  const handleDiagnosticPasswordRevoke = async () => {
    const resolvedDealerId = dealerid || dealerId
    if (!resolvedDealerId) return
    setDiagnosticRevoking(true)
    try {
      const response = await fetch(`${ADMIN_DEALERS_URL}/${encodeURIComponent(resolvedDealerId)}/diagnostic-password`, {
        method: "DELETE",
        credentials: "include",
      })
      const payload = await response.json()
      if (!response.ok || !payload.success) throw new Error(payload.message ?? "Failed to revoke diagnostic password")
      setActiveDiagnosticPassword(null)
      setToastMsg({ text: "Diagnostic password revoked", type: "success" })
    } catch (error) {
      setToastMsg({ text: error instanceof Error ? error.message : "Failed to revoke diagnostic password", type: "error" })
    } finally {
      setDiagnosticRevoking(false)
    }
  }

  const copyDiagnosticPassword = async () => {
    if (!diagnosticPassword) return
    await navigator.clipboard?.writeText(diagnosticPassword)
    setToastMsg({ text: "Diagnostic password copied", type: "success" })
  }

  const handleStatusSave = async () => {
    const resolvedDealerId = dealerid || dealerId
    if (!resolvedDealerId) {
      setToastMsg({ text: "Missing dealer id", type: 'error' })
      return
    }

    setStatusSaving(true)
    try {
      const response = await fetch(`${ADMIN_DEALERS_URL}/${encodeURIComponent(resolvedDealerId)}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status: toApiStatus(normalizeDealerStatus(status)) }),
      })
      const payload = await response.json()
      if (!response.ok || !payload.success) throw new Error(payload.message ?? "Failed to update dealer status")
      setToastMsg({ text: `Dealer marked ${status === "active" ? "active" : "inactive"}`, type: 'success' })
    } catch (error) {
      console.error("Failed to update dealer status", error)
      setToastMsg({
        text: error instanceof Error && error.message ? error.message : "Failed to update dealer status",
        type: 'error',
      })
    } finally {
      setStatusSaving(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const normalizedStaffIds = Array.from(new Set(assignedStaffIds.map((id) => id.trim()).filter(Boolean))).sort()
    const initialNormalizedStaffIds = Array.from(new Set(initialAssignedStaffIds.map((id) => id.trim()).filter(Boolean))).sort()
    const staffChanged = normalizedStaffIds.length !== initialNormalizedStaffIds.length
      || normalizedStaffIds.some((id, index) => id !== initialNormalizedStaffIds[index])

    if (!normalizedStaffIds.length) {
      setToastMsg({ text: "Please assign at least one staff member", type: 'error' })
      return
    }
    const resolvedDealerId = dealerid || dealerId
    if (!resolvedDealerId) {
      setToastMsg({ text: "Missing dealer id", type: 'error' })
      return
    }
    setIsSaving(true)
    try {
      const updateBody: Record<string, unknown> = {
        businessName: name,
        email,
        phone: number,
        city,
        address,
        pincode,
        dealerCode: dealercode,
        gstin: gst,
        discountPercent: discount,
        annualTargetPaise: annualtarget,
        notes,
        priorityContact: priorityPerson,
        secondaryContactName,
        secondaryContactPhone,
        secondaryContactEmail,
        additionalContacts,
        walletActive: isWalletActive,
      }
      if (!isWalletActive) {
        updateBody.creditDays = creditdays
        updateBody.creditLimitPaise = currentlimit
      }

      const updateResponse = await fetch(`${ADMIN_DEALERS_URL}/${encodeURIComponent(resolvedDealerId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(updateBody),
      })
      const updatePayload = await updateResponse.json()
      if (!updateResponse.ok || !updatePayload.success) throw new Error(updatePayload.message ?? "Failed to update dealer")

      // Re-sync the fields the server may normalize (wallet status, stored amounts).
      const saved = updatePayload.data
      if (saved) {
        setWalletStatus(String(saved.walletStatus || "").toLowerCase() === "active" ? "active" : "inactive")
        setAnnualtarget(saved.annualtarget || "")
        setCurrentlimit(saved.currentlimit || "")
        setCreditdays(saved.creditdays || "")
      }

      if (staffChanged) {
        const staffResponse = await fetch(ADMIN_DEALERS_URL + "/" + encodeURIComponent(resolvedDealerId) + "/staff", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ staffIds: normalizedStaffIds }),
        })
        const staffPayload = await staffResponse.json()
        if (!staffResponse.ok || !staffPayload.success) throw new Error(staffPayload.message ?? "Failed to update staff assignments")
        setExistingStaffNames(getStaffNames())
        setInitialAssignedStaffIds(normalizedStaffIds)
      }
      setToastMsg({ text: "Dealer updated successfully", type: 'success' })
    } catch (error) {
      console.error("Failed to update dealer", error)
      setToastMsg({
        text: error instanceof Error && error.message ? error.message : "Failed to update dealer",
        type: 'error',
      })
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-7 h-7 text-indigo-600 animate-spin" />
          <p className="text-sm text-gray-500">Loading dealer data...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100 pb-28">

      {/* Toast */}
      {toastMsg && (
        <div className={`fixed top-5 right-5 z-50 text-sm px-4 py-3 rounded-lg shadow-lg transition-all flex items-center gap-2 ${
          toastMsg.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-500 text-white'
        }`}>
          {toastMsg.type === 'success'
            ? <Check className="w-3.5 h-3.5" strokeWidth={2.5} />
            : <X className="w-3.5 h-3.5" strokeWidth={2.5} />
          }
          {toastMsg.text}
        </div>
      )}

      <div className="p-6 admin-page-shell">

        {/* Header */}
        <div className="mb-8">
          <button
            onClick={() => router.push(DEALER_LIST_ROUTE)}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-4 transition"
          >
            <ArrowLeft className="w-4 h-4" strokeWidth={2} />
            Back to Dealer List
          </button>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-3xl font-bold text-gray-900">Edit Dealer</h1>
            <StatusBadge status={status} />
          </div>
          <p className="text-sm text-gray-500 mt-1">
            {name ? `Updating ${name}` : "Update dealer information and settings"}
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="flex flex-col gap-6">

            {/* Basic Info */}
            <SectionCard title="Basic Information" icon={<User className="w-4 h-4" />}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <InputField label="Name"             value={name}    onChange={setName}    placeholder="Full name" />
                <InputField label="Email Address"    value={email}   onChange={setEmail}   type="email" placeholder="dealer@email.com" />
                <InputField label="WhatsApp Number"  value={number}  onChange={setNumber}  type="number" placeholder="10-digit number" />
                <InputField label="City"             value={city}    onChange={setCity}    placeholder="City / Location" />
                <InputField label="Address"          value={address} onChange={setAddress} placeholder="Street address" />
                <InputField label="Pin Code"         value={pincode} onChange={setPincode} type="number" placeholder="6-digit pin code" />
              </div>
            </SectionCard>

            {/* Point of Contact */}
            <SectionCard title="Point of Contact" icon={<Users className="w-4 h-4" />}>
              <div className="flex flex-col gap-6">
                <div className="rounded-lg border border-gray-100 bg-gray-50/60 p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-600">Contact 1</span>
                    {priorityPerson === "primary" && <PriorityPill />}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                    <InputField label="Person Name" value={name}   onChange={setName}   placeholder="Person name" />
                    <InputField label="Phone No."   value={number}  onChange={setNumber} type="number" placeholder="10-digit number" />
                    <InputField label="Email"       value={email}   onChange={setEmail}  type="email" placeholder="dealer@email.com" />
                  </div>
                </div>

                <div className="rounded-lg border border-gray-100 bg-gray-50/60 p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-600">Contact 2</span>
                    {priorityPerson === "secondary" && <PriorityPill />}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                    <InputField label="Second Person Name" value={secondaryContactName}  onChange={setSecondaryContactName}  required={false} placeholder="Second contact name" />
                    <InputField label="Second Phone No."   value={secondaryContactPhone} onChange={setSecondaryContactPhone} required={false} type="number" placeholder="Second phone number" />
                    <InputField label="Second Email"       value={secondaryContactEmail} onChange={setSecondaryContactEmail} required={false} type="email" placeholder="Second email" />
                  </div>
                </div>

                {additionalContacts.map((contact, index) => (
                  <div key={index} className="rounded-lg border border-gray-100 bg-gray-50/60 p-4">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-gray-600">Contact {index + 3}</span>
                      <button
                        type="button"
                        onClick={() => setAdditionalContacts(prev => prev.filter((_, position) => position !== index))}
                        className="text-xs font-semibold text-red-500 hover:text-red-600"
                      >
                        Remove
                      </button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                      <InputField label="Person Name" value={contact.name}  onChange={value => updateAdditionalContact(index, "name", value)}  placeholder="Contact name" />
                      <InputField label="Phone No."   value={contact.phone} onChange={value => updateAdditionalContact(index, "phone", value)} type="number" placeholder="Phone number" />
                      <InputField label="Email"       value={contact.email} onChange={value => updateAdditionalContact(index, "email", value)} type="email" placeholder="Email" />
                    </div>
                  </div>
                ))}

                <div>
                  <button
                    type="button"
                    onClick={() => setAdditionalContacts(prev => [...prev, { name: "", phone: "", email: "" }])}
                    className="rounded-lg border border-indigo-300 px-4 py-2 text-xs font-semibold text-indigo-600 transition hover:bg-indigo-50"
                  >
                    + Add Contact
                  </button>
                </div>

                <div className="flex flex-col gap-1.5 md:max-w-xs">
                  <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">
                    Priority Person
                    <span className="text-orange-500 ml-0.5">*</span>
                  </label>
                  <select
                    value={priorityPerson}
                    onChange={e => setPriorityPerson(e.target.value === "secondary" ? "secondary" : "primary")}
                    className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
                  >
                    <option value="primary">Contact 1</option>
                    <option value="secondary">Contact 2</option>
                  </select>
                  <p className="text-[11px] text-gray-400">Contact used for calls</p>
                </div>
              </div>
            </SectionCard>

            {/* Account & Auth */}
            <SectionCard title="Account & Credentials" icon={<KeyRound className="w-4 h-4" />}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <InputField label="Dealer Code" value={dealercode} onChange={setDealercode} placeholder="Unique dealer code" />
                <InputField label="Username"    value={username}   onChange={setUsername}   placeholder="Login username" />
                <div className="flex flex-col gap-1.5 md:col-span-2 rounded-lg border border-gray-100 bg-gray-50/60 p-4">
                  <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">
                    Diagnostic Password
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-start">
                    <div className="relative">
                      <input
                        type={showDiagnosticPassword ? "text" : "password"}
                        value={diagnosticPassword}
                        onChange={e => setDiagnosticPassword(e.target.value)}
                        placeholder="Temporary testing password"
                        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 pr-10 text-sm text-gray-900 placeholder-gray-400 transition focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                      <button
                        type="button"
                        onClick={() => setShowDiagnosticPassword(value => !value)}
                        className="absolute inset-y-0 right-2 flex items-center rounded-md px-2 text-gray-400 transition hover:text-indigo-600"
                        aria-label={showDiagnosticPassword ? "Hide diagnostic password" : "Show diagnostic password"}
                        title={showDiagnosticPassword ? "Hide password" : "Show password"}
                      >
                        {showDiagnosticPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="1"
                        max="2160"
                        value={diagnosticExpiryHours}
                        onChange={e => setDiagnosticExpiryHours(e.target.value)}
                        aria-label="Diagnostic password expiry in hours"
                        className="w-20 rounded-lg border border-gray-200 bg-white px-2 py-2.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                      <span className="text-[11px] text-gray-400 whitespace-nowrap">hrs</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <button type="button" onClick={copyDiagnosticPassword} disabled={!diagnosticPassword} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50">
                      Copy
                    </button>
                    <button type="button" onClick={handleDiagnosticPasswordSave} disabled={diagnosticSaving || diagnosticPassword.length < 5} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50 flex items-center gap-1.5">
                      {diagnosticSaving && <Loader2 className="w-3 h-3 animate-spin" />}
                      {diagnosticSaving ? "Saving..." : "Save Password"}
                    </button>
                  </div>
                  {activeDiagnosticPassword ? (
                    <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-700 mt-1">
                      Active until {new Date(activeDiagnosticPassword.expiresAt).toLocaleString()}.
                      {activeDiagnosticPassword.lastUsedAt ? ` Last used ${new Date(activeDiagnosticPassword.lastUsedAt).toLocaleString()}.` : " Not used yet."}
                      <button type="button" onClick={handleDiagnosticPasswordRevoke} disabled={diagnosticRevoking} className="ml-2 font-semibold text-emerald-800 underline disabled:opacity-50">
                        {diagnosticRevoking ? "Revoking..." : "Revoke"}
                      </button>
                    </div>
                  ) : (
                    <p className="text-[11px] text-gray-400 mt-1">Dealer&apos;s original password remains unchanged. Expiry is in hours, from 1 to 2160.</p>
                  )}
                </div>
                <InputField label="GST No."     value={gst}        onChange={setGst}        placeholder="15-character GST number" />
              </div>
            </SectionCard>

            {/* Financial */}
            <SectionCard title={isWalletActive ? "Wallet / Advance Settings" : "Financial Settings"} icon={<Wallet className="w-4 h-4" />}>
              <div className="mb-5 flex flex-col gap-1.5 md:max-w-xs">
                <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">
                  Payment Type
                  <span className="text-orange-500 ml-0.5">*</span>
                </label>
                <select
                  value={isWalletActive ? "advance" : "credit"}
                  onChange={e => setWalletStatus(e.target.value === "advance" ? "active" : "inactive")}
                  className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
                >
                  <option value="credit">Credit</option>
                  <option value="advance">Advance (Wallet)</option>
                </select>
                <p className="text-[11px] text-gray-400">
                  Choosing Advance activates the dealer wallet; Credit deactivates it. Applied when you save.
                </p>
              </div>

              {isWalletActive && (
                <div className="mb-5 rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                  Wallet is active for this dealer. Credit days and current limit are managed by the wallet balance flow.
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <InputField label="Discount %"     value={discount}     onChange={setDiscount}     type="number" placeholder="e.g. 10" />
                <InputField label="Annual Target"  value={annualtarget} onChange={setAnnualtarget} type="number" placeholder="Amount in Rs" required={false} />
                {!isWalletActive && (
                  <>
                    <InputField label="Credit Days"    value={creditdays}   onChange={setCreditdays}   type="number" placeholder="e.g. 30" />
                    <InputField label="Current Limit"  value={currentlimit} onChange={setCurrentlimit} type="number" placeholder="Credit limit in Rs" />
                  </>
                )}
              </div>
            </SectionCard>

            {/* Status */}
            <SectionCard title="Account Status" icon={<ShieldCheck className="w-4 h-4" />}>
              <div className="flex flex-col gap-3 max-w-sm">
                <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">
                  Dealer Status
                </label>
                <select
                  value={status}
                  onChange={(e) => setStatus(normalizeDealerStatus(e.target.value))}
                  className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
                <p className="text-[11px] text-gray-400">
                  Inactive dealers will still remain in the list, but access checks will block the account.
                </p>
                <button
                  type="button"
                  onClick={handleStatusSave}
                  disabled={statusSaving}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60 w-fit"
                >
                  {statusSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {statusSaving ? "Saving..." : "Save Status"}
                </button>
              </div>
            </SectionCard>

            {/* Staff Assignment */}
            <SectionCard title="Staff Assignment" icon={<Users className="w-4 h-4" />}>
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">
                    Assign Staff
                    <span className="text-orange-500 ml-0.5">*</span>
                  </label>
                  <span className="text-xs font-medium text-indigo-600 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-full">
                    {assignedStaffIds.length} selected
                  </span>
                </div>

                <div className="relative">
                  <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={staffSearch}
                    onChange={e => setStaffSearch(e.target.value)}
                    placeholder="Search staff by name or role..."
                    className="w-full pl-9 pr-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-900 bg-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
                  />
                </div>

                <div className="flex items-center gap-3 text-xs">
                  <button type="button" onClick={selectAllFiltered} className="text-indigo-600 font-medium hover:underline">
                    Select all{staffSearch ? " (filtered)" : ""}
                  </button>
                  <span className="text-gray-300">|</span>
                  <button type="button" onClick={clearAllStaff} className="text-gray-500 font-medium hover:underline">
                    Clear all
                  </button>
                </div>

                <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-72 overflow-y-auto">
                  {filteredStaffOptions.length === 0 && (
                    <p className="text-sm text-gray-400 px-3 py-6 text-center">No staff match your search.</p>
                  )}
                  {filteredStaffOptions.map(staff => {
                    const checked = assignedStaffIds.includes(staff.staff_id)
                    return (
                      <label
                        key={staff.staff_id}
                        className={`flex items-center gap-3 px-3 py-2.5 text-sm cursor-pointer transition ${
                          checked ? "bg-indigo-50/70" : "hover:bg-gray-50"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleStaffId(staff.staff_id)}
                          className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span className="text-gray-900">{staff.staff_name}</span>
                        <span className="ml-auto text-[11px] text-gray-400 border border-gray-200 rounded-full px-2 py-0.5">
                          {staffRoleLabel(staff)}
                        </span>
                      </label>
                    )
                  })}
                </div>
              </div>
            </SectionCard>

            {/* Notes */}
            <SectionCard title="Notes" icon={<FileText className="w-4 h-4" />}>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">Internal Notes</label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={4}
                  placeholder="Add any notes about this dealer..."
                  className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-900 bg-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition resize-none"
                />
              </div>
            </SectionCard>

          </div>

          {/* Sticky actions bar */}
          <div className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur border-t border-gray-200 px-6 py-4 flex items-center justify-end gap-3 z-40">
            <button
              type="button"
              onClick={() => router.push(DEALER_LIST_ROUTE)}
              className="px-5 py-2.5 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="flex items-center gap-2 px-6 py-2.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed transition font-medium"
            >
              {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
              {isSaving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}