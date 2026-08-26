// 'use client'

// import { useEffect, useMemo, useState } from 'react'
// import { useRouter } from 'next/navigation'
// import { Eye, EyeOff } from 'lucide-react'
// import { STATE_OPTIONS, CITIES_BY_STATE, citiesForStates, statesForCities } from '@/lib/places'
// import { SALES_REGION_OPTIONS } from '@/lib/salesRegions'
// import { mergeRegionAssignment } from '@/lib/regionAssignments'

// const roleOptions = [
//   { value: 'EXECUTIVE', label: 'Sales Manager', authRole: 'STAFF', staffRoleType: '1', successMessage: 'Sales Manager created' },
//   { value: 'FIELD_EXECUTIVE', label: 'Staff', authRole: 'STAFF', staffRoleType: '2', successMessage: 'Staff created' },
//   { value: 'RSM', label: 'RSM', authRole: 'RSM', staffRoleType: 'RSM', successMessage: 'RSM created' },
//   { value: 'ASM', label: 'ASM', authRole: 'ASM', staffRoleType: 'ASM', successMessage: 'ASM created' },
//   { value: 'NSM', label: 'NSM', authRole: 'NSM', staffRoleType: undefined, successMessage: 'NSM created' },
// ] as const

// const GENDER_OPTIONS = ['Male', 'Female', 'Other'] as const
// const MARITAL_STATUS_OPTIONS = ['Single', 'Married', 'Divorced', 'Widowed'] as const
// const QUALIFICATION_OPTIONS = ['12th Pass', 'Bachelors', 'Masters', 'PhD'] as const

// type StaffFormRole = '' | typeof roleOptions[number]['value']
// type StaffOption = { id: string; name: string; email?: string; role: string; staffRoleType: string; parentRsmId?: string; assignedStates: string[]; parentRsm?: { id: string; name: string } | null }
// type PlacesData = { states?: string[]; union_territories?: string[] }

// function getRoleOption(value: StaffFormRole) { return roleOptions.find((option) => option.value === value) }
// function displayStaff(option?: StaffOption) { return option ? `${option.name}${option.email ? ` (${option.email})` : ''}` : '' }
// function staffName(value: unknown) { const row = value as Record<string, unknown>; return String(row.name || row.staff_name || '').trim() }
// function staffId(value: unknown) { const row = value as Record<string, unknown>; return String(row.id || row.staff_id || '').trim() }
// function mapStaffOption(value: unknown): StaffOption {
//   const row = value as Record<string, unknown>
//   return {
//     id: staffId(row),
//     name: staffName(row),
//     email: String(row.email || row.staff_email || ''),
//     role: String(row.role || '').toUpperCase(),
//     staffRoleType: String(row.staffRoleType || row.staff_roletype || '').toUpperCase(),
//     parentRsmId: String(row.parentRsmId || row.parent_rsm_id || ''),
//     assignedStates: Array.isArray(row.assignedStates) ? row.assignedStates.map(String) : Array.isArray(row.assigned_states) ? row.assigned_states.map(String) : [],
//     parentRsm: row.parentRsm as StaffOption['parentRsm'],
//   }
// }

// function InputField({ label, value, onChange, type = 'text', placeholder, required = true }: { label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; required?: boolean }) {
//   return (
//     <div className="flex flex-col gap-1.5">
//       <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">{label}</label>
//       <input
//         required={required}
//         type={type}
//         value={value}
//         onChange={e => onChange(e.target.value)}
//         placeholder={placeholder || label}
//         className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-900 bg-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
//       />
//     </div>
//   )
// }

// function TextAreaField({ label, value, onChange, placeholder, required = true }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; required?: boolean }) {
//   return (
//     <div className="flex flex-col gap-1.5">
//       <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">{label}</label>
//       <textarea
//         required={required}
//         value={value}
//         onChange={e => onChange(e.target.value)}
//         placeholder={placeholder || label}
//         rows={2}
//         className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-900 bg-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition resize-none"
//       />
//     </div>
//   )
// }

// function SelectField({ label, value, onChange, options, required = true, placeholder }: { label: string; value: string; onChange: (v: string) => void; options: readonly string[]; required?: boolean; placeholder?: string }) {
//   return (
//     <div className="flex flex-col gap-1.5">
//       <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">{label}</label>
//       <select
//         required={required}
//         value={value}
//         onChange={e => onChange(e.target.value)}
//         className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
//       >
//         <option value="" disabled>{placeholder || `Select ${label.toLowerCase()}`}</option>
//         {options.map((option) => <option key={option} value={option}>{option}</option>)}
//       </select>
//     </div>
//   )
// }

