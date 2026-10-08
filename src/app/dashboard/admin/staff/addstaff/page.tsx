'use client'

import DateInput from "@/components/ui/date-input";
import { adultDobCutoff } from "@/lib/staffDob";
import { phoneInput, phoneInputProps } from "@/lib/fieldRules";
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff } from 'lucide-react'
import { STATE_OPTIONS, CITIES_BY_STATE, citiesForStates, statesForCities } from '@/lib/places'
import { SALES_REGION_OPTIONS } from '@/lib/salesRegions'
import { WAREHOUSE_OPTIONS } from '@/lib/warehouses'
import { cityScopeStates, pickReportsTo, regionRsm, reportsToGroups } from '@/lib/staffHierarchy'
import { RegionSelect, ReportsToSelect } from '@/components/staff/HierarchySelects'
import { showToast } from "@/components/ui/toast";

const roleOptions = [
  { value: 'EXECUTIVE', label: 'Sales Manager', authRole: 'STAFF', staffRoleType: '1', successMessage: 'Sales Manager created' },
  { value: 'FIELD_EXECUTIVE', label: 'Staff', authRole: 'STAFF', staffRoleType: '2', successMessage: 'Staff created' },
  { value: 'RSM', label: 'RSM', authRole: 'RSM', staffRoleType: 'RSM', successMessage: 'RSM created' },
  { value: 'ASM', label: 'ASM', authRole: 'ASM', staffRoleType: 'ASM', successMessage: 'ASM created' },
  { value: 'NSM', label: 'NSM', authRole: 'NSM', staffRoleType: undefined, successMessage: 'NSM created' },
] as const

const GENDER_OPTIONS = ['Male', 'Female', 'Other'] as const
const MARITAL_STATUS_OPTIONS = ['Single', 'Married', 'Divorced', 'Widowed'] as const
const QUALIFICATION_OPTIONS = ['12th Pass', 'Bachelors', 'Masters', 'PhD'] as const

type StaffFormRole = '' | typeof roleOptions[number]['value']
type StaffOption = { id: string; name: string; email?: string; role: string; staffRoleType: string; salesRegion: string; parentRsmId?: string; assignedStates: string[]; assignedCities: string[]; parentRsm?: { id: string; name: string } | null; status?: string }

function getRoleOption(value: StaffFormRole) { return roleOptions.find((option) => option.value === value) }
function displayStaff(option?: StaffOption) { return option ? `${option.name}${option.email ? ` (${option.email})` : ''}` : '' }
function staffName(value: unknown) { const row = value as Record<string, unknown>; return String(row.name || row.staff_name || '').trim() }
function staffId(value: unknown) { const row = value as Record<string, unknown>; return String(row.id || row.staff_id || '').trim() }
function mapStaffOption(value: unknown): StaffOption {
  const row = value as Record<string, unknown>
  return {
    id: staffId(row),
    name: staffName(row),
    email: String(row.email || row.staff_email || ''),
    role: String(row.role || '').toUpperCase(),
    staffRoleType: String(row.staffRoleType || row.staff_roletype || '').toUpperCase(),
    salesRegion: String(row.salesRegion || row.sales_region || '').toUpperCase(),
    parentRsmId: String(row.parentRsmId || row.parent_rsm_id || ''),
    assignedStates: Array.isArray(row.assignedStates) ? row.assignedStates.map(String) : Array.isArray(row.assigned_states) ? row.assigned_states.map(String) : [],
    assignedCities: Array.isArray(row.assignedCities) ? row.assignedCities.map(String) : Array.isArray(row.assigned_cities) ? row.assigned_cities.map(String) : [],
    parentRsm: row.parentRsm as StaffOption['parentRsm'],
    status: String(row.status || '').toUpperCase(),
  }
}

function FieldLabel({ label, required = true }: { label: string; required?: boolean }) {
  return (
    <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">
      {label}{required ? <span className="text-orange-500 ml-0.5">*</span> : null}
    </label>
  )
}

