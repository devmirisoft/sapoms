'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import axios from 'axios'
import { Pencil, Trash2, Download, Search, Users, UserPlus, Eye, EyeOff, MoreVertical, ChevronDown, X } from 'lucide-react'

type StaffData = {
  staff_id: string
  staff_name: string
  staff_email: string
  staff_roletype: string
  sales_region?: string
  salesRegion?: string
  role?: string
  staff_password: string
  staff_designation: string
  staff_location: string
  status: string
}

type StaffResponse = {
  data: StaffData[]
  count: number
  last_page: number
}

const SHIMMER = "animate-pulse bg-gray-200 rounded"
const ADMIN_STAFF_URL = "/api/admin/staff"
const ITEMS_PER_PAGE = 10
const getStaffEditRoute = (staffId: string) => `/dashboard/admin/staff/${encodeURIComponent(staffId)}`

// Shared feedback classes: press-down responds instantly (Apple's "respond
// on pointer-down, not release"), and prefers-reduced-motion drops the
// transform/transition entirely rather than losing the feedback outright.
const pressable = 'transition-transform duration-100 active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100'

function getFloatingMenuPosition(button: HTMLElement) {
  const rect = button.getBoundingClientRect()
  const menuWidth = 176
  const gutter = 12
  return {
    top: Math.min(rect.bottom + 8, window.innerHeight - gutter),
    left: Math.max(gutter, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - gutter)),
  }
}

function isMenuOpen(openMenu: FloatingMenuState, id: string) {
  return openMenu?.id === id
}

function openFloatingMenu(
  event: React.MouseEvent<HTMLButtonElement>,
  id: string,
  setOpenMenu: React.Dispatch<React.SetStateAction<FloatingMenuState>>,
) {
  event.stopPropagation()
  const position = getFloatingMenuPosition(event.currentTarget)
  setOpenMenu((prev) => prev?.id === id ? null : { id, ...position })
}

function formatSalesRegion(value?: string) {
  const normalized = String(value ?? "").trim().toUpperCase()
  if (!normalized) return ""
  return normalized.charAt(0) + normalized.slice(1).toLowerCase()
}

function roleBadge(staff: Pick<StaffData, "role" | "staff_roletype" | "sales_region" | "salesRegion">) {
  const authRole = String(staff.role ?? "").toUpperCase()
  const staffRoleType = String(staff.staff_roletype ?? "").toUpperCase()
  const regionLabel = formatSalesRegion(staff.sales_region || staff.salesRegion)

  if (authRole === "NSM") return { bg: "bg-emerald-50", text: "text-emerald-700", label: "NSM" }
  if (authRole === "RSM" || staffRoleType === "RSM") return { bg: "bg-sky-50", text: "text-sky-700", label: regionLabel ? `${regionLabel} RSM` : "RSM" }
  if (authRole === "ASM" || staffRoleType === "ASM") return { bg: "bg-cyan-50", text: "text-cyan-700", label: "ASM" }

  switch (staffRoleType) {
    case "1": return { bg: "bg-indigo-50", text: "text-indigo-700", label: "Staff" }
    case "2": return { bg: "bg-violet-50", text: "text-violet-700", label: "Sales Manager" }
    default:  return { bg: "bg-gray-100",  text: "text-gray-500",   label: "Unknown" }
  }
}

function initials(name: string) {
  return name?.split(" ").slice(0, 2).map(w => w[0]).join("").toUpperCase() || "?"
}

type AppRole = "admin" | "staff" | "accountant"
type FloatingMenuState = { id: string; top: number; left: number } | null

function getRole(): AppRole {
  if (typeof window === 'undefined') return 'admin'
  if (localStorage.getItem('accountant_token')) return 'accountant'
  const rt = localStorage.getItem('roletype')
  if (rt === '1') return 'staff'
  return 'admin'
}

