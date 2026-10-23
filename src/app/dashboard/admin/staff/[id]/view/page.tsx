'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, MapPin, Pencil, Phone, User, UserRound, Users, type LucideIcon } from 'lucide-react'

const ADMIN_STAFF_URL = "/api/admin/staff"
const STAFF_LIST_ROUTE = "/dashboard/admin/staff/stafflist"

type Relation = { id: string; name: string; email?: string } | null

// Same labels as the staff form: RSM/ASM/NSM by auth role, otherwise by staff role type.
function roleLabel(staff: any) {
  if (staff.role === 'NSM' || staff.role === 'RSM' || staff.role === 'ASM') return staff.role
  if (staff.staffRoleType === '1') return 'Sales Manager'
  if (staff.staffRoleType === '2') return 'Staff'
  return '-'
}

function relationText(rel: Relation) {
  return rel ? `${rel.name}${rel.email ? ` (${rel.email})` : ''}` : '-'
}

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((word) => word[0]).join('').toUpperCase() || '?'
}

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-600',
  SUSPENDED: 'bg-amber-50 text-amber-600',
  INACTIVE: 'bg-red-50 text-red-600',
}

function Field({ label, children }: { label: string; children?: React.ReactNode }) {
  return (
    <div className="py-2.5">
      <div className="text-[13px] text-slate-500">{label}</div>
      <div className="mt-1 text-[15px] text-slate-900 whitespace-pre-wrap break-words">{children || '-'}</div>
    </div>
  )
}

// Fields sit in two columns with a divider between them (left border on every right-hand field).
function Card({ title, icon: Icon, tint, className = '', children }: {
  title: string
  icon: LucideIcon
  tint: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <section className={`rounded-xl bg-white p-6 shadow-[0_1px_3px_rgba(15,23,42,0.06)] ${className}`}>
      <div className="mb-4 flex items-center gap-4">
        <span className={`flex h-11 w-11 items-center justify-center rounded-lg ${tint}`}>
          <Icon className="h-5 w-5" />
        </span>
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      </div>
      <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2 sm:[&>*:nth-child(even)]:border-l sm:[&>*:nth-child(even)]:border-slate-100 sm:[&>*:nth-child(even)]:pl-8">
        {children}
      </div>
    </section>
  )
}

export default function StaffViewPage() {
  const params = useParams()
  // useParams hands back the raw segment, so "nsm%3A<id>" arrives encoded.
  const id = decodeURIComponent(String(params.id || ""))

  const [isLoading, setIsLoading] = useState(true)
  const [staff, setStaff] = useState<any>(null)

  useEffect(() => {
    if (!id) return
    fetch(`${ADMIN_STAFF_URL}/${encodeURIComponent(id)}`, { credentials: "include" })
      .then((res) => res.json())
      .then((json) => { if (json?.success) setStaff(json.data || {}) })
      .catch((err) => console.error('Failed to load staff', err))
      .finally(() => setIsLoading(false))
  }, [id])

  if (isLoading) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-slate-500">Loading staff...</p>
      </div>
    </div>
  )

  if (!staff) return (
    <div className="min-h-screen bg-slate-50 p-6">No staff member found</div>
  )

  const status = String(staff.status || "").toUpperCase()
  const rsms: NonNullable<Relation>[] = Array.isArray(staff.rsms) ? staff.rsms : []

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="admin-page-shell">
        <Link href={STAFF_LIST_ROUTE} className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-900 hover:text-indigo-600">
          <ArrowLeft className="h-4 w-4" /> Back to Staff List
        </Link>

        <div className="mt-5 flex items-center justify-between gap-4 border-b border-slate-200 pb-4">
          <div className="flex items-center gap-6">
            <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-indigo-300 text-2xl font-bold text-white">
              {initials(String(staff.name || ''))}
            </span>
            <div>
              <h1 className="text-3xl font-bold text-slate-900">Staff Details</h1>
              <p className="mt-1 text-slate-500">View detailed information about the staff member</p>
            </div>
          </div>
          <Link
            href={`/dashboard/admin/staff/${encodeURIComponent(id)}`}
            className="inline-flex items-center gap-2 self-start rounded-lg bg-indigo-700 px-5 py-2.5 text-base font-medium text-white shadow-sm hover:bg-indigo-600"
          >
            <Pencil className="h-4 w-4" /> Edit
          </Link>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card title="Basic Information" icon={User} tint="bg-blue-50 text-blue-600">
            <Field label="Name">{staff.name}</Field>
            <Field label="Email">{staff.email}</Field>
            <Field label="Status">
              {status && (
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${STATUS_STYLES[status] ?? STATUS_STYLES.INACTIVE}`}>
                  <span className="h-1.5 w-1.5 rounded-full bg-current" /> {status}
                </span>
              )}
            </Field>
            <Field label="Designation">{staff.designation}</Field>
            <Field label="Location">{staff.location}</Field>
          </Card>

          <Card title="Role & Reporting" icon={Users} tint="bg-violet-50 text-violet-600">
            <Field label="Role">{roleLabel(staff)}</Field>
            <Field label="Sales Region">{staff.salesRegion}</Field>
            <Field label="Warehouse">{staff.warehouse}</Field>
            {staff.reportingManager && <Field label="Reporting Manager">{relationText(staff.reportingManager)}</Field>}
            {staff.parentRsm && <Field label="RSM">{relationText(staff.parentRsm)}</Field>}
            {staff.parentAsm && <Field label="ASM">{relationText(staff.parentAsm)}</Field>}
            {rsms.length > 0 && <Field label="Linked RSMs">{rsms.map(relationText).join("\n")}</Field>}
          </Card>

          <Card title="Assigned Area" icon={MapPin} tint="bg-emerald-50 text-emerald-600">
            <Field label="States">{(staff.assignedStates ?? []).join(", ")}</Field>
            <Field label="Cities">{(staff.assignedCities ?? []).join(", ")}</Field>
          </Card>

          <Card title="Contact" icon={Phone} tint="bg-red-50 text-red-500">
            <Field label="Mobile No.">{staff.mobileNo}</Field>
            <Field label="Alternate No.">{staff.alternateNo}</Field>
            <Field label="Emergency Contact 1">{staff.emergencyContactNo1}</Field>
            <Field label="Emergency Contact 2">{staff.emergencyContactNo2}</Field>
            <Field label="Permanent Address">{staff.permanentAddress}</Field>
            <Field label="Local Address">{staff.localAddress}</Field>
          </Card>

          <Card title="Personal" icon={UserRound} tint="bg-indigo-50 text-indigo-600" className="lg:col-span-2">
            <Field label="Gender">{staff.gender}</Field>
            <Field label="Date of Birth">{staff.dob}</Field>
            <Field label="Nationality">{staff.nationality}</Field>
            <Field label="Marital Status">{staff.maritalStatus}</Field>
            <Field label="Qualification">{staff.qualification}</Field>
          </Card>
        </div>
      </div>
    </div>
  )
}