function InputField({ label, value, onChange, type = 'text', placeholder, required = true, readOnly = false, hint, max }: { label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; required?: boolean; readOnly?: boolean; hint?: string; max?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel label={label} required={required} />
      {type === 'date' ? (
        <DateInput
          required={required}
          max={max}
          value={value}
          onChange={e => onChange(e.target.value)}
          className={`px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition w-full ${readOnly ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : 'bg-white'}`}
        />
      ) : (
      <input
        required={required}
        {...(type === 'tel' ? phoneInputProps : { type })}
        value={value}
        onChange={e => onChange(type === 'tel' ? phoneInput(e.target.value) : e.target.value)}
        placeholder={placeholder || label}
        readOnly={readOnly}
        className={`px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition ${readOnly ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : 'bg-white'}`}
      />
      )}
      {hint ? <span className="text-[11px] text-gray-500">{hint}</span> : null}
    </div>
  )
}

function TextAreaField({ label, value, onChange, placeholder, required = true, disabled = false }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; required?: boolean; disabled?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel label={label} required={required} />
      <textarea
        required={required}
        disabled={disabled}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder || label}
        rows={2}
        className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-900 bg-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition resize-none disabled:bg-gray-50 disabled:text-gray-500"
      />
    </div>
  )
}

function SelectField({ label, value, onChange, options, required = true, placeholder }: { label: string; value: string; onChange: (v: string) => void; options: readonly string[]; required?: boolean; placeholder?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel label={label} required={required} />
      <select
        required={required}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition"
      >
        <option value="" disabled>{placeholder || `Select ${label.toLowerCase()}`}</option>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </div>
  )
}