export default function StaffListPage() {
  const [page,          setPage]          = useState(1)
  const [search,        setSearch]        = useState("")
  const [searchInput,   setSearchInput]   = useState("")
  const [roleFilter,    setRoleFilter]    = useState("")
  const [emailFilter,   setEmailFilter]   = useState("")
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [toastMsg,      setToastMsg]      = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [visiblePasswords, setVisiblePasswords] = useState<Set<string>>(() => new Set())
  const [openMenu, setOpenMenu] = useState<FloatingMenuState>(null)
  const [role, setRole] = useState<AppRole>('admin')

  const queryClient = useQueryClient()

  // Toast auto-dismiss
  useEffect(() => {
    if (!toastMsg) return
    const t = setTimeout(() => setToastMsg(null), 3000)
    return () => clearTimeout(t)
  }, [toastMsg])

  useEffect(() => { setRole(getRole()) }, [])

  useEffect(() => {
    const handleDocClick = (e: any) => {
      const path = (e?.composedPath && e.composedPath()) || e?.path || []
      if (Array.isArray(path) && path.some((el: any) => el?.dataset?.menuId)) return
      let node = e?.target
      while (node) {
        if (node?.dataset && node.dataset.menuId) return
        node = node.parentNode
      }
      setOpenMenu(null)
    }
    document.addEventListener('click', handleDocClick)
    return () => document.removeEventListener('click', handleDocClick)
  }, [])

  const { data: response, isLoading, isError, refetch } = useQuery<StaffResponse>({
    queryKey: search ? ['stafflist', page, search] : ['stafflist', 'all'],
    queryFn: async () => {
      // If user is searching, use normal paginated endpoint.
      if (search) {
        const res = await axios.get(
          `${ADMIN_STAFF_URL}?page=${page}&limit=${ITEMS_PER_PAGE}&search=${encodeURIComponent(search)}`
        )
        return res.data
      }

      // No search -> fetch all pages from server and combine results so UI can display full list.
      const first = await axios.get(`${ADMIN_STAFF_URL}?page=1&limit=${ITEMS_PER_PAGE}&search=`, { withCredentials: true })
      const firstRaw = first.data || {}
      const firstData: StaffResponse = {
        data: firstRaw.data || [],
        count: firstRaw.count ?? firstRaw.total ?? firstRaw.totalRecords ?? 0,
        last_page: firstRaw.last_page ?? firstRaw.lastpage ?? firstRaw.lastPage ?? undefined,
      }
      // Derive last page: prefer explicit last_page, else compute from total count.
      // If server ignores our `limit` value, infer the server page size from firstData.length.
      const perPageUsed = (firstData.data && firstData.data.length > 0) ? firstData.data.length : ITEMS_PER_PAGE
      const derivedLast = firstData.last_page ?? (firstData.count ? Math.ceil(firstData.count / perPageUsed) : 1)
      const lastPage = Math.max(1, derivedLast || 1)
      let allData: StaffData[] = firstData.data || []

      if (lastPage > 1) {
        const requests: Promise<any>[] = []
        for (let p = 2; p <= lastPage; p++) {
          requests.push(axios.get(`${ADMIN_STAFF_URL}?page=${p}&limit=${ITEMS_PER_PAGE}&search=`, { withCredentials: true }))
        }
        const pages = await Promise.all(requests)
        for (const r of pages) {
          const d = r.data
          if (d?.data) allData = allData.concat(d.data)
        }
      }

      return { data: allData, count: firstData.count || allData.length, last_page: 1 }
    },
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000,
  })

  const data: StaffData[] = response?.data || []

  // Headcount per role label in the current dataset — drives both the Role
  // dropdown options and the summary chips above the table.
  const roleCounts = useMemo(() => {
    const counts = new Map<string, number>()
    data.forEach(s => {
      const label = roleBadge(s).label
      counts.set(label, (counts.get(label) ?? 0) + 1)
    })
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [data])

  const roleOptions = useMemo(
    () => roleCounts.map(([label]) => label).sort(),
    [roleCounts]
  )

  // Apply role + email filters client-side on top of whatever the server returned.
  const roleFilteredData = useMemo(() => {
    const email = emailFilter.trim().toLowerCase()
    return data.filter(s => {
      if (roleFilter && roleBadge(s).label !== roleFilter) return false
      if (email && !String(s.staff_email ?? "").toLowerCase().includes(email)) return false
      return true
    })
  }, [data, roleFilter, emailFilter])

  const clientFiltered = !!(roleFilter || emailFilter.trim())

  const totalFromServer = response?.count ?? 0
  const total = clientFiltered ? roleFilteredData.length : (totalFromServer || data.length)
  const serverLastPage = response?.last_page ?? 0
  const totalPages = !clientFiltered && serverLastPage > 1 ? serverLastPage : Math.max(1, Math.ceil(total / ITEMS_PER_PAGE))

  // If server returns a full dataset (no server-side pagination), paginate on the client
  const serverPaging = !clientFiltered && serverLastPage > 1
  const displayedData: StaffData[] = serverPaging ? roleFilteredData : roleFilteredData.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE)

  // Reset to page 1 whenever a client-side filter changes so pagination stays in sync.
  useEffect(() => { setPage(1) }, [roleFilter, emailFilter])

  // Prefetch next page (only when searching / using server pagination)
  useEffect(() => {
    if (!search) return
    if (page >= totalPages) return
    queryClient.prefetchQuery({
      queryKey: ['stafflist', page + 1, search],
      queryFn: async () => {
        const res = await axios.get(
          `${ADMIN_STAFF_URL}?page=${page + 1}&limit=${ITEMS_PER_PAGE}&search=${encodeURIComponent(search)}`
        )
        return res.data
      },
    })
  }, [page, search, totalPages, queryClient])

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1)
      setSearch(searchInput)
    }, 400)
    return () => clearTimeout(timer)
  }, [searchInput])

  const handleDelete = async (id: string) => {
    try {
      setToastMsg({ text: "Staff deletion is not available in Stage 3", type: 'error' })
    } catch {
      setToastMsg({ text: "Failed to delete staff", type: 'error' })
    } finally {
      setDeleteConfirm(null)
    }
  }

  const handleDownloadCSV = () => {
    if (!roleFilteredData.length) return
    const headers = ["S.No.", "Name", "Email", "Role", "Password"]
    const rows = roleFilteredData.map((s, i) => [
      i + 1,
      s.staff_name,
      s.staff_email,
      roleBadge(s).label,
      s.staff_password,
    ])
    const csv = [headers, ...rows].map(r => r.join(",")).join("\n")
    const blob = new Blob([csv], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "staff-list.csv"
    a.click()
    URL.revokeObjectURL(url)
  }

  function pageNumbers(): (number | "...")[] {
    const pages: (number | "...")[] = []
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i)
    } else {
      pages.push(1)
      if (page > 3) pages.push("...")
      for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i)
      if (page < totalPages - 2) pages.push("...")
      pages.push(totalPages)
    }
    return pages
  }

  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > totalPages) return
    setPage(newPage)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const startIndex = total === 0 ? 0 : (page - 1) * ITEMS_PER_PAGE + 1
  const endIndex = Math.min(page * ITEMS_PER_PAGE, total)

  return (
    <div className="min-h-screen bg-gray-100">
      <style>{`
        @keyframes staff-toast-in { from { opacity: 0; transform: translateY(-8px) scale(0.97); } to { opacity: 1; transform: translateY(0) scale(1); } }
        @keyframes staff-menu-in { from { opacity: 0; transform: translateY(-4px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
        .staff-toast { animation: staff-toast-in 220ms cubic-bezier(0.16, 1, 0.3, 1); }
        .staff-menu { animation: staff-menu-in 140ms cubic-bezier(0.16, 1, 0.3, 1); transform-origin: top right; }
        @media (prefers-reduced-motion: reduce) {
          .staff-toast, .staff-menu { animation: none; }
        }
      `}</style>

      {/* Toast */}
      {toastMsg && (
        <div className={`staff-toast fixed top-5 right-5 z-50 text-sm px-4 py-3 rounded-lg shadow-lg ${
          toastMsg.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-500 text-white'
        }`}>
          {toastMsg.text}
        </div>
      )}

      {/* Delete Confirm Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center">
          <div className="bg-white rounded-xl shadow-xl p-6 w-80 border border-gray-200">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 rounded-full bg-red-50 flex items-center justify-center">
                <Trash2 className="w-4 h-4 text-red-500" />
              </div>
              <h3 className="font-semibold text-gray-900">Delete Staff</h3>
            </div>
            <p className="text-sm text-gray-500 mb-5">
              Are you sure you want to delete this staff member? This action cannot be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDeleteConfirm(null)}
                className={`px-4 py-2 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 ${pressable}`}
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm)}
                className={`px-4 py-2 text-sm bg-red-500 text-white rounded-lg hover:bg-red-600 font-medium ${pressable}`}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="p-6 admin-page-shell">

        {/* Header — page title + export/add actions; search & role filter now live inline in the table header below */}
        <div className="mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Staff List</h1>
              <p className="text-sm text-gray-500 mt-1">
                {total > 0 ? `${total} staff member${total !== 1 ? "s" : ""} total` : "Manage all registered staff members"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleDownloadCSV}
                disabled={!roleFilteredData.length}
                className={`flex items-center gap-2 px-4 py-2 text-sm bg-white border border-gray-200 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm ${pressable}`}
              >
                <Download className="w-4 h-4" />
                Export CSV
              </button>
              <Link
                href="/dashboard/admin/staff/addstaff"
                className={`inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 ${pressable}`}
              >
                <UserPlus className="w-4 h-4" />
                Add staff
              </Link>
            </div>
          </div>
        </div>

        {/* Headcount per role — click a chip to filter the table by that role */}
        {!isLoading && roleCounts.length > 0 && (
          <div className="mb-5 flex flex-wrap items-center gap-2">
            {roleCounts.map(([label, count]) => {
              const active = roleFilter === label
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => setRoleFilter(active ? "" : label)}
                  aria-pressed={active}
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium shadow-sm ${pressable} ${
                    active
                      ? "border-indigo-600 bg-indigo-600 text-white"
                      : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  {label}
                  <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${
                    active ? "bg-white/20 text-white" : "bg-gray-100 text-gray-600"
                  }`}>
                    {count}
                  </span>
                </button>
              )
            })}
            {roleFilter && (
              <button
                type="button"
                onClick={() => setRoleFilter("")}
                className="text-xs text-gray-500 underline hover:text-gray-800"
              >
                Clear role filter
              </button>
            )}
          </div>
        )}

        {isError && (
          <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
            Failed to load staff data. Please try again.
          </div>
        )}

        {/* Table Card */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-white">
                  <th className="p-1.5 text-left">
                    <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-xs font-semibold text-gray-600 uppercase tracking-wide">S.No.</div>
                  </th>

                  <th className="p-1.5 text-left">
                    <div className="relative">
                      <input
                        type="text"
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                        placeholder="Name"
                        className="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-gray-600 placeholder:text-gray-600 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20"
                      />
                      {searchInput && (
                        <button
                          type="button"
                          onClick={() => setSearchInput("")}
                          className={`absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-600 ${pressable}`}
                          aria-label="Clear name search"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </th>

                  <th className="p-1.5 text-left">
                    <div className="relative">
                      <input
                        type="text"
                        value={emailFilter}
                        onChange={(e) => setEmailFilter(e.target.value)}
                        placeholder="Email"
                        className="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-gray-600 placeholder:text-gray-600 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20"
                      />
                      {emailFilter && (
                        <button
                          type="button"
                          onClick={() => setEmailFilter("")}
                          className={`absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-600 ${pressable}`}
                          aria-label="Clear email filter"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </th>

                  <th className="p-1.5 text-left">
                    <div className="relative">
                      <select
                        value={roleFilter}
                        onChange={(e) => setRoleFilter(e.target.value)}
                        className="w-full appearance-none rounded-lg border border-gray-200 bg-gray-50 pl-4 pr-8 py-2.5 text-xs font-semibold uppercase tracking-wide text-gray-600 outline-none transition cursor-pointer focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20"
                      >
                        <option value="">Role</option>
                        {roleOptions.map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                    </div>
                  </th>

                  <th className="p-1.5 text-left">
                    <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-xs font-semibold text-gray-600 uppercase tracking-wide">Password</div>
                  </th>

                  <th className="p-1.5 text-right">
                    <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-xs font-semibold text-gray-600 uppercase tracking-wide">Actions</div>
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-gray-100">
                {/* Shimmer */}
                {isLoading && Array.from({ length: ITEMS_PER_PAGE }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 6 }).map((_, j) => (
                      <td key={j} className="px-4 py-4">
                        <div className={`${SHIMMER} h-4 w-full`} />
                      </td>
                    ))}
                  </tr>
                ))}

                {/* Empty */}
                {!isLoading && displayedData.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-6 py-16 text-center">
                      <div className="flex flex-col items-center gap-2 text-gray-400">
                        <Users className="w-8 h-8" />
                        <span className="text-sm">No staff members found</span>
                      </div>
                    </td>
                  </tr>
                )}

                {/* Rows */}
                {!isLoading && displayedData.map((staff, i) => {
                  const badge = roleBadge(staff)
                  return (
                    <tr key={staff.staff_id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-4 text-gray-400 text-xs">{startIndex + i}</td>

                      <td className="px-4 py-4">
                        <div className="flex items-center gap-3">
                          {/* <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-xs font-semibold flex-shrink-0">
                            {initials(staff.staff_name)}
                          </div> */}
                          <span className="font-medium text-gray-800">{staff.staff_name || "-"}</span>
                        </div>
                      </td>

                      <td className="px-4 py-4 text-gray-500 text-xs">{staff.staff_email || "-"}</td>

                      <td className="px-4 py-4">
                        <span className={`${badge.bg} ${badge.text} text-xs font-medium px-2.5 py-1 rounded-full whitespace-nowrap`}>
                          {badge.label}
                        </span>
                      </td>

                      <td className="px-4 py-4 font-mono text-xs tracking-widest">
                        {(() => {
                          const visible = visiblePasswords.has(staff.staff_id)
                          return (
                            <div className="flex items-center gap-2">
                              <span className={`${visible ? 'text-gray-800 bg-amber-50 px-2 py-0.5 rounded border border-amber-100 select-all' : 'text-gray-300'}`}>
                                {visible ? staff.staff_password || "-" : "********"}
                              </span>
                              {/* {(
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); setVisiblePasswords(prev => {
                                    const next = new Set(prev)
                                    if (next.has(staff.staff_id)) next.delete(staff.staff_id)
                                    else next.add(staff.staff_id)
                                    return next
                                  })}}
                                  className="p-1 rounded-md text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition"
                                  aria-label={visible ? 'Hide staff password' : 'Show staff password'}
                                  title={visible ? 'Hide password' : 'Show password'}
                                >
                                  {visible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                </button>
                              )} */}
                            </div>
                          )
                        })()}
                      </td>

                      <td className="px-4 py-4">
                        <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                          <div className="relative">
                            <button
                              onClick={(e) => openFloatingMenu(e, staff.staff_id, setOpenMenu)}
                              data-menu-id={staff.staff_id}
                              className={`p-2 rounded-md text-gray-600 hover:bg-gray-50 ${pressable}`}
                              aria-label="Open actions"
                            >
                              <MoreVertical className="w-4 h-4" />
                            </button>
                            {isMenuOpen(openMenu, staff.staff_id) && (
                              <div onClick={(e) => e.stopPropagation()} data-menu-id={staff.staff_id} style={{ top: openMenu?.top ?? 0, left: openMenu?.left ?? 0 }} className="staff-menu fixed w-44 bg-white border border-gray-200 rounded-md shadow-2xl z-[9999] py-1">
                                <Link href={getStaffEditRoute(staff.staff_id)} className="block px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">Edit</Link>
                                <button onClick={(e) => { e.stopPropagation(); setDeleteConfirm(staff.staff_id); setOpenMenu(null) }} className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50">Delete</button>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100">
            <span className="text-xs text-gray-400">
              {displayedData.length > 0
                ? `Showing ${startIndex}–${endIndex} of ${total} staff`
                : "No results"}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => handlePageChange(page - 1)}
                disabled={page === 1}
                className={`px-3 py-1.5 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed ${pressable}`}
              >
                Prev
              </button>

              {pageNumbers().map((p, idx) =>
                p === "..." ? (
                  <span key={`ellipsis-${idx}`} className="px-2 text-gray-400 text-sm">...</span>
                ) : (
                  <button
                    key={p}
                    onClick={() => handlePageChange(p)}
                    className={`px-3 py-1.5 text-sm rounded-lg border ${pressable} ${
                      p === page
                        ? "bg-indigo-600 text-white border-indigo-600 font-medium"
                        : "border-gray-200 text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    {p}
                  </button>
                )
              )}

              <button
                onClick={() => handlePageChange(page + 1)}
                disabled={page >= totalPages}
                className={`px-3 py-1.5 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed ${pressable}`}
              >
                Next
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}