// export default function AddStaffPage() {
//   const router = useRouter()
//   const [isSaving, setIsSaving] = useState(false)
//   const [toastMsg, setToastMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

//   // Personal info
//   const [name, setName] = useState('')
//   const [designation, setDesignation] = useState('')
//   const [location, setLocation] = useState('')
//   const [email, setEmail] = useState('')
//   const [mobileNo, setMobileNo] = useState('')
//   const [alternateNo, setAlternateNo] = useState('')
//   const [permanentAddress, setPermanentAddress] = useState('')
//   const [localAddress, setLocalAddress] = useState('')
//   const [gender, setGender] = useState('')
//   const [dob, setDob] = useState('')
//   const [nationality, setNationality] = useState('')
//   const [maritalStatus, setMaritalStatus] = useState('')
//   const [qualification, setQualification] = useState('')
//   const [emergencyContactNo1, setEmergencyContactNo1] = useState('')
//   const [emergencyContactNo2, setEmergencyContactNo2] = useState('')

//   // Account settings
//   const [password, setPassword] = useState('')
//   const [showPassword, setShowPassword] = useState(false)
//   const [role, setRole] = useState<StaffFormRole>('')
//   const [salesRegion, setSalesRegion] = useState('')
//   const [parentRsmId, setParentRsmId] = useState('')
//   const [parentAsmId, setParentAsmId] = useState('')
//   const [assignedStates, setAssignedStates] = useState<string[]>([])
//   const [staffOptions, setStaffOptions] = useState<StaffOption[]>([])

//   const placeOptions = useMemo(() => {
//     const data = places as PlacesData
//     return [...(data.states ?? []), ...(data.union_territories ?? [])].sort((a, b) => a.localeCompare(b))
//   }, [])
//   const rsmOptions = useMemo(() => staffOptions.filter((staff) => staff.role === 'RSM'), [staffOptions])
//   const asmOptions = useMemo(() => staffOptions.filter((staff) => staff.role === 'ASM' || staff.staffRoleType === 'ASM'), [staffOptions])
//   const selectedRsm = rsmOptions.find((staff) => staff.id === parentRsmId)
//   const selectedAsm = asmOptions.find((staff) => staff.id === parentAsmId)
//   const selectedAsmRsm = rsmOptions.find((staff) => staff.id === selectedAsm?.parentRsmId) || selectedAsm?.parentRsm || null
//   const asmStateOptions = useMemo(() => selectedRsm?.assignedStates?.length ? selectedRsm.assignedStates : [], [selectedRsm])
//   const rsmAssignedStates = role === 'RSM' ? placeOptions : asmStateOptions

//   useEffect(() => {
//     fetch('/api/admin/staff?page=1&limit=200', { credentials: 'include' })
//       .then((res) => res.json())
//       .then((json) => setStaffOptions((json.data || []).map(mapStaffOption).filter((staff: StaffOption) => staff.id && staff.name)))
//       .catch(() => setStaffOptions([]))
//   }, [])

//   const handleParentRsmChange = (nextParentRsmId: string) => {
//     setParentRsmId(nextParentRsmId)
//     if (role !== 'ASM') return
//     const validStates = new Set(rsmOptions.find((staff) => staff.id === nextParentRsmId)?.assignedStates || [])
//     setAssignedStates((current) => {
//       const next = current.filter((state) => validStates.has(state))
//       return next.length === current.length ? current : next
//     })
//   }

//   const showToast = (text: string, type: 'success' | 'error') => { setToastMsg({ text, type }); setTimeout(() => setToastMsg(null), 3500) }
//   const resetHierarchy = () => { setParentRsmId(''); setParentAsmId(''); setAssignedStates([]) }
//   const resetForm = () => {
//     setName(''); setDesignation(''); setLocation(''); setEmail('')
//     setMobileNo(''); setAlternateNo(''); setPermanentAddress(''); setLocalAddress('')
//     setGender(''); setDob(''); setNationality(''); setMaritalStatus(''); setQualification('')
//     setEmergencyContactNo1(''); setEmergencyContactNo2('')
//     setPassword(''); setRole(''); setSalesRegion(''); resetHierarchy()
//   }
//   const toggleState = (state: string) => setAssignedStates((current) => current.includes(state) ? current.filter((entry) => entry !== state) : [...current, state].sort((a, b) => a.localeCompare(b)))