export default function AddStaffPage() {
  const router = useRouter()
  const [isSaving, setIsSaving] = useState(false)

  // Personal info
  const [name, setName] = useState('')
  const [personalState, setPersonalState] = useState('')
  const [location, setLocation] = useState('')
  const [email, setEmail] = useState('')
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

  // Account settings
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [role, setRole] = useState<StaffFormRole>('')
  const [salesRegion, setSalesRegion] = useState('')
  const [warehouse, setWarehouse] = useState('')
  // Region an ASM / Sales Manager belongs to; the RSM role keeps its own salesRegion.
  const [region, setRegion] = useState('')
  const [regionStates, setRegionStates] = useState<Record<string, string[]>>({})
  const [parentRsmId, setParentRsmId] = useState('')
  const [parentAsmId, setParentAsmId] = useState('')
  const [rsmIds, setRsmIds] = useState<string[]>([])
  const [reportingManagerId, setReportingManagerId] = useState('')
  const [assignedStates, setAssignedStates] = useState<string[]>([])
  const [assignedCities, setAssignedCities] = useState<string[]>([])
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>([])
  const [nsmOptions, setNsmOptions] = useState<StaffOption[]>([])

  const placeOptions = STATE_OPTIONS
  const citiesByState = CITIES_BY_STATE
  const personalCityOptions = citiesByState[personalState] ?? []

  // Designation mirrors the selected role — the two are always kept in sync.
  const designation = getRoleOption(role)?.label ?? ''

  const rsmOptions = useMemo(() => staffOptions.filter((staff) => staff.role === 'RSM'), [staffOptions])
  // One region, one RSM — a region that already has one is not offered again.
  const rsmByRegion = useMemo(() => new Map(rsmOptions.filter((staff) => staff.salesRegion).map((staff) => [staff.salesRegion, staff])), [rsmOptions])
  const asmOptions = useMemo(() => staffOptions.filter((staff) => staff.role === 'ASM' || staff.staffRoleType === 'ASM'), [staffOptions])
  const selectedRsm = rsmOptions.find((staff) => staff.id === parentRsmId)
  const selectedAsm = asmOptions.find((staff) => staff.id === parentAsmId)
  const reportsTo = useMemo(() => reportsToGroups(staffOptions, region), [staffOptions, region])
  // An ASM's states come from its RSM, or from the region's own list when it has no RSM yet.
  const asmStateOptions = useMemo(() => selectedRsm ? selectedRsm.assignedStates : regionStates[region] ?? [], [selectedRsm, regionStates, region])
  const rsmAssignedStates = role === 'RSM' ? placeOptions : asmStateOptions
  // Cities available to a Sales Manager being created: every city within the
  // states of whoever they report to (their ASM, or the RSM directly), by state.
  const smCitiesByState = useMemo(() => {
    return cityScopeStates(staffOptions, parentAsmId, parentRsmId, regionStates[region] ?? [])
      .map((state) => ({ state, cities: citiesByState[state] ?? [] }))
      .filter((group) => group.cities.length)
  }, [staffOptions, parentAsmId, parentRsmId, regionStates, region, citiesByState])
  // Reporting manager: ASM reports to its RSM, Executive ("Sales Manager") to its ASM or straight to the RSM.
  // RSM has no parent staff record — its reporting manager is an NSM, picked explicitly below.
  // Staff are free and pick any number of RSMs instead.
  const reportingManagerLabel = role === 'ASM'
    ? selectedRsm?.name || ''
    : role === 'EXECUTIVE'
      ? selectedAsm?.name || selectedRsm?.name || ''
      : ''

  useEffect(() => {
    fetch('/api/admin/staff?page=1&limit=200', { credentials: 'include' })
      .then((res) => res.json())
      .then((json) => setStaffOptions((json.data || []).map(mapStaffOption).filter((staff: StaffOption) => staff.id && staff.name)))
      .catch(() => setStaffOptions([]))
  }, [])

  useEffect(() => {
    fetch('/api/admin/staff?page=1&limit=200&role=NSM', { credentials: 'include' })
      .then((res) => res.json())
      .then((json) => setNsmOptions((json.data || []).map(mapStaffOption).filter((staff: StaffOption) => staff.id && staff.name)))
      .catch(() => setNsmOptions([]))
  }, [])

  // Each region's states: its RSM's, or the list kept for a region with no RSM yet.
  useEffect(() => {
    fetch('/api/admin/sales-regions', { credentials: 'include' })
      .then((res) => res.json())
      .then((json) => setRegionStates(json?.data && typeof json.data === 'object' ? json.data : {}))
      .catch(() => setRegionStates({}))
  }, [])

  // A Sales Manager's base location must be one of the cities they cover.
  useEffect(() => {
    if (role !== 'EXECUTIVE') return
    setLocation((current) => (current && !assignedCities.includes(current) ? '' : current))
  }, [assignedCities, role])

  // Region first: an ASM takes the region's RSM, or floats there when it has none
  // (its approvals go to the NSM); a Sales Manager then picks who they report to.
  // Territory the new region / parent does not cover is dropped.
  const handleRegionChange = (nextRegion: string) => {
    const rsm = regionRsm(staffOptions, nextRegion)
    setRegion(nextRegion)
    setParentRsmId(rsm?.id ?? '')
    if (role === 'ASM') {
      const validStates = new Set(rsm ? rsm.assignedStates : regionStates[nextRegion] ?? [])
      setAssignedStates((current) => current.filter((state) => validStates.has(state)))
    }
    handleReportsToChange('', nextRegion)
  }

  const handleReportsToChange = (reportsToId: string, inRegion = region) => {
    const next = pickReportsTo(staffOptions, reportsToId)
    const nextRsmId = reportsToId ? next.parentRsmId : regionRsm(staffOptions, inRegion)?.id ?? ''
    setParentAsmId(next.parentAsmId)
    if (role !== 'EXECUTIVE') return
    setParentRsmId(nextRsmId)
    // The city list is scoped to the new parent's states (or the region's), so drop anything it does not cover.
    const validCities = new Set(citiesForStates(cityScopeStates(staffOptions, next.parentAsmId, nextRsmId, regionStates[inRegion] ?? [])))
    setAssignedCities((current) => {
      const next = current.filter((city) => validCities.has(city))
      return next.length === current.length ? current : next
    })
    setLocation((current) => (validCities.has(current) ? current : ''))
  }

  const resetHierarchy = () => { setRegion(''); setParentRsmId(''); setParentAsmId(''); setRsmIds([]); setReportingManagerId(''); setAssignedStates([]); setAssignedCities([]); setLocation('') }
  const resetForm = () => {
    setName(''); setPersonalState(''); setLocation(''); setEmail('')
    setMobileNo(''); setAlternateNo(''); setPermanentAddress(''); setLocalAddress(''); setSameAddress(false)
    setGender(''); setDob(''); setNationality(''); setMaritalStatus(''); setQualification('')
    setEmergencyContactNo1(''); setEmergencyContactNo2('')
    setPassword(''); setRole(''); setSalesRegion(''); setWarehouse(''); resetHierarchy()
  }
  const toggleState = (state: string) => setAssignedStates((current) => current.includes(state) ? current.filter((entry) => entry !== state) : [...current, state].sort((a, b) => a.localeCompare(b)))
  const toggleRsm = (rsmId: string) => setRsmIds((current) => current.includes(rsmId) ? current.filter((entry) => entry !== rsmId) : [...current, rsmId])
  const toggleCity = (city: string) => setAssignedCities((current) => current.includes(city) ? current.filter((entry) => entry !== city) : [...current, city].sort((a, b) => a.localeCompare(b)))

  // location column is a single free-text field, so the picked state rides along
  // with the city (e.g. "Pune, Maharashtra") for roles without their own location select.
  const localAddressValue = sameAddress ? permanentAddress : localAddress

  const locationForSubmit = role === 'EXECUTIVE' || !location ? location : personalState ? `${location}, ${personalState}` : location

  const createStaffRequest = () => fetch('/api/admin/staff', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      name, designation, location: locationForSubmit, email,
      mobileNo, alternateNo, permanentAddress, localAddress: localAddressValue,
      gender, dob, nationality, maritalStatus, qualification,
      emergencyContactNo1, emergencyContactNo2,
      password,
      role: selectedRoleRef(),
      staffRoleType: selectedStaffRoleTypeRef(),
      // An ASM / Sales Manager names its region too, so it can float in a region with no RSM yet.
      salesRegion: selectedAuthRoleRef() === 'RSM' ? salesRegion : role === 'ASM' || role === 'EXECUTIVE' ? region : undefined,
      warehouse: role === 'FIELD_EXECUTIVE' ? warehouse : undefined,
      // A Sales Manager with no ASM reports straight to the RSM.
      parentRsmId: role === 'ASM' || (role === 'EXECUTIVE' && !parentAsmId) ? parentRsmId : undefined,
      rsmIds: role === 'FIELD_EXECUTIVE' ? rsmIds : undefined,
      parentAsmId: role === 'EXECUTIVE' ? parentAsmId : undefined,
      assignedStates: role === 'ASM' || role === 'RSM' ? assignedStates : undefined,
      assignedCities: role === 'EXECUTIVE' ? assignedCities : undefined,
      reportingManagerId: role === 'RSM' ? reportingManagerId : undefined,
    }),
  })

  const selectedRoleRef = () => getRoleOption(role)?.authRole
  const selectedStaffRoleTypeRef = () => getRoleOption(role)?.staffRoleType
  const selectedAuthRoleRef = () => getRoleOption(role)?.authRole

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const selectedRole = getRoleOption(role)
    if (!selectedRole) return
    setIsSaving(true)
    try {
      let response = await createStaffRequest()
      if (response.status === 401) {
        const refreshResponse = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })
        if (refreshResponse.ok) response = await createStaffRequest()
      }
      const payload = await response.json().catch(() => null)
      if (!response.ok || payload?.success === false) throw new Error(payload?.message || (response.status === 401 ? 'Session expired. Please sign in again.' : 'Failed to add user'))
      showToast('success', selectedRole.successMessage)
      resetForm()
      router.push('/dashboard/admin/staff/stafflist')
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : 'Failed to add user')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="p-6 admin-page-shell">
        <div className="mb-8">
          <button onClick={() => router.back()} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-4 transition">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Back
          </button>
          <h1 className="text-3xl font-bold text-gray-900">Add Staff</h1>
          <p className="text-sm text-gray-500 mt-1">Create an internal staff account</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="flex flex-col gap-6">
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-5 pb-3 border-b border-gray-100">Personal Information</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <InputField label="Full Name" value={name} onChange={setName} placeholder="Enter full name" />
                <InputField label="Designation" value={designation} onChange={() => {}} placeholder="Select a role below" required={false} readOnly hint="Synced with the selected role." />
                <InputField label="Email" value={email} onChange={setEmail} type="email" placeholder="user@company.com" />
                {role === 'EXECUTIVE' ? (
                  <SelectField
                    label="Location"
                    value={location}
                    onChange={setLocation}
                    options={assignedCities}
                    required={false}
                    placeholder={!region ? 'Select region first' : assignedCities.length ? 'Select base city' : 'Select cities below first'}
                  />
                ) : (
                  <>
                    <SelectField
                      label="State"
                      value={personalState}
                      onChange={(nextState) => { setPersonalState(nextState); setLocation('') }}
                      options={placeOptions}
                      required={false}
                    />
                    <SelectField
                      label="City"
                      value={location}
                      onChange={setLocation}
                      options={personalCityOptions}
                      required={false}
                      placeholder={personalState ? 'Select city' : 'Select state first'}
                    />
                  </>
                )}
                <InputField label="Mobile No." value={mobileNo} onChange={setMobileNo} type="tel" placeholder="10-digit mobile number" />
                <InputField label="Alternate Number" value={alternateNo} onChange={setAlternateNo} type="tel" placeholder="Alternate contact number" required={false} />
                <SelectField label="Gender" value={gender} onChange={setGender} options={GENDER_OPTIONS} />
                <InputField label="Date of Birth" value={dob} onChange={setDob} type="date" max={adultDobCutoff()} hint="Add DOB to get discount. Must be 18 or older; only an admin can change it later." />
                <InputField label="Nationality" value={nationality} onChange={setNationality} placeholder="e.g. Indian" required={false} />
                <SelectField label="Marital Status" value={maritalStatus} onChange={setMaritalStatus} options={MARITAL_STATUS_OPTIONS} required={false} />
                <SelectField label="Qualification" value={qualification} onChange={setQualification} options={QUALIFICATION_OPTIONS} required={false} />
                <InputField label="Emergency Contact No. 1" value={emergencyContactNo1} onChange={setEmergencyContactNo1} type="tel" placeholder="Emergency contact number" required={false} />
                <InputField label="Emergency Contact No. 2" value={emergencyContactNo2} onChange={setEmergencyContactNo2} type="tel" placeholder="Emergency contact number" required={false} />
                <TextAreaField label="Permanent Address" value={permanentAddress} onChange={setPermanentAddress} placeholder="Permanent address" />
                <div className="flex flex-col gap-1.5">
                  <TextAreaField label="Local Address" value={localAddressValue} onChange={setLocalAddress} placeholder="Current / local address" required={false} disabled={sameAddress} />
                  <label className="flex items-center gap-2 text-xs text-gray-600">
                    <input type="checkbox" checked={sameAddress} onChange={e => setSameAddress(e.target.checked)} className="rounded border-gray-300" />
                    Same as permanent address
                  </label>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-5 pb-3 border-b border-gray-100">Account Settings</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="flex flex-col gap-1.5">
                  <FieldLabel label="Password" />
                  <div className="relative">
                    <input
                      required
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="Set a password"
                      className="w-full px-3 py-2.5 pr-10 border border-gray-200 rounded-lg text-sm text-gray-900 bg-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((visible) => !visible)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-gray-400 transition hover:bg-gray-50 hover:text-gray-700"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <FieldLabel label="Role" />
                  <select
                    required
                    value={role}
                    onChange={e => { const nextRole = e.target.value as StaffFormRole; setRole(nextRole); setSalesRegion(nextRole === 'RSM' ? salesRegion : ''); resetHierarchy() }}
                    className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition"
                  >
                    <option value="" disabled>Select a role</option>
                    {roleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </div>

                {role === 'RSM' && (
                  <div className="flex flex-col gap-1.5">
                    <FieldLabel label="Region" />
                    <select
                      required
                      value={salesRegion}
                      onChange={e => setSalesRegion(e.target.value)}
                      className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition"
                    >
                      <option value="" disabled>Select region</option>
                      {SALES_REGION_OPTIONS.map((option) => {
                        const taken = rsmByRegion.get(option.value)
                        return <option key={option.value} value={option.value} disabled={!!taken}>{taken ? `${option.label} — ${taken.name}` : option.label}</option>
                      })}
                    </select>
                  </div>
                )}

                {role === 'RSM' && (
                  <div className="flex flex-col gap-1.5">
                    <FieldLabel label="Reporting Manager (NSM)" />
                    <select
                      required
                      value={reportingManagerId}
                      onChange={e => setReportingManagerId(e.target.value)}
                      className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition"
                    >
                      <option value="" disabled>{nsmOptions.length ? 'Select NSM' : 'No NSM accounts found'}</option>
                      {nsmOptions.map((option) => <option key={option.id} value={option.id}>{displayStaff(option)}</option>)}
                    </select>
                  </div>
                )}

                {role === 'FIELD_EXECUTIVE' && (
                  <div className="flex flex-col gap-1.5">
                    <FieldLabel label="Warehouse" />
                    <select
                      required
                      value={warehouse}
                      onChange={e => setWarehouse(e.target.value)}
                      className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition"
                    >
                      <option value="" disabled>Select warehouse</option>
                      {WAREHOUSE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                    <span className="text-[11px] text-gray-500">Staff only see orders handled by their own warehouse.</span>
                  </div>
                )}

                {(role === 'ASM' || role === 'EXECUTIVE') && (
                  <RegionSelect value={region} onChange={handleRegionChange} />
                )}

                {role === 'ASM' && (
                  <InputField
                    label="RSM (Reporting Manager)"
                    value={region && !selectedRsm ? 'No RSM yet — approvals go to the NSM' : reportingManagerLabel}
                    onChange={() => {}}
                    placeholder="Auto-filled from region"
                    required={false}
                  />
                )}

                {role === 'FIELD_EXECUTIVE' && (
                  <div className="md:col-span-2 flex flex-col gap-1.5">
                    <FieldLabel label="RSMs" required={false} />
                    <div className="max-h-52 overflow-y-auto rounded-lg border border-gray-200 bg-white p-2">
                      {rsmOptions.length ? rsmOptions.map((option) => (
                        <label key={option.id} className="flex cursor-pointer items-center gap-3 rounded px-2 py-1.5 text-sm hover:bg-gray-50">
                          <input type="checkbox" checked={rsmIds.includes(option.id)} onChange={() => toggleRsm(option.id)} className="h-4 w-4 accent-brand-600" />
                          <span className="text-black">{displayStaff(option)}</span>
                        </label>
                      )) : <p className="px-2 py-2 text-sm text-black">No RSM accounts found.</p>}
                    </div>
                    <span className="text-[11px] text-gray-500">Optional. Staff can work under any number of RSMs, from any region.</span>
                  </div>
                )}

                {role === 'EXECUTIVE' && (
                  <>
                    <ReportsToSelect region={region} groups={reportsTo} value={parentAsmId || parentRsmId} onChange={handleReportsToChange} />
                    <InputField label="ASM" value={selectedAsm?.name || ''} onChange={() => {}} placeholder={parentRsmId ? 'None — reports to the RSM' : 'Auto-filled'} required={false} />
                    <InputField label="RSM" value={selectedRsm?.name || ''} onChange={() => {}} placeholder="Auto-filled" required={false} />
                  </>
                )}

                {(role === 'ASM' || role === 'RSM') && (
                  <div className="md:col-span-2 flex flex-col gap-1.5">
                    <FieldLabel label="States" />
                    <div className="max-h-52 overflow-y-auto rounded-lg border border-gray-200 bg-white p-2">
                      {rsmAssignedStates.length ? rsmAssignedStates.map((state) => (
                        <label key={state} className="flex cursor-pointer items-center gap-3 rounded px-2 py-1.5 text-sm hover:bg-gray-50">
                          <input type="checkbox" checked={assignedStates.includes(state)} onChange={() => toggleState(state)} className="h-4 w-4 accent-brand-600" />
                          <span className="text-black">{state}</span>
                        </label>
                      )) : <p className="px-2 py-2 text-sm text-black">{region ? 'This region has no states yet — set them in Manage Regions.' : 'Select a region to choose states.'}</p>}
                    </div>
                  </div>
                )}

                {role === 'EXECUTIVE' && (
                  <div className="md:col-span-2 flex flex-col gap-1.5">
                    <FieldLabel label="Cities" />
                    <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-200 bg-white p-2">
                      {smCitiesByState.length ? smCitiesByState.map(({ state, cities }) => (
                        <div key={state} className="mb-2 last:mb-0">
                          <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{state}</p>
                          {cities.map((city) => (
                            <label key={city} className="flex cursor-pointer items-center gap-3 rounded px-2 py-1.5 text-sm hover:bg-gray-50">
                              <input type="checkbox" checked={assignedCities.includes(city)} onChange={() => toggleCity(city)} className="h-4 w-4 accent-brand-600" />
                              <span className="text-black">{city}</span>
                            </label>
                          ))}
                        </div>
                      )) : (
                        <p className="px-2 py-2 text-sm text-gray-900">
                          {!region ? 'Select a region to choose cities.' : parentAsmId || parentRsmId ? 'Who they report to has no states assigned.' : 'This region has no states yet — set them in Manage Regions.'}
                        </p>
                      )}
                    </div>
                    <span className="text-[11px] text-gray-500">Limited to the states of whoever they report to.</span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pb-6">
              <button type="button" onClick={() => router.back()} className="px-5 py-2.5 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 transition">Cancel</button>
              <button type="submit" disabled={isSaving} className="flex items-center gap-2 px-6 py-2.5 text-sm bg-brand-600 text-white rounded-lg hover:bg-brand-500 disabled:opacity-60 disabled:cursor-not-allowed transition font-medium">
                {isSaving && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                {isSaving ? 'Saving...' : 'Add Staff'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}