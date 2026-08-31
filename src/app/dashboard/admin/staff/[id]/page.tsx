'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Eye, EyeOff } from 'lucide-react'
import { STATE_OPTIONS, CITIES_BY_STATE, citiesForStates } from '@/lib/places'
import { SALES_REGION_OPTIONS } from '@/lib/salesRegions'
import { WAREHOUSE_OPTIONS } from '@/lib/warehouses'

const ADMIN_STAFF_URL = '/api/admin/staff'
const STAFF_LIST_ROUTE = '/dashboard/admin/staff/stafflist'

const roleOptions = [
  { value: 'EXECUTIVE', label: 'Sales Manager', authRole: 'STAFF', staffRoleType: '1' },
  { value: 'FIELD_EXECUTIVE', label: 'Staff', authRole: 'STAFF', staffRoleType: '2' },
  { value: 'RSM', label: 'RSM', authRole: 'RSM', staffRoleType: 'RSM' },
  { value: 'ASM', label: 'ASM', authRole: 'ASM', staffRoleType: 'ASM' },
  { value: 'NSM', label: 'NSM', authRole: 'NSM', staffRoleType: undefined },
] as const

const GENDER_OPTIONS = ['Male', 'Female', 'Other'] as const
const MARITAL_STATUS_OPTIONS = ['Single', 'Married', 'Divorced', 'Widowed'] as const
const QUALIFICATION_OPTIONS = ['12th Pass', 'Bachelors', 'Masters', 'PhD'] as const

type DiagnosticPassword = { id: string; expiresAt: string; lastUsedAt: string | null; createdBy: string }

type StaffFormRole = '' | typeof roleOptions[number]['value']
type StaffOption = {
  id: string
  name: string
  email?: string
  role: string
  staffRoleType: string
  parentRsmId?: string
  assignedStates: string[]
  assignedCities: string[]
  parentRsm?: { id: string; name: string } | null
}

function getRoleOption(value: StaffFormRole) {
  return roleOptions.find((option) => option.value === value)
}

function toFormRole(data: { role?: string; staff_roletype?: string; staffRoleType?: string }): StaffFormRole {
  if (data.role === 'RSM') return 'RSM'
  if (data.role === 'ASM') return 'ASM'
  if (data.role === 'NSM') return 'NSM'

  const staffType = data.staff_roletype || data.staffRoleType
  if (staffType === '2') return 'FIELD_EXECUTIVE'
  if (staffType === '1') return 'EXECUTIVE'
  return ''
}

function displayStaff(option?: StaffOption) {
  return option ? `${option.name}${option.email ? ` (${option.email})` : ''}` : ''
}

function mapStaffOption(value: unknown): StaffOption {
  const row = value as Record<string, unknown>
  return {
    id: String(row.id || row.staff_id || ''),
    name: String(row.name || row.staff_name || ''),
    email: String(row.email || row.staff_email || ''),
    role: String(row.role || '').toUpperCase(),
    staffRoleType: String(row.staffRoleType || row.staff_roletype || '').toUpperCase(),
    parentRsmId: String(row.parentRsmId || row.parent_rsm_id || ''),
    assignedStates: Array.isArray(row.assignedStates)
      ? row.assignedStates.map(String)
      : Array.isArray(row.assigned_states)
        ? row.assigned_states.map(String)
        : [],
    assignedCities: Array.isArray(row.assignedCities)
      ? row.assignedCities.map(String)
      : Array.isArray(row.assigned_cities)
        ? row.assigned_cities.map(String)
        : [],
    parentRsm: row.parentRsm as StaffOption['parentRsm'],
  }
}

function staffRowsFromResponse(json: unknown): unknown[] {
  const payload = json as { data?: unknown; items?: unknown }
  if (Array.isArray(payload?.data)) return payload.data
  if (payload?.data && typeof payload.data === 'object') {
    const nested = payload.data as { items?: unknown }
    if (Array.isArray(nested.items)) return nested.items
  }
  if (Array.isArray(payload?.items)) return payload.items
  return []
}

function apiMessage(payload: unknown, fallback: string) {
  const row = payload as { message?: unknown; msz?: unknown; error?: { message?: unknown } } | null
  return String(row?.message || row?.msz || row?.error?.message || fallback)
}