//   const createStaffRequest = () => fetch('/api/admin/staff', {
//     method: 'POST',
//     headers: { 'Content-Type': 'application/json' },
//     credentials: 'include',
//     body: JSON.stringify({
//       name, designation, location, email,
//       mobileNo, alternateNo, permanentAddress, localAddress,
//       gender, dob, nationality, maritalStatus, qualification,
//       emergencyContactNo1, emergencyContactNo2,
//       password,
//       role: selectedRoleRef(),
//       staffRoleType: selectedStaffRoleTypeRef(),
//       salesRegion: selectedAuthRoleRef() === 'RSM' ? salesRegion : undefined,
//       parentRsmId: role === 'ASM' || role === 'FIELD_EXECUTIVE' ? parentRsmId : undefined,
//       parentAsmId: role === 'EXECUTIVE' ? parentAsmId : undefined,
//       assignedStates: role === 'ASM' || role === 'RSM' ? assignedStates : undefined,
//     }),
//   })

//   const selectedRoleRef = () => getRoleOption(role)?.authRole
//   const selectedStaffRoleTypeRef = () => getRoleOption(role)?.staffRoleType
//   const selectedAuthRoleRef = () => getRoleOption(role)?.authRole

//   const handleSubmit = async (e: React.FormEvent) => {
//     e.preventDefault()
//     const selectedRole = getRoleOption(role)
//     if (!selectedRole) return
//     setIsSaving(true)
//     try {
//       let response = await createStaffRequest()
//       if (response.status === 401) {
//         const refreshResponse = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })
//         if (refreshResponse.ok) response = await createStaffRequest()
//       }
//       const payload = await response.json().catch(() => null)
//       if (!response.ok || payload?.success === false) throw new Error(payload?.message || (response.status === 401 ? 'Session expired. Please sign in again.' : 'Failed to add user'))
//       if (selectedRole.authRole === 'RSM') mergeRegionAssignment(salesRegion, assignedStates)
//       showToast(selectedRole.successMessage, 'success')
//       resetForm()
//       router.push('/dashboard/admin/staff/stafflist')
//     } catch (error) {
//       showToast(error instanceof Error ? error.message : 'Failed to add user', 'error')
//     } finally {
//       setIsSaving(false)
//     }
//   }

//   return (
//     <div className="min-h-screen bg-gray-100">
//       {toastMsg && (
//         <div className={`fixed top-5 right-5 z-50 text-sm px-4 py-3 rounded-lg shadow-lg transition-all ${toastMsg.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-500 text-white'}`}>
//           {toastMsg.text}
//         </div>
//       )}
//       <div className="p-6 admin-page-shell">
//         <div className="mb-8">
//           <button onClick={() => router.back()} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-4 transition">
//             <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
//               <path d="M19 12H5M12 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
//             </svg>
//             Back
//           </button>
//           <h1 className="text-3xl font-bold text-gray-900">Add Staff</h1>
//           <p className="text-sm text-gray-500 mt-1">Create an internal staff account</p>
//         </div>

//         <form onSubmit={handleSubmit}>
//           <div className="flex flex-col gap-6">
//             <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
//               <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-5 pb-3 border-b border-gray-100">Personal Information</h2>
//               <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
//                 <InputField label="Full Name" value={name} onChange={setName} placeholder="Enter full name" />
//                 <InputField label="Designation" value={designation} onChange={setDesignation} placeholder="e.g. Sales Manager" required={false} />
//                 <InputField label="Email" value={email} onChange={setEmail} type="email" placeholder="user@company.com" />
//                 <InputField label="Location" value={location} onChange={setLocation} placeholder="City / Branch" required={false} />
//                 <InputField label="Mobile No." value={mobileNo} onChange={setMobileNo} type="tel" placeholder="10-digit mobile number" />
//                 <InputField label="Alternate Number" value={alternateNo} onChange={setAlternateNo} type="tel" placeholder="Alternate contact number" required={false} />
//                 <SelectField label="Gender" value={gender} onChange={setGender} options={GENDER_OPTIONS} />
//                 <InputField label="Date of Birth" value={dob} onChange={setDob} type="date" />
//                 <InputField label="Nationality" value={nationality} onChange={setNationality} placeholder="e.g. Indian" required={false} />
//                 <SelectField label="Marital Status" value={maritalStatus} onChange={setMaritalStatus} options={MARITAL_STATUS_OPTIONS} required={false} />
//                 <SelectField label="Qualification" value={qualification} onChange={setQualification} options={QUALIFICATION_OPTIONS} required={false} />
//                 <InputField label="Emergency Contact No. 1" value={emergencyContactNo1} onChange={setEmergencyContactNo1} type="tel" placeholder="Emergency contact number" required={false} />
//                 <InputField label="Emergency Contact No. 2" value={emergencyContactNo2} onChange={setEmergencyContactNo2} type="tel" placeholder="Emergency contact number" required={false} />
//                 <TextAreaField label="Permanent Address" value={permanentAddress} onChange={setPermanentAddress} placeholder="Permanent address" />
//                 <TextAreaField label="Local Address" value={localAddress} onChange={setLocalAddress} placeholder="Current / local address" required={false} />
//               </div>
//             </div>

