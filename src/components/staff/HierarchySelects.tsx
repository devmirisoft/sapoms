'use client'

import { SALES_REGION_OPTIONS } from '@/lib/salesRegions'

// Shared by Add Staff and Edit Staff: region first, then who a Sales Manager reports to.

const SELECT_CLASS = 'px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition disabled:bg-gray-50 disabled:text-gray-400'

function Label({ text, required = true }: { text: string; required?: boolean }) {
  return (
    <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">
      {text}{required ? <span className="text-orange-500 ml-0.5">*</span> : null}
    </label>
  )
}

export function RegionSelect({ value, onChange }: { value: string; onChange: (region: string) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label text="Region" />
      <select required value={value} onChange={(event) => onChange(event.target.value)} className={SELECT_CLASS}>
        <option value="" disabled>Select region</option>
        {SALES_REGION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </div>
  )
}

type Group = { label: string; staff: Array<{ id: string; name: string }> }

// With no ASM or RSM in the region there is nobody to pick: the Sales Manager
// floats in the region and the NSM covers their approvals.
export function ReportsToSelect({ region, groups, value, onChange }: { region: string; groups: Group[]; value: string; onChange: (id: string) => void }) {
  const hasOptions = groups.length > 0
  return (
    <div className="flex flex-col gap-1.5">
      <Label text="Reports To" required={hasOptions} />
      <select required={hasOptions} value={value} disabled={!region || !hasOptions} onChange={(event) => onChange(event.target.value)} className={SELECT_CLASS}>
        <option value="" disabled>{!region ? 'Select region first' : hasOptions ? 'Select ASM or RSM' : 'No ASM or RSM yet — approvals go to the NSM'}</option>
        {groups.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.staff.map((staff) => <option key={staff.id} value={staff.id}>{staff.name}</option>)}
          </optgroup>
        ))}
      </select>
    </div>
  )
}