function InputField({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  required = true,
  disabled = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
  placeholder?: string
  required?: boolean
  disabled?: boolean
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">
        {label}
        {required && <span className="text-orange-500 ml-0.5">*</span>}
      </label>
      <input
        required={required}
        disabled={disabled}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder || label}
        className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-900 bg-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition disabled:bg-gray-50 disabled:text-gray-500"
      />
    </div>
  )
}

function TextAreaField({
  label,
  value,
  onChange,
  placeholder,
  required = true,
  disabled = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  required?: boolean
  disabled?: boolean
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">
        {label}
        {required && <span className="text-orange-500 ml-0.5">*</span>}
      </label>
      <textarea
        required={required}
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder || label}
        rows={2}
        className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-900 bg-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition resize-none disabled:bg-gray-50 disabled:text-gray-500"
      />
    </div>
  )
}

function SelectField({
  label,
  value,
  onChange,
  options,
  required = true,
  placeholder,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: readonly string[]
  required?: boolean
  placeholder?: string
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">
        {label}
        {required && <span className="text-orange-500 ml-0.5">*</span>}
      </label>
      <select
        required={required}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
      >
        <option value="" disabled>
          {placeholder || `Select ${label.toLowerCase()}`}
        </option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  )
}

export default function EditStaffPage() {
  const router = useRouter()
  const params = useParams()
  const id = String(params.id || '')

  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [toastMsg, setToastMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  const [staffid, setStaffid] = useState('')
  const [name, setName] = useState('')
  const [designation, setDesignation] = useState('')
  const [location, setLocation] = useState('')
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')

  // Personal information added to match Add Staff.
  const [mobileNo, setMobileNo] = useState('')
  const [alternateNo, setAlternateNo] = useState('')
  const [permanentAddress, setPermanentAddress] = useState('')
  const [localAddress, setLocalAddress] = useState('')
  const [sameAddress, setSameAddress] = useState(false)
  const [gender, setGender] = useState('')
  const [dob, setDob] = useState('')
  const [nationality, setNationality] = useState('')
  const [maritalStatus, setMaritalStatus] = useState('')
  const [qualification, setQualification] = useState('')
  const [emergencyContactNo1, setEmergencyContactNo1] = useState('')
  const [emergencyContactNo2, setEmergencyContactNo2] = useState('')

  const [role, setRole] = useState<StaffFormRole>('')
  const [salesRegion, setSalesRegion] = useState('')
  const [warehouse, setWarehouse] = useState('')
  const [parentRsmId, setParentRsmId] = useState('')
  const [parentAsmId, setParentAsmId] = useState('')
  const [assignedStates, setAssignedStates] = useState<string[]>([])
  const [assignedCities, setAssignedCities] = useState<string[]>([])
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>([])

  const [diagnosticPassword, setDiagnosticPassword] = useState('')
  const [showDiagnosticPassword, setShowDiagnosticPassword] = useState(false)
  const [diagnosticExpiryHours, setDiagnosticExpiryHours] = useState('24')
  const [diagnosticSaving, setDiagnosticSaving] = useState(false)
  const [diagnosticRevoking, setDiagnosticRevoking] = useState(false)
  const [activeDiagnosticPassword, setActiveDiagnosticPassword] = useState<DiagnosticPassword | null>(null)

  const diagnosticPasswordUrl = `${ADMIN_STAFF_URL}/${encodeURIComponent(id)}/diagnostic-password`

  const placeOptions = STATE_OPTIONS
  const citiesByState = CITIES_BY_STATE

  const rsmOptions = useMemo(
    () => staffOptions.filter((staff) => staff.role === 'RSM'),
    [staffOptions],
  )
  const asmOptions = useMemo(
    () => staffOptions.filter((staff) => staff.role === 'ASM' || staff.staffRoleType === 'ASM'),
    [staffOptions],
  )
  const selectedRsm = rsmOptions.find((staff) => staff.id === parentRsmId)
  const selectedAsm = asmOptions.find((staff) => staff.id === parentAsmId)
  const selectedAsmRsm = rsmOptions.find((staff) => staff.id === selectedAsm?.parentRsmId) || selectedAsm?.parentRsm || null
  const asmStateOptions = useMemo(
    () => (selectedRsm?.assignedStates?.length ? selectedRsm.assignedStates : []),
    [selectedRsm],
  )
  const stateOptions = role === 'RSM' ? placeOptions : asmStateOptions
  // Cities a Sales Manager may cover: every city within its ASM's assigned states, grouped by state.
  const smCitiesByState = useMemo(() => {
    const scope = selectedAsm?.assignedStates?.length ? selectedAsm.assignedStates : []
    return scope
      .map((state) => ({ state, cities: citiesByState[state] ?? [] }))
      .filter((group) => group.cities.length)
  }, [selectedAsm, citiesByState])

  useEffect(() => {
    if (!toastMsg) return
    const timeout = setTimeout(() => setToastMsg(null), 3500)
    return () => clearTimeout(timeout)
  }, [toastMsg])

  useEffect(() => {
    if (!id) return
    let active = true
    fetch(diagnosticPasswordUrl, { credentials: 'include' })
      .then((response) => (response.ok ? response.json() : null))
      .then((json) => { if (active) setActiveDiagnosticPassword(json?.data || null) })
      .catch(() => { if (active) setActiveDiagnosticPassword(null) })
    return () => { active = false }
  }, [id, diagnosticPasswordUrl])

  const handleDiagnosticPasswordSave = async () => {
    if (diagnosticPassword.length < 5) {
      setToastMsg({ text: 'Diagnostic password must be at least 5 characters', type: 'error' })
      return
    }
    setDiagnosticSaving(true)
    try {
      const response = await fetch(diagnosticPasswordUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password: diagnosticPassword, expiryHours: diagnosticExpiryHours }),
      })
      const payload = await response.json()
      if (!response.ok || !payload.success) throw new Error(payload.message ?? 'Failed to save diagnostic password')
      setActiveDiagnosticPassword(payload.data || null)
      setToastMsg({ text: 'Diagnostic password saved', type: 'success' })
    } catch (error) {
      setToastMsg({ text: error instanceof Error ? error.message : 'Failed to save diagnostic password', type: 'error' })
    } finally {
      setDiagnosticSaving(false)
    }
  }

  const handleDiagnosticPasswordRevoke = async () => {
    setDiagnosticRevoking(true)
    try {
      const response = await fetch(diagnosticPasswordUrl, { method: 'DELETE', credentials: 'include' })
      const payload = await response.json()
      if (!response.ok || !payload.success) throw new Error(payload.message ?? 'Failed to revoke diagnostic password')
      setActiveDiagnosticPassword(null)
      setToastMsg({ text: 'Diagnostic password revoked', type: 'success' })
    } catch (error) {
      setToastMsg({ text: error instanceof Error ? error.message : 'Failed to revoke diagnostic password', type: 'error' })
    } finally {
      setDiagnosticRevoking(false)
    }
  }

  const copyDiagnosticPassword = async () => {
    if (!diagnosticPassword) return
    await navigator.clipboard?.writeText(diagnosticPassword)
    setToastMsg({ text: 'Diagnostic password copied', type: 'success' })
  }

  useEffect(() => {
    fetch(`${ADMIN_STAFF_URL}?page=1&limit=200`, { credentials: 'include' })
      .then((response) => response.json())
      .then((json) => {
        setStaffOptions(
          staffRowsFromResponse(json)
            .map(mapStaffOption)
            .filter((staff: StaffOption) => staff.id && staff.name),
        )
      })
      .catch(() => setStaffOptions([]))
  }, [])

  useEffect(() => {
    if (role !== 'ASM') return
    const validStates = new Set(asmStateOptions)
    setAssignedStates((current) => current.filter((state) => validStates.has(state)))
  }, [role, parentRsmId, asmStateOptions])

  useEffect(() => {
    if (!id) return

    const fetchStaff = async () => {
      setIsLoading(true)
      try {
        const response = await fetch(`${ADMIN_STAFF_URL}/${encodeURIComponent(id)}`, {
          credentials: 'include',
        })
        const json = await response.json().catch(() => null)

        if (!response.ok || !(json?.success || json?.status)) {
          throw new Error(apiMessage(json, 'Failed to load staff'))
        }

        const data = (json.data || {}) as Record<string, unknown>

        setName(String(data.staff_name || data.name || ''))
        setEmail(String(data.staff_email || data.email || ''))
        setDesignation(String(data.staff_designation || data.designation || ''))
        setLocation(String(data.staff_location || data.location || ''))
        setUsername(String(data.staff_username || data.username || data.staff_email || data.email || ''))

        setMobileNo(String(data.mobileNo || data.staff_mobile || data.mobile_no || ''))
        setAlternateNo(String(data.alternateNo || data.alternate_no || ''))
        setPermanentAddress(String(data.permanentAddress || data.permanent_address || ''))
        const loadedPermanent = String(data.permanentAddress || data.permanent_address || '')
        const loadedLocal = String(data.localAddress || data.local_address || '')
        setLocalAddress(loadedLocal)
        setSameAddress(Boolean(loadedPermanent) && loadedPermanent === loadedLocal)
        setGender(String(data.gender || data.staff_gender || ''))
        setDob(String(data.dob || data.staff_dob || '').slice(0, 10))
        setNationality(String(data.nationality || data.staff_nationality || ''))
        setMaritalStatus(String(data.maritalStatus || data.marital_status || ''))
        setQualification(String(data.qualification || data.staff_qualification || ''))
        setEmergencyContactNo1(String(data.emergencyContactNo1 || data.emergency_contact_no_1 || ''))
        setEmergencyContactNo2(String(data.emergencyContactNo2 || data.emergency_contact_no_2 || ''))

        setRole(toFormRole(data as { role?: string; staff_roletype?: string; staffRoleType?: string }))
        setSalesRegion(String(data.sales_region || data.salesRegion || ''))
        setWarehouse(String(data.warehouse || ''))
        setParentRsmId(String(data.parentRsmId || data.parent_rsm_id || ''))
        setParentAsmId(String(data.parentAsmId || data.parent_asm_id || ''))
        setAssignedStates(
          Array.isArray(data.assignedStates)
            ? data.assignedStates.map(String)
            : Array.isArray(data.assigned_states)
              ? data.assigned_states.map(String)
              : [],
        )
        setAssignedCities(
          Array.isArray(data.assignedCities)
            ? data.assignedCities.map(String)
            : Array.isArray(data.assigned_cities)
              ? data.assigned_cities.map(String)
              : [],
        )
        setStaffid(String(data.staff_id || data.id || ''))
      } catch (error) {
        setToastMsg({
          text: error instanceof Error ? error.message : 'Failed to load staff data',
          type: 'error',
        })
      } finally {
        setIsLoading(false)
      }
    }

    fetchStaff()
  }, [id])

  const resetHierarchy = () => {
    setParentRsmId('')
    setParentAsmId('')
    setAssignedStates([])
    setAssignedCities([])
  }

  const handleParentAsmChange = (nextParentAsmId: string) => {
    setParentAsmId(nextParentAsmId)
    if (role !== 'EXECUTIVE') return
    // Scoped to the newly selected ASM's states — drop cities it does not cover.
    const validCities = new Set(citiesForStates(asmOptions.find((staff) => staff.id === nextParentAsmId)?.assignedStates || []))
    setAssignedCities((current) => {
      const next = current.filter((city) => validCities.has(city))
      return next.length === current.length ? current : next
    })
  }

  const handleParentRsmChange = (nextParentRsmId: string) => {
    setParentRsmId(nextParentRsmId)
    if (role !== 'ASM') return

    const validStates = new Set(
      rsmOptions.find((staff) => staff.id === nextParentRsmId)?.assignedStates || [],
    )
    setAssignedStates((current) => current.filter((state) => validStates.has(state)))
  }

  const toggleState = (state: string) => {
    setAssignedStates((current) =>
      current.includes(state)
        ? current.filter((entry) => entry !== state)
        : [...current, state].sort((a, b) => a.localeCompare(b)),
    )
  }

  const toggleCity = (city: string) => {
    setAssignedCities((current) =>
      current.includes(city)
        ? current.filter((entry) => entry !== city)
        : [...current, city].sort((a, b) => a.localeCompare(b)),
    )
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const resolvedStaffId = staffid || id
    const selectedRole = getRoleOption(role)

    if (!resolvedStaffId) {
      setToastMsg({ text: 'Missing staff id', type: 'error' })
      return
    }
    if (!selectedRole) return

    setIsSaving(true)
    try {
      const response = await fetch(`${ADMIN_STAFF_URL}/${encodeURIComponent(resolvedStaffId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name,
          email,
          designation,
          location,
          mobileNo,
          alternateNo,
          permanentAddress,
          localAddress: sameAddress ? permanentAddress : localAddress,
          gender,
          dob,
          nationality,
          maritalStatus,
          qualification,
          emergencyContactNo1,
          emergencyContactNo2,
          role: selectedRole.authRole,
          staffRoleType: selectedRole.staffRoleType,
          salesRegion: selectedRole.authRole === 'RSM' ? salesRegion : undefined,
          warehouse: role === 'FIELD_EXECUTIVE' ? warehouse : undefined,
          parentRsmId: role === 'ASM' || role === 'FIELD_EXECUTIVE' ? parentRsmId : undefined,
          parentAsmId: role === 'EXECUTIVE' ? parentAsmId : undefined,
          assignedStates: role === 'ASM' || role === 'RSM' ? assignedStates : undefined,
          assignedCities: role === 'EXECUTIVE' ? assignedCities : undefined,
        }),
      })

      const payload = await response.json().catch(() => null)
      if (!response.ok || payload?.success === false) {
        throw new Error(apiMessage(payload, 'Failed to update staff'))
      }

      setToastMsg({ text: 'Staff updated successfully', type: 'success' })
      router.push(STAFF_LIST_ROUTE)
    } catch (error) {
      setToastMsg({
        text: error instanceof Error ? error.message : 'Failed to update staff',
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
          <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-500">Loading staff data...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100">
      {toastMsg && (
        <div
          className={`fixed top-5 right-5 z-50 text-sm px-4 py-3 rounded-lg shadow-lg transition-all flex items-center gap-2 ${
            toastMsg.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-500 text-white'
          }`}
        >
          {toastMsg.text}
        </div>
      )}

      <div className="p-6 admin-page-shell">
        <div className="mb-8">
          <button
            type="button"
            onClick={() => router.push(STAFF_LIST_ROUTE)}
            className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-4 transition"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Back to Staff List
          </button>
          <h1 className="text-3xl font-bold text-gray-900">Edit Staff</h1>
          <p className="text-sm text-gray-500 mt-1">Update staff member information</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="flex flex-col gap-6">
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-5 pb-3 border-b border-gray-100">
                Personal Information
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <InputField label="Full Name" value={name} onChange={setName} placeholder="Enter full name" />
                <InputField
                  label="Designation"
                  value={designation}
                  onChange={setDesignation}
                  placeholder="e.g. Sales Manager"
                  required={false}
                />
                <InputField
                  label="Email"
                  value={email}
                  onChange={setEmail}
                  type="email"
                  placeholder="staff@company.com"
                />
                <InputField
                  label="Location"
                  value={location}
                  onChange={setLocation}
                  placeholder="City / Branch"
                  required={false}
                />
                <InputField
                  label="Mobile No."
                  value={mobileNo}
                  onChange={setMobileNo}
                  type="tel"
                  placeholder="10-digit mobile number"
                />
                <InputField
                  label="Alternate Number"
                  value={alternateNo}
                  onChange={setAlternateNo}
                  type="tel"
                  placeholder="Alternate contact number"
                  required={false}
                />
                <SelectField
                  label="Gender"
                  value={gender}
                  onChange={setGender}
                  options={GENDER_OPTIONS}
                />
                <InputField
                  label="Date of Birth"
                  value={dob}
                  onChange={setDob}
                  type="date"
                />
                <InputField
                  label="Nationality"
                  value={nationality}
                  onChange={setNationality}
                  placeholder="e.g. Indian"
                  required={false}
                />
                <SelectField
                  label="Marital Status"
                  value={maritalStatus}
                  onChange={setMaritalStatus}
                  options={MARITAL_STATUS_OPTIONS}
                  required={false}
                />
                <SelectField
                  label="Qualification"
                  value={qualification}
                  onChange={setQualification}
                  options={QUALIFICATION_OPTIONS}
                  required={false}
                />
                <InputField
                  label="Emergency Contact No. 1"
                  value={emergencyContactNo1}
                  onChange={setEmergencyContactNo1}
                  type="tel"
                  placeholder="Emergency contact number"
                  required={false}
                />
                <InputField
                  label="Emergency Contact No. 2"
                  value={emergencyContactNo2}
                  onChange={setEmergencyContactNo2}
                  type="tel"
                  placeholder="Emergency contact number"
                  required={false}
                />
                <TextAreaField
                  label="Permanent Address"
                  value={permanentAddress}
                  onChange={setPermanentAddress}
                  placeholder="Permanent address"
                />
                <div className="flex flex-col gap-1.5">
                  <TextAreaField
                    label="Local Address"
                    value={sameAddress ? permanentAddress : localAddress}
                    onChange={setLocalAddress}
                    placeholder="Current / local address"
                    required={false}
                    disabled={sameAddress}
                  />
                  <label className="flex items-center gap-2 text-xs text-gray-600">
                    <input
                      type="checkbox"
                      checked={sameAddress}
                      onChange={(event) => setSameAddress(event.target.checked)}
                      className="rounded border-gray-300"
                    />
                    Same as permanent address
                  </label>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-5 pb-3 border-b border-gray-100">
                Account Settings
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <InputField
                  label="Username"
                  value={username}
                  onChange={setUsername}
                  placeholder="Login username"
                  required={false}
                  disabled
                />

                <div className="flex flex-col gap-1.5 md:col-span-2 rounded-lg border border-gray-100 bg-gray-50/60 p-4">
                  <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">
                    Diagnostic Password
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-start">
                    <div className="relative">
                      <input
                        type={showDiagnosticPassword ? 'text' : 'password'}
                        value={diagnosticPassword}
                        onChange={(event) => setDiagnosticPassword(event.target.value)}
                        placeholder="Temporary testing password"
                        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 pr-10 text-sm text-gray-900 placeholder-gray-400 transition focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                      <button
                        type="button"
                        onClick={() => setShowDiagnosticPassword((value) => !value)}
                        className="absolute inset-y-0 right-2 flex items-center rounded-md px-2 text-gray-400 transition hover:text-indigo-600"
                        aria-label={showDiagnosticPassword ? 'Hide diagnostic password' : 'Show diagnostic password'}
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
                        onChange={(event) => setDiagnosticExpiryHours(event.target.value)}
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
                    <button type="button" onClick={handleDiagnosticPasswordSave} disabled={diagnosticSaving || diagnosticPassword.length < 5} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50">
                      {diagnosticSaving ? 'Saving...' : 'Save Password'}
                    </button>
                  </div>
                  {activeDiagnosticPassword ? (
                    <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-700 mt-1">
                      Active until {new Date(activeDiagnosticPassword.expiresAt).toLocaleString()}.
                      {activeDiagnosticPassword.lastUsedAt ? ` Last used ${new Date(activeDiagnosticPassword.lastUsedAt).toLocaleString()}.` : ' Not used yet.'}
                      <button type="button" onClick={handleDiagnosticPasswordRevoke} disabled={diagnosticRevoking} className="ml-2 font-semibold text-emerald-800 underline disabled:opacity-50">
                        {diagnosticRevoking ? 'Revoking...' : 'Revoke'}
                      </button>
                    </div>
                  ) : (
                    <p className="text-[11px] text-gray-400 mt-1">Staff member&apos;s original password remains unchanged. Expiry is in hours, from 1 to 2160.</p>
                  )}
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">
                    Role<span className="text-orange-500 ml-0.5">*</span>
                  </label>
                  <select
                    required
                    value={role}
                    onChange={(event) => {
                      const nextRole = event.target.value as StaffFormRole
                      setRole(nextRole)
                      setSalesRegion(nextRole === 'RSM' ? salesRegion : '')
                      setWarehouse(nextRole === 'FIELD_EXECUTIVE' ? warehouse : '')
                      resetHierarchy()
                    }}
                    className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
                  >
                    <option value="" disabled>Select a role</option>
                    {roleOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>

                {role === 'RSM' && (
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">
                      Region<span className="text-orange-500 ml-0.5">*</span>
                    </label>
                    <select
                      required
                      value={salesRegion}
                      onChange={(event) => setSalesRegion(event.target.value)}
                      className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
                    >
                      <option value="" disabled>Select region</option>
                      {SALES_REGION_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>
                )}

                {role === 'FIELD_EXECUTIVE' && (
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">
                      Warehouse<span className="text-orange-500 ml-0.5">*</span>
                    </label>
                    <select
                      required
                      value={warehouse}
                      onChange={(event) => setWarehouse(event.target.value)}
                      className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
                    >
                      <option value="" disabled>Select warehouse</option>
                      {WAREHOUSE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                    <span className="text-[11px] text-gray-500">Staff only see orders handled by their own warehouse.</span>
                  </div>
                )}

                {(role === 'ASM' || role === 'FIELD_EXECUTIVE') && (
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">
                      RSM<span className="text-orange-500 ml-0.5">*</span>
                    </label>
                    <select
                      required
                      value={parentRsmId}
                      onChange={(event) => handleParentRsmChange(event.target.value)}
                      className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
                    >
                      <option value="" disabled>Select RSM</option>
                      {rsmOptions.map((option) => (
                        <option key={option.id} value={option.id}>{displayStaff(option)}</option>
                      ))}
                    </select>
                  </div>
                )}

                {role === 'EXECUTIVE' && (
                  <>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">
                        ASM<span className="text-orange-500 ml-0.5">*</span>
                      </label>
                      <select
                        required
                        value={parentAsmId}
                        onChange={(event) => handleParentAsmChange(event.target.value)}
                        className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
                      >
                        <option value="" disabled>Select ASM</option>
                        {asmOptions.map((option) => (
                          <option key={option.id} value={option.id}>{displayStaff(option)}</option>
                        ))}
                      </select>
                    </div>

                    <InputField
                      label="RSM"
                      value={selectedAsmRsm?.name || ''}
                      onChange={() => {}}
                      placeholder="Auto-filled from ASM"
                      required={false}
                      disabled
                    />
                  </>
                )}

                {(role === 'ASM' || role === 'RSM') && (
                  <div className="md:col-span-2 flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">States</label>
                    <div className="max-h-52 overflow-y-auto rounded-lg border border-gray-200 bg-white p-2">
                      {stateOptions.length ? (
                        stateOptions.map((state) => (
                          <label
                            key={state}
                            className="flex cursor-pointer items-center gap-3 rounded px-2 py-1.5 text-sm hover:bg-gray-50"
                          >
                            <input
                              type="checkbox"
                              checked={assignedStates.includes(state)}
                              onChange={() => toggleState(state)}
                              className="h-4 w-4 accent-indigo-600"
                            />
                            <span>{state}</span>
                          </label>
                        ))
                      ) : (
                        <p className="px-2 py-2 text-sm text-gray-500">
                          {role === 'RSM' ? 'No states available.' : 'Select an RSM with assigned states.'}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {role === 'EXECUTIVE' && (
                  <div className="md:col-span-2 flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">Cities</label>
                    <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-200 bg-white p-2">
                      {smCitiesByState.length ? (
                        smCitiesByState.map(({ state, cities }) => (
                          <div key={state} className="mb-2 last:mb-0">
                            <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{state}</p>
                            {cities.map((city) => (
                              <label
                                key={city}
                                className="flex cursor-pointer items-center gap-3 rounded px-2 py-1.5 text-sm hover:bg-gray-50"
                              >
                                <input
                                  type="checkbox"
                                  checked={assignedCities.includes(city)}
                                  onChange={() => toggleCity(city)}
                                  className="h-4 w-4 accent-indigo-600"
                                />
                                <span>{city}</span>
                              </label>
                            ))}
                          </div>
                        ))
                      ) : (
                        <p className="px-2 py-2 text-sm text-gray-500">
                          {parentAsmId ? 'Selected ASM has no cities assigned.' : 'Select an ASM to choose cities.'}
                        </p>
                      )}
                    </div>
                    <span className="text-[11px] text-gray-500">Limited to the cities assigned to the selected ASM.</span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pb-6">
              <button
                type="button"
                onClick={() => router.push(STAFF_LIST_ROUTE)}
                className="px-5 py-2.5 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="flex items-center gap-2 px-6 py-2.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed transition font-medium"
              >
                {isSaving && (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                )}
                {isSaving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}