//             <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
//               <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-5 pb-3 border-b border-gray-100">Account Settings</h2>
//               <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
//                 <div className="flex flex-col gap-1.5">
//                   <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">Password</label>
//                   <div className="relative">
//                     <input
//                       required
//                       type={showPassword ? 'text' : 'password'}
//                       value={password}
//                       onChange={e => setPassword(e.target.value)}
//                       placeholder="Set a password"
//                       className="w-full px-3 py-2.5 pr-10 border border-gray-200 rounded-lg text-sm text-gray-900 bg-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
//                     />
//                     <button
//                       type="button"
//                       onClick={() => setShowPassword((visible) => !visible)}
//                       className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-gray-400 transition hover:bg-gray-50 hover:text-gray-700"
//                       aria-label={showPassword ? 'Hide password' : 'Show password'}
//                     >
//                       {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
//                     </button>
//                   </div>
//                 </div>

//                 <div className="flex flex-col gap-1.5">
//                   <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">Role</label>
//                   <select
//                     required
//                     value={role}
//                     onChange={e => { const nextRole = e.target.value as StaffFormRole; setRole(nextRole); setSalesRegion(nextRole === 'RSM' ? salesRegion : ''); resetHierarchy() }}
//                     className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
//                   >
//                     <option value="" disabled>Select a role</option>
//                     {roleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
//                   </select>
//                 </div>

//                 {role === 'RSM' && (
//                   <div className="flex flex-col gap-1.5">
//                     <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">Region</label>
//                     <select
//                       required
//                       value={salesRegion}
//                       onChange={e => setSalesRegion(e.target.value)}
//                       className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
//                     >
//                       <option value="" disabled>Select region</option>
//                       {SALES_REGION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
//                     </select>
//                   </div>
//                 )}

//                 {(role === 'ASM' || role === 'FIELD_EXECUTIVE') && (
//                   <div className="flex flex-col gap-1.5">
//                     <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">RSM</label>
//                     <select
//                       required
//                       value={parentRsmId}
//                       onChange={e => handleParentRsmChange(e.target.value)}
//                       className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
//                     >
//                       <option value="" disabled>Select RSM</option>
//                       {rsmOptions.map((option) => <option key={option.id} value={option.id}>{displayStaff(option)}</option>)}
//                     </select>
//                   </div>
//                 )}

//                 {role === 'EXECUTIVE' && (
//                   <>
//                     <div className="flex flex-col gap-1.5">
//                       <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">ASM</label>
//                       <select
//                         required
//                         value={parentAsmId}
//                         onChange={e => setParentAsmId(e.target.value)}
//                         className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
//                       >
//                         <option value="" disabled>Select ASM</option>
//                         {asmOptions.map((option) => <option key={option.id} value={option.id}>{displayStaff(option)}</option>)}
//                       </select>
//                     </div>
//                     <InputField label="RSM" value={selectedAsmRsm?.name || ''} onChange={() => {}} placeholder="Auto-filled from ASM" required={false} />
//                   </>
//                 )}

//                 {(role === 'ASM' || role === 'RSM') && (
//                   <div className="md:col-span-2 flex flex-col gap-1.5">
//                     <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">States</label>
//                     <div className="max-h-52 overflow-y-auto rounded-lg border border-gray-200 bg-white p-2">
//                       {rsmAssignedStates.length ? rsmAssignedStates.map((state) => (
//                         <label key={state} className="flex cursor-pointer items-center gap-3 rounded px-2 py-1.5 text-sm hover:bg-gray-50">
//                           <input type="checkbox" checked={assignedStates.includes(state)} onChange={() => toggleState(state)} className="h-4 w-4 accent-indigo-600" />
//                           <span>{state}</span>
//                         </label>
//                       )) : <p className="px-2 py-2 text-sm text-gray-500">Select an RSM with assigned states.</p>}
//                     </div>
//                   </div>
//                 )}
//               </div>
//             </div>

//             <div className="flex items-center justify-end gap-3 pb-6">
//               <button type="button" onClick={() => router.back()} className="px-5 py-2.5 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 transition">Cancel</button>
//               <button type="submit" disabled={isSaving} className="flex items-center gap-2 px-6 py-2.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed transition font-medium">
//                 {isSaving && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
//                 {isSaving ? 'Saving...' : 'Add Staff'}
//               </button>
//             </div>
//           </div>
//         </form>
//       </div>
//     </div>
//   )
// }

'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff } from 'lucide-react'
import { STATE_OPTIONS, CITIES_BY_STATE, citiesForStates, statesForCities } from '@/lib/places'
import { SALES_REGION_OPTIONS } from '@/lib/salesRegions'
import { mergeRegionAssignment } from '@/lib/regionAssignments'

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
type StaffOption = { id: string; name: string; email?: string; role: string; staffRoleType: string; parentRsmId?: string; assignedStates: string[]; assignedCities: string[]; parentRsm?: { id: string; name: string } | null }

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
    parentRsmId: String(row.parentRsmId || row.parent_rsm_id || ''),
    assignedStates: Array.isArray(row.assignedStates) ? row.assignedStates.map(String) : Array.isArray(row.assigned_states) ? row.assigned_states.map(String) : [],
    assignedCities: Array.isArray(row.assignedCities) ? row.assignedCities.map(String) : Array.isArray(row.assigned_cities) ? row.assigned_cities.map(String) : [],
    parentRsm: row.parentRsm as StaffOption['parentRsm'],
  }
}

function InputField({ label, value, onChange, type = 'text', placeholder, required = true, readOnly = false, hint }: { label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; required?: boolean; readOnly?: boolean; hint?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">{label}</label>
      <input
        required={required}
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder || label}
        readOnly={readOnly}
        className={`px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition ${readOnly ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : 'bg-white'}`}
      />
      {hint ? <span className="text-[11px] text-gray-500">{hint}</span> : null}
    </div>
  )
}

function TextAreaField({ label, value, onChange, placeholder, required = true }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; required?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">{label}</label>
      <textarea
        required={required}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder || label}
        rows={2}
        className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-900 bg-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition resize-none"
      />
    </div>
  )
}

function SelectField({ label, value, onChange, options, required = true, placeholder }: { label: string; value: string; onChange: (v: string) => void; options: readonly string[]; required?: boolean; placeholder?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">{label}</label>
      <select
        required={required}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
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
  const [toastMsg, setToastMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  // Personal info
  const [name, setName] = useState('')
  const [location, setLocation] = useState('')
  const [email, setEmail] = useState('')
  const [mobileNo, setMobileNo] = useState('')
  const [alternateNo, setAlternateNo] = useState('')
  const [permanentAddress, setPermanentAddress] = useState('')
  const [localAddress, setLocalAddress] = useState('')
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
  const [parentRsmId, setParentRsmId] = useState('')
  const [parentAsmId, setParentAsmId] = useState('')
  const [reportingManagerId, setReportingManagerId] = useState('')
  const [assignedStates, setAssignedStates] = useState<string[]>([])
  const [assignedCities, setAssignedCities] = useState<string[]>([])
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>([])
  const [nsmOptions, setNsmOptions] = useState<StaffOption[]>([])

  const placeOptions = STATE_OPTIONS
  const citiesByState = CITIES_BY_STATE

  // Designation mirrors the selected role — the two are always kept in sync.
  const designation = getRoleOption(role)?.label ?? ''

  const rsmOptions = useMemo(() => staffOptions.filter((staff) => staff.role === 'RSM'), [staffOptions])
  const asmOptions = useMemo(() => staffOptions.filter((staff) => staff.role === 'ASM' || staff.staffRoleType === 'ASM'), [staffOptions])
  const selectedRsm = rsmOptions.find((staff) => staff.id === parentRsmId)
  const selectedAsm = asmOptions.find((staff) => staff.id === parentAsmId)
  const selectedAsmRsm = rsmOptions.find((staff) => staff.id === selectedAsm?.parentRsmId) || selectedAsm?.parentRsm || null
  const asmStateOptions = useMemo(() => selectedRsm?.assignedStates?.length ? selectedRsm.assignedStates : [], [selectedRsm])
  const rsmAssignedStates = role === 'RSM' ? placeOptions : asmStateOptions
  // Cities available to a Sales Manager being created: the cities already assigned
  // to the selected ASM, grouped under the state each one belongs to.
  const selectedAsmCities = useMemo(
    () => (selectedAsm?.assignedCities?.length ? [...selectedAsm.assignedCities].sort((a, b) => a.localeCompare(b)) : []),
    [selectedAsm]
  )
  const smCitiesByState = useMemo(() => {
    const scope = selectedAsm?.assignedStates?.length ? selectedAsm.assignedStates : statesForCities(selectedAsmCities)
    return scope
      .map((state) => ({ state, cities: (citiesByState[state] ?? []).filter((city) => selectedAsmCities.includes(city)) }))
      .filter((group) => group.cities.length)
  }, [selectedAsm, selectedAsmCities, citiesByState])
  // Reporting manager: ASM reports to its RSM, Executive ("Sales Manager") reports to its ASM.
  // RSM has no parent staff record — its reporting manager is an NSM, picked explicitly below.
  const reportingManagerLabel = role === 'ASM' || role === 'FIELD_EXECUTIVE'
    ? selectedRsm?.name || ''
    : role === 'EXECUTIVE'
      ? selectedAsm?.name || ''
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

  // Keep the ASM's selected cities in sync with its selected states — drop any city whose state got unchecked.
  useEffect(() => {
    if (role !== 'ASM') return
    const validCities = new Set(citiesForStates(assignedStates))
    setAssignedCities((current) => {
      const next = current.filter((city) => validCities.has(city))
      return next.length === current.length ? current : next
    })
  }, [assignedStates, role])

  // A Sales Manager's base location must be one of the cities they cover.
  useEffect(() => {
    if (role !== 'EXECUTIVE') return
    setLocation((current) => (current && !assignedCities.includes(current) ? '' : current))
  }, [assignedCities, role])

  const handleParentRsmChange = (nextParentRsmId: string) => {
    setParentRsmId(nextParentRsmId)
    if (role !== 'ASM') return
    const validStates = new Set(rsmOptions.find((staff) => staff.id === nextParentRsmId)?.assignedStates || [])
    setAssignedStates((current) => {
      const next = current.filter((state) => validStates.has(state))
      return next.length === current.length ? current : next
    })
  }

  const handleParentAsmChange = (nextParentAsmId: string) => {
    setParentAsmId(nextParentAsmId)
    if (role !== 'EXECUTIVE') return
    // The city list is scoped to the newly selected ASM, so drop anything it does not cover.
    const validCities = new Set(asmOptions.find((staff) => staff.id === nextParentAsmId)?.assignedCities || [])
    setAssignedCities((current) => {
      const next = current.filter((city) => validCities.has(city))
      return next.length === current.length ? current : next
    })
    setLocation((current) => (validCities.has(current) ? current : ''))
  }

  const showToast = (text: string, type: 'success' | 'error') => { setToastMsg({ text, type }); setTimeout(() => setToastMsg(null), 3500) }
  const resetHierarchy = () => { setParentRsmId(''); setParentAsmId(''); setReportingManagerId(''); setAssignedStates([]); setAssignedCities([]); setLocation('') }
  const resetForm = () => {
    setName(''); setLocation(''); setEmail('')
    setMobileNo(''); setAlternateNo(''); setPermanentAddress(''); setLocalAddress('')
    setGender(''); setDob(''); setNationality(''); setMaritalStatus(''); setQualification('')
    setEmergencyContactNo1(''); setEmergencyContactNo2('')
    setPassword(''); setRole(''); setSalesRegion(''); resetHierarchy()
  }
  const toggleState = (state: string) => setAssignedStates((current) => current.includes(state) ? current.filter((entry) => entry !== state) : [...current, state].sort((a, b) => a.localeCompare(b)))
  const toggleCity = (city: string) => setAssignedCities((current) => current.includes(city) ? current.filter((entry) => entry !== city) : [...current, city].sort((a, b) => a.localeCompare(b)))

  const createStaffRequest = () => fetch('/api/admin/staff', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      name, designation, location, email,
      mobileNo, alternateNo, permanentAddress, localAddress,
      gender, dob, nationality, maritalStatus, qualification,
      emergencyContactNo1, emergencyContactNo2,
      password,
      role: selectedRoleRef(),
      staffRoleType: selectedStaffRoleTypeRef(),
      salesRegion: selectedAuthRoleRef() === 'RSM' ? salesRegion : undefined,
      parentRsmId: role === 'ASM' || role === 'FIELD_EXECUTIVE' ? parentRsmId : undefined,
      parentAsmId: role === 'EXECUTIVE' ? parentAsmId : undefined,
      assignedStates: role === 'ASM' || role === 'RSM' ? assignedStates : undefined,
      assignedCities: role === 'ASM' || role === 'EXECUTIVE' ? assignedCities : undefined,
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
      if (selectedRole.authRole === 'RSM') mergeRegionAssignment(salesRegion, assignedStates)
      showToast(selectedRole.successMessage, 'success')
      resetForm()
      router.push('/dashboard/admin/staff/stafflist')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to add user', 'error')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-100">
      {toastMsg && (
        <div className={`fixed top-5 right-5 z-50 text-sm px-4 py-3 rounded-lg shadow-lg transition-all ${toastMsg.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-500 text-white'}`}>
          {toastMsg.text}
        </div>
      )}
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
                    placeholder={!parentAsmId ? 'Select ASM first' : assignedCities.length ? 'Select base city' : 'Select cities below first'}
                  />
                ) : (
                  <InputField label="Location" value={location} onChange={setLocation} placeholder="City / Branch" required={false} />
                )}
                <InputField label="Mobile No." value={mobileNo} onChange={setMobileNo} type="tel" placeholder="10-digit mobile number" />
                <InputField label="Alternate Number" value={alternateNo} onChange={setAlternateNo} type="tel" placeholder="Alternate contact number" required={false} />
                <SelectField label="Gender" value={gender} onChange={setGender} options={GENDER_OPTIONS} />
                <InputField label="Date of Birth" value={dob} onChange={setDob} type="date" />
                <InputField label="Nationality" value={nationality} onChange={setNationality} placeholder="e.g. Indian" required={false} />
                <SelectField label="Marital Status" value={maritalStatus} onChange={setMaritalStatus} options={MARITAL_STATUS_OPTIONS} required={false} />
                <SelectField label="Qualification" value={qualification} onChange={setQualification} options={QUALIFICATION_OPTIONS} required={false} />
                <InputField label="Emergency Contact No. 1" value={emergencyContactNo1} onChange={setEmergencyContactNo1} type="tel" placeholder="Emergency contact number" required={false} />
                <InputField label="Emergency Contact No. 2" value={emergencyContactNo2} onChange={setEmergencyContactNo2} type="tel" placeholder="Emergency contact number" required={false} />
                <TextAreaField label="Permanent Address" value={permanentAddress} onChange={setPermanentAddress} placeholder="Permanent address" />
                <TextAreaField label="Local Address" value={localAddress} onChange={setLocalAddress} placeholder="Current / local address" required={false} />
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-5 pb-3 border-b border-gray-100">Account Settings</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">Password</label>
                  <div className="relative">
                    <input
                      required
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="Set a password"
                      className="w-full px-3 py-2.5 pr-10 border border-gray-200 rounded-lg text-sm text-gray-900 bg-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
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
                  <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">Role</label>
                  <select
                    required
                    value={role}
                    onChange={e => { const nextRole = e.target.value as StaffFormRole; setRole(nextRole); setSalesRegion(nextRole === 'RSM' ? salesRegion : ''); resetHierarchy() }}
                    className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
                  >
                    <option value="" disabled>Select a role</option>
                    {roleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </div>

                {role === 'RSM' && (
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">Region</label>
                    <select
                      required
                      value={salesRegion}
                      onChange={e => setSalesRegion(e.target.value)}
                      className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
                    >
                      <option value="" disabled>Select region</option>
                      {SALES_REGION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </div>
                )}

                {role === 'RSM' && (
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">Reporting Manager (NSM)</label>
                    <select
                      required
                      value={reportingManagerId}
                      onChange={e => setReportingManagerId(e.target.value)}
                      className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
                    >
                      <option value="" disabled>{nsmOptions.length ? 'Select NSM' : 'No NSM accounts found'}</option>
                      {nsmOptions.map((option) => <option key={option.id} value={option.id}>{displayStaff(option)}</option>)}
                    </select>
                  </div>
                )}

                {(role === 'ASM' || role === 'FIELD_EXECUTIVE') && (
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">RSM</label>
                    <select
                      required
                      value={parentRsmId}
                      onChange={e => handleParentRsmChange(e.target.value)}
                      className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
                    >
                      <option value="" disabled>Select RSM</option>
                      {rsmOptions.map((option) => <option key={option.id} value={option.id}>{displayStaff(option)}</option>)}
                    </select>
                  </div>
                )}

                {(role === 'ASM' || role === 'FIELD_EXECUTIVE') && (
                  <InputField label="Reporting Manager" value={reportingManagerLabel} onChange={() => {}} placeholder="Auto-filled from RSM" required={false} />
                )}

                {role === 'EXECUTIVE' && (
                  <>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">ASM</label>
                      <select
                        required
                        value={parentAsmId}
                        onChange={e => handleParentAsmChange(e.target.value)}
                        className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
                      >
                        <option value="" disabled>Select ASM</option>
                        {asmOptions.map((option) => <option key={option.id} value={option.id}>{displayStaff(option)}</option>)}
                      </select>
                    </div>
                    <InputField label="RSM" value={selectedAsmRsm?.name || ''} onChange={() => {}} placeholder="Auto-filled from ASM" required={false} />
                    <InputField label="Reporting Manager" value={reportingManagerLabel} onChange={() => {}} placeholder="Auto-filled from ASM" required={false} />
                  </>
                )}

                {(role === 'ASM' || role === 'RSM') && (
                  <div className="md:col-span-2 flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">States</label>
                    <div className="max-h-52 overflow-y-auto rounded-lg border border-gray-200 bg-white p-2">
                      {rsmAssignedStates.length ? rsmAssignedStates.map((state) => (
                        <label key={state} className="flex cursor-pointer items-center gap-3 rounded px-2 py-1.5 text-sm hover:bg-gray-50">
                          <input type="checkbox" checked={assignedStates.includes(state)} onChange={() => toggleState(state)} className="h-4 w-4 accent-indigo-600" />
                          <span className="text-black">{state}</span>
                        </label>
                      )) : <p className="px-2 py-2 text-sm text-black">Select an RSM with assigned states.</p>}
                    </div>
                  </div>
                )}

                {role === 'ASM' && (
                  <div className="md:col-span-2 flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">Cities</label>
                    <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-200 bg-white p-2">
                      {assignedStates.length ? assignedStates.map((state) => (
                        <div key={state} className="mb-2 last:mb-0">
                          <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{state}</p>
                          {citiesByState[state]?.length ? citiesByState[state].map((city) => (
                            <label key={city} className="flex cursor-pointer items-center gap-3 rounded px-2 py-1.5 text-sm hover:bg-gray-50">
                              <input type="checkbox" checked={assignedCities.includes(city)} onChange={() => toggleCity(city)} className="h-4 w-4 accent-indigo-600" />
                              <span className="text-black">{city}</span>
                            </label>
                          )) : <p className="px-2 py-1 text-xs text-gray-400">No cities listed for this state.</p>}
                        </div>
                      )) : <p className="px-2 py-2 text-sm text-gray-900">Select states above to choose cities.</p>}
                    </div>
                  </div>
                )}

                {role === 'EXECUTIVE' && (
                  <div className="md:col-span-2 flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">Cities</label>
                    <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-200 bg-white p-2">
                      {smCitiesByState.length ? smCitiesByState.map(({ state, cities }) => (
                        <div key={state} className="mb-2 last:mb-0">
                          <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{state}</p>
                          {cities.map((city) => (
                            <label key={city} className="flex cursor-pointer items-center gap-3 rounded px-2 py-1.5 text-sm hover:bg-gray-50">
                              <input type="checkbox" checked={assignedCities.includes(city)} onChange={() => toggleCity(city)} className="h-4 w-4 accent-indigo-600" />
                              <span className="text-black">{city}</span>
                            </label>
                          ))}
                        </div>
                      )) : (
                        <p className="px-2 py-2 text-sm text-gray-900">
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
              <button type="button" onClick={() => router.back()} className="px-5 py-2.5 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 transition">Cancel</button>
              <button type="submit" disabled={isSaving} className="flex items-center gap-2 px-6 py-2.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed transition font-medium">
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