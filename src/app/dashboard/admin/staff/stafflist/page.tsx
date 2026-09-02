'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import axios from 'axios'
import { Pencil, Trash2, Download, Search, Users, UserPlus, MoreVertical, ChevronDown, ChevronLeft, Network, Briefcase, User, X } from 'lucide-react'
import { showToast } from "@/components/ui/toast";
import { type FloatingMenuState, isMenuOpen, openFloatingMenu, measureFloatingMenu } from "@/components/ui/floating-menu";

type StaffRelation = { id: string; name: string; email?: string } | null

type StaffData = {
  staff_id: string
  staff_name: string
  staff_email: string
  staff_roletype: string
  sales_region?: string
  salesRegion?: string
  role?: string
  staff_designation: string
  staff_location: string
  gender?: string
  assigned_cities?: string[]
  assigned_states?: string[]
  status: string
  parentRsm?: StaffRelation
  parentAsm?: StaffRelation
  reportingManager?: StaffRelation
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
    case "1": return { bg: "bg-violet-50", text: "text-violet-700", label: "Sales Manager" }
    case "2": return { bg: "bg-indigo-50", text: "text-indigo-700", label: "Staff" }
    default:  return { bg: "bg-gray-100",  text: "text-gray-500",   label: "Unknown" }
  }
}

type StaffStatus = "ACTIVE" | "INACTIVE" | "SUSPENDED"

function normalizeStaffStatus(value: unknown): StaffStatus {
  const normalized = String(value ?? "").trim().toUpperCase()
  return normalized === "INACTIVE" || normalized === "SUSPENDED" ? normalized : "ACTIVE"
}

function statusBadge(status: StaffStatus) {
  if (status === "ACTIVE") return { bg: "bg-emerald-50", text: "text-emerald-700", label: "Active" }
  if (status === "SUSPENDED") return { bg: "bg-amber-50", text: "text-amber-700", label: "Suspended" }
  return { bg: "bg-red-50", text: "text-red-600", label: "Inactive" }
}

// Mirrors the hierarchy the staff repository writes: RSM reports to the NSM,
// ASM and plain Staff to their RSM, a Sales Manager to its ASM.
function reportingManagerOf(staff: StaffData): StaffRelation {
  const authRole = String(staff.role ?? "").toUpperCase()
  const staffRoleType = String(staff.staff_roletype ?? "").toUpperCase()
  if (authRole === "NSM") return null
  if (authRole === "RSM" || staffRoleType === "RSM") return staff.reportingManager ?? null
  if (authRole === "ASM" || staffRoleType === "ASM") return staff.parentRsm ?? null
  if (staffRoleType === "1") return staff.parentAsm ?? null
  return staff.parentRsm ?? null
}

// staff_profiles and admin_profiles (where the NSM lives) are separate id
// sequences, so a bare id can collide across the two. Every map key, React key
// and hierarchy link on this page namespaces the id by its table.
function isNsmRow(staff: Pick<StaffData, "role" | "staff_roletype">) {
  return String(staff.role ?? "").toUpperCase() === "NSM" || String(staff.staff_roletype ?? "").toUpperCase() === "NSM"
}

function nodeKey(staff: StaffData) {
  return `${isNsmRow(staff) ? "nsm" : "staff"}:${staff.staff_id}`
}

// What /api/admin/staff/[staffId] expects: the NSM is addressed as "nsm:<id>"
// so it resolves against admin_profiles, a bare id means a staff profile.
function apiId(staff: StaffData) {
  return isNsmRow(staff) ? `nsm:${staff.staff_id}` : staff.staff_id
}

// An RSM reports to an NSM (admin_profiles); everyone else to a staff row.
function managerKey(staff: StaffData) {
  const rel = reportingManagerOf(staff)
  if (!rel) return null
  const isRsm = String(staff.role ?? "").toUpperCase() === "RSM" || String(staff.staff_roletype ?? "").toUpperCase() === "RSM"
  return `${isRsm ? "nsm" : "staff"}:${rel.id}`
}

// A list cell that stays one line: first entry, then "+N".
function listSummary(values: string[] | undefined, fallback?: string) {
  const items = (values ?? []).filter(Boolean)
  if (!items.length) return fallback?.trim() || ""
  return items.length === 1 ? items[0] : `${items[0]} +${items.length - 1}`
}

function csvCell(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`
}

function initials(name: string) {
  return name?.split(" ").slice(0, 2).map(w => w[0]).join("").toUpperCase() || "?"
}

type AppRole = "admin" | "staff" | "accountant"

function getRole(): AppRole {
  if (typeof window === 'undefined') return 'admin'
  if (localStorage.getItem('accountant_token')) return 'accountant'
  const rt = localStorage.getItem('roletype')
  if (rt === '1') return 'staff'
  return 'admin'
}


// ---------------------------------------------------------------- hierarchy

// Walk up via reportingManagerOf. A manager that isn't in the staff list
// (the NSM lives in the admin table) still gets a node from its relation.
function ancestorsOf(staff: StaffData, byId: Map<string, StaffData>) {
  const chain: { id: string; name: string; label: string }[] = []
  const seen = new Set<string>()
  let current: StaffData | null = staff
  while (current) {
    const rel = reportingManagerOf(current)
    const key = managerKey(current)
    if (!rel || !key || seen.has(key)) break
    seen.add(key)
    const full = byId.get(key)
    chain.unshift({ id: key, name: rel.name || full?.staff_name || "-", label: full ? roleBadge(full).label : "NSM" })
    current = full ?? null
  }
  return chain
}

function countTeam(id: string, reports: Map<string, StaffData[]>): number {
  return (reports.get(id) ?? []).reduce((sum, r) => sum + 1 + countTeam(nodeKey(r), reports), 0)
}

type TreeNode = { id: string; name: string; role: string; email?: string; children: TreeNode[]; subject?: boolean; muted?: boolean }

const CARD_W = 232
const CARD_H = 148
const COL_GAP = 44
const ROW_GAP = 104
const SLOT = CARD_W + COL_GAP
const LEVEL = CARD_H + ROW_GAP
const PAD_X = 24
const PAD_TOP = 34   // room for the avatar that overhangs the first row
const ELBOW = 14

function toTreeNode(staff: StaffData, reports: Map<string, StaffData[]>, subject: boolean): TreeNode {
  return {
    id: nodeKey(staff),
    name: staff.staff_name || "-",
    role: roleBadge(staff).label,
    email: staff.staff_email,
    subject,
    children: (reports.get(nodeKey(staff)) ?? []).map(child => toTreeNode(child, reports, false)),
  }
}

// Accent colour + spelled-out job title per role, shared by the cards and the legend.
function roleStyle(node: TreeNode) {
  if (node.muted) return { color: "#94a3b8", title: node.role, icon: Briefcase }
  if (node.role === "NSM") return { color: "#059669", title: "National Sales Manager", icon: Briefcase }
  if (node.role.endsWith("RSM")) return { color: "#3730a3", title: "Regional Sales Manager", icon: Briefcase }
  if (node.role === "ASM") return { color: "#0d9488", title: "Area Sales Manager", icon: User }
  if (node.role === "Sales Manager") return { color: "#a855f7", title: "Sales Manager", icon: User }
  return { color: "#6366f1", title: "Staff", icon: User }
}

// Tidy-tree pass: leaves take the next slot, a parent centres over its first
// and last child. Connectors drop to a shared bus between the two rows.
function HierarchyTree({ root, collapsed, onToggle }: { root: TreeNode; collapsed: Set<string>; onToggle: (id: string) => void }) {
  const { cards, links, joints, width, height } = useMemo(() => {
    const cards: { node: TreeNode; x: number; y: number; hidden: number }[] = []
    const links: string[] = []
    const joints: { cx: number; cy: number }[] = []
    let cursor = PAD_X + CARD_W / 2
    let maxDepth = 0

    const place = (node: TreeNode, depth: number): number => {
      maxDepth = Math.max(maxDepth, depth)
      const kids = collapsed.has(node.id) ? [] : node.children
      const y = PAD_TOP + depth * LEVEL
      let x: number

      if (!kids.length) {
        x = cursor
        cursor += SLOT
      } else {
        const kidXs = kids.map(kid => place(kid, depth + 1))
        x = (kidXs[0] + kidXs[kidXs.length - 1]) / 2
        const bottom = y + CARD_H
        const busY = bottom + ROW_GAP / 2
        const childTop = y + LEVEL
        links.push(`M ${x} ${bottom} V ${busY}`)
        joints.push({ cx: x, cy: bottom })
        kidXs.forEach(kidX => {
          if (Math.abs(kidX - x) < 1) {
            links.push(`M ${x} ${busY} V ${childTop}`)
          } else {
            const dir = kidX > x ? 1 : -1
            links.push(
              `M ${x} ${busY} H ${kidX - dir * ELBOW} A ${ELBOW} ${ELBOW} 0 0 ${dir > 0 ? 1 : 0} ${kidX} ${busY + ELBOW} V ${childTop}`,
            )
          }
          joints.push({ cx: kidX, cy: childTop })
        })
      }

      cards.push({ node, x, y, hidden: kids.length ? 0 : node.children.length })
      return x
    }

    place(root, 0)
    return {
      cards,
      links,
      joints,
      width: Math.max(cursor - CARD_W / 2 - COL_GAP + PAD_X, 320),
      height: PAD_TOP + maxDepth * LEVEL + CARD_H + 32,
    }
  }, [root, collapsed])

  return (
    <div className="h-full overflow-auto p-6">
      <div className="relative mx-auto" style={{ width, height }}>
        <svg width={width} height={height} className="absolute inset-0">
          {links.map((d, i) => (
            <path key={d} d={d} fill="none" stroke="#cbd5e1" strokeWidth={1.5} className="staff-edge" style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }} />
          ))}
          {joints.map((joint, i) => (
            <circle key={`${joint.cx}-${joint.cy}`} cx={joint.cx} cy={joint.cy} r={3} fill="#cbd5e1" className="staff-edge" style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }} />
          ))}
        </svg>

        {cards.map(({ node, x, y, hidden }, i) => {
          const { color, title, icon: Icon } = roleStyle(node)
          const foldable = node.children.length > 0
          return (
            <div
              key={node.id}
              className="staff-card absolute"
              style={{ left: x - CARD_W / 2, top: y, width: CARD_W, animationDelay: `${Math.min(i, 12) * 35}ms` }}
            >
              <div
                onClick={() => foldable && onToggle(node.id)}
                role={foldable ? "button" : undefined}
                tabIndex={foldable ? 0 : undefined}
                onKeyDown={(e) => { if (foldable && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onToggle(node.id) } }}
                title={node.email || node.name}
                className={`relative flex flex-col rounded-2xl border border-gray-100 bg-white px-4 pb-4 pt-8 text-center shadow-[0_4px_20px_rgba(15,23,42,0.06)] transition duration-200 ${
                  foldable ? "cursor-pointer hover:-translate-y-0.5 hover:shadow-[0_8px_28px_rgba(15,23,42,0.10)]" : ""
                } ${node.subject ? "ring-2 ring-indigo-500/25" : ""}`}
                style={{ minHeight: CARD_H, borderTop: `3px solid ${color}` }}
              >
                <span
                  className="absolute -top-6 left-1/2 grid h-12 w-12 -translate-x-1/2 place-items-center rounded-full text-sm font-bold text-white ring-4 ring-slate-50"
                  style={{ background: color }}
                >
                  {initials(node.name)}
                </span>

                {foldable && (
                  <span className="absolute right-2.5 top-2.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-slate-500">
                    {hidden > 0 ? `+${hidden}` : node.children.length}
                  </span>
                )}

                <p className="truncate text-sm font-bold text-slate-800">{node.name}</p>
                <p className="mt-1 truncate text-xs text-slate-400">{node.role}</p>

                <div className="mt-auto flex items-center justify-center gap-1.5 border-t border-gray-100 pt-3 text-xs font-medium" style={{ color }}>
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{title}</span>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const LEGEND = [
  { code: "RSM", title: "Regional Sales Manager", color: "#3730a3", icon: Briefcase },
  { code: "ASM", title: "Area Sales Manager", color: "#0d9488", icon: User },
  { code: "SM", title: "Sales Manager", color: "#a855f7", icon: User },
  { code: "Staff", title: "Team Member", color: "#6366f1", icon: User },
]

function HierarchyLegend() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 border-t border-gray-200 bg-white px-5 py-3">
      {LEGEND.map(({ code, title, color, icon: Icon }) => (
        <div key={code} className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-full text-white" style={{ background: color }}>
            <Icon className="h-3.5 w-3.5" />
          </span>
          <div className="leading-tight">
            <p className="text-xs font-bold text-slate-800">{code}</p>
            <p className="text-[11px] text-slate-400">{title}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

function HierarchyPanel({ open, onClose, data, reports }: { open: boolean; onClose: () => void; data: StaffData[]; reports: Map<string, StaffData[]> }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const byId = useMemo(() => new Map(data.map(s => [nodeKey(s), s])), [data])
  const selected = selectedId ? byId.get(selectedId) ?? null : null

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return data
      .filter(s => !needle || `${s.staff_name} ${s.staff_email} ${roleBadge(s).label}`.toLowerCase().includes(needle))
      .sort((a, b) =>
        countTeam(nodeKey(b), reports) - countTeam(nodeKey(a), reports) ||
        String(a.staff_name ?? "").localeCompare(String(b.staff_name ?? "")))
  }, [data, query, reports])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [open, onClose])

  const teamSize = selected ? countTeam(nodeKey(selected), reports) : 0

  // Managers above the subject form a single-child trunk; everything below is
  // the subject's real team.
  const root = useMemo(() => {
    if (!selected) return null
    return ancestorsOf(selected, byId).reduceRight<TreeNode>(
      (child, node) => ({ id: node.id, name: node.name, role: node.label, muted: true, children: [child] }),
      toTreeNode(selected, reports, true),
    )
  }, [selected, byId, reports])

  const toggleNode = (id: string) => setCollapsed(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  return (
    <div className={`fixed inset-0 z-[60] ${open ? "" : "pointer-events-none"}`} aria-hidden={!open}>
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-black/40 transition-opacity duration-300 ${open ? "opacity-100" : "opacity-0"}`}
      />
      <aside
        className={`absolute right-0 top-0 flex h-full w-full max-w-5xl flex-col bg-slate-50 shadow-2xl transition-transform duration-300 ease-out motion-reduce:transition-none ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="relative border-b border-gray-200 bg-white px-5 py-5 text-center">
          <h2 className="text-xl font-extrabold tracking-tight text-slate-900">Organizational Hierarchy</h2>
          <p className="mt-1 truncate text-xs text-slate-400">
            {selected ? `${selected.staff_name} · ${teamSize} in team` : "Sales Team Structure"}
          </p>
          <span className="mx-auto mt-2.5 block h-[3px] w-9 rounded-full bg-indigo-500" />
          <button
            onClick={onClose}
            aria-label="Close hierarchy"
            className={`absolute right-4 top-4 rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 ${pressable}`}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {!selected ? (
          <>
            <div className="border-b border-gray-200 bg-white px-5 pb-4">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search staff by name, email or role"
                  className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-9 pr-3 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-3">
              {matches.length === 0 && <p className="px-2 py-8 text-center text-sm text-gray-400">No staff found</p>}
              {matches.map((s, i) => {
                const badge = roleBadge(s)
                const team = countTeam(nodeKey(s), reports)
                return (
                  <button
                    key={nodeKey(s)}
                    onClick={() => { setCollapsed(new Set()); setSelectedId(nodeKey(s)) }}
                    style={{ animationDelay: `${Math.min(i, 10) * 25}ms` }}
                    className={`staff-node mb-1.5 flex w-full items-center gap-2.5 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-left shadow-sm transition-colors hover:border-indigo-300 hover:bg-indigo-50/40 ${pressable}`}
                  >
                    <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-indigo-50 text-[11px] font-semibold text-indigo-600">
                      {initials(s.staff_name)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-gray-800">{s.staff_name || "-"}</div>
                      <div className="truncate text-[11px] text-gray-400">{s.staff_email || "-"}</div>
                    </div>
                    <span className={`${badge.bg} ${badge.text} shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium whitespace-nowrap`}>{badge.label}</span>
                    {team > 0 && <span className="shrink-0 text-[11px] tabular-nums text-gray-400">{team}</span>}
                  </button>
                )
              })}
            </div>
          </>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center gap-2 border-b border-gray-200 bg-white px-4 py-2.5">
              <button
                onClick={() => setSelectedId(null)}
                className={`inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-600 shadow-sm hover:bg-gray-50 ${pressable}`}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Change staff
              </button>
              <span className="text-[11px] text-gray-400">Click a node to fold or unfold its team</span>
            </div>

            <div className="min-h-0 flex-1 bg-slate-50">
              {root && <HierarchyTree root={root} collapsed={collapsed} onToggle={toggleNode} />}
            </div>

            {teamSize === 0 && (
              <p className="border-t border-gray-200 bg-white px-4 py-2.5 text-center text-xs text-gray-400">
                No one reports to {selected.staff_name || "this staff member"}.
              </p>
            )}

            <HierarchyLegend />
          </div>
        )}
      </aside>
    </div>
  )
}

export default function StaffListPage() {
  const [page,          setPage]          = useState(1)
  const [search,        setSearch]        = useState("")
  const [searchInput,   setSearchInput]   = useState("")
  const [roleFilter,    setRoleFilter]    = useState("")
  const [emailFilter,   setEmailFilter]   = useState("")
  const [deleteConfirm, setDeleteConfirm] = useState<StaffData | null>(null)
  const [statusFilter,  setStatusFilter]  = useState<"" | StaffStatus>("")
  const [statusConfirm, setStatusConfirm] = useState<StaffData | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null)
  // Optimistic per-row status so a toggle shows immediately without refetching
  // the whole (client-paginated) staff list.
  const [statusOverrides, setStatusOverrides] = useState<Record<string, StaffStatus>>({})
  const [openMenu, setOpenMenu] = useState<FloatingMenuState>(null)
  const [role, setRole] = useState<AppRole>('admin')
  const [hierarchyOpen, setHierarchyOpen] = useState(false)

  const queryClient = useQueryClient()


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

  // The menu is positioned `fixed` from the button rect captured at open time,
  // so scrolling or resizing would leave it stranded away from its row.
  useEffect(() => {
    if (!openMenu) return
    const close = () => setOpenMenu(null)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [openMenu])

  const { data: response, isLoading, isError, refetch } = useQuery<StaffResponse>({
    queryKey: search ? ['stafflist', page, search] : ['stafflist', 'all'],
    queryFn: async () => {
      // If user is searching, use normal paginated endpoint.
      if (search) {
        const res = await axios.get(
          `${ADMIN_STAFF_URL}?page=${page}&limit=${ITEMS_PER_PAGE}&includeNsm=1&search=${encodeURIComponent(search)}`
        )
        return res.data
      }

      // No search -> fetch all pages from server and combine results so UI can display full list.
      const first = await axios.get(`${ADMIN_STAFF_URL}?page=1&limit=${ITEMS_PER_PAGE}&includeNsm=1&search=`, { withCredentials: true })
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
          requests.push(axios.get(`${ADMIN_STAFF_URL}?page=${p}&limit=${ITEMS_PER_PAGE}&includeNsm=1&search=`, { withCredentials: true }))
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

  const data: StaffData[] = useMemo(
    () => (response?.data || []).map((staff) => ({ ...staff, status: statusOverrides[nodeKey(staff)] ?? normalizeStaffStatus(staff.status) })),
    [response?.data, statusOverrides],
  )

  // Team = whoever reports to this row, derived from the full list the page
  // already fetched. RSMs report to the NSM (an admin profile with its own id
  // namespace), so they never contribute to a staff row's team.
  const directReports = useMemo(() => {
    const map = new Map<string, StaffData[]>()
    data.forEach((staff) => {
      const key = managerKey(staff)
      if (!key) return
      map.set(key, [...(map.get(key) ?? []), staff])
    })
    return map
  }, [data])

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
      if (statusFilter && normalizeStaffStatus(s.status) !== statusFilter) return false
      if (email && !String(s.staff_email ?? "").toLowerCase().includes(email)) return false
      return true
    })
  }, [data, roleFilter, statusFilter, emailFilter])

  const clientFiltered = !!(roleFilter || statusFilter || emailFilter.trim())

  const totalFromServer = response?.count ?? 0
  const total = clientFiltered ? roleFilteredData.length : (totalFromServer || data.length)
  const serverLastPage = response?.last_page ?? 0
  const totalPages = !clientFiltered && serverLastPage > 1 ? serverLastPage : Math.max(1, Math.ceil(total / ITEMS_PER_PAGE))

  // If server returns a full dataset (no server-side pagination), paginate on the client
  const serverPaging = !clientFiltered && serverLastPage > 1
  const displayedData: StaffData[] = serverPaging ? roleFilteredData : roleFilteredData.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE)

  // Reset to page 1 whenever a client-side filter changes so pagination stays in sync.
  useEffect(() => { setPage(1) }, [roleFilter, statusFilter, emailFilter])

  // Prefetch next page (only when searching / using server pagination)
  useEffect(() => {
    if (!search) return
    if (page >= totalPages) return
    queryClient.prefetchQuery({
      queryKey: ['stafflist', page + 1, search],
      queryFn: async () => {
        const res = await axios.get(
          `${ADMIN_STAFF_URL}?page=${page + 1}&limit=${ITEMS_PER_PAGE}&includeNsm=1&search=${encodeURIComponent(search)}`
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

  const handleDelete = async (staff: StaffData) => {
    setDeletingId(staff.staff_id)
    try {
      await axios.delete(`${ADMIN_STAFF_URL}/${encodeURIComponent(apiId(staff))}`, { withCredentials: true })
      showToast('success', "Staff member deleted")
      await refetch()
    } catch (error: any) {
      showToast('error', error?.response?.data?.message || "Failed to delete staff")
    } finally {
      setDeletingId(null)
      setDeleteConfirm(null)
    }
  }

  const updateStaffStatus = async (staff: StaffData, nextStatus: StaffStatus) => {
    setStatusUpdatingId(staff.staff_id)
    try {
      const res = await axios.patch(
        `${ADMIN_STAFF_URL}/${encodeURIComponent(apiId(staff))}/status`,
        { status: nextStatus },
        { withCredentials: true },
      )
      const applied = normalizeStaffStatus(res.data?.data?.status ?? nextStatus)
      setStatusOverrides((prev) => ({ ...prev, [nodeKey(staff)]: applied }))
      showToast('success', applied === "ACTIVE"
          ? `${staff.staff_name || "Staff member"} can now log in.`
          : `${staff.staff_name || "Staff member"} is deactivated and blocked from logging in.`)
    } catch (error: any) {
      showToast('error', error?.response?.data?.message || "Failed to update staff status")
    } finally {
      setStatusUpdatingId(null)
      setStatusConfirm(null)
    }
  }

  const handleDownloadCSV = () => {
    if (!roleFilteredData.length) return
    const headers = ["S.No.", "Name", "Email", "Role", "City", "State", "Gender", "Team", "Status", "Reports To"]
    const rows = roleFilteredData.map((s, i) => [
      i + 1,
      s.staff_name,
      s.staff_email,
      roleBadge(s).label,
      (s.assigned_cities ?? []).join(" | ") || s.staff_location || "-",
      (s.assigned_states ?? []).join(" | ") || "-",
      s.gender || "-",
      (directReports.get(nodeKey(s)) ?? []).map(r => `${r.staff_name} (${roleBadge(r).label})`).join(" | ") || "-",
      statusBadge(normalizeStaffStatus(s.status)).label,
      reportingManagerOf(s)?.name ?? "-",
    ])
    const csv = [headers, ...rows].map(r => r.map(csvCell).join(",")).join("\n")
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
        @keyframes staff-menu-in { from { opacity: 0; transform: translateY(-6px) scale(0.96); } to { opacity: 1; transform: translateY(0) scale(1); } }
        @keyframes staff-menu-in-up { from { opacity: 0; transform: translateY(6px) scale(0.96); } to { opacity: 1; transform: translateY(0) scale(1); } }
        @keyframes staff-menu-item-in { from { opacity: 0; transform: translateX(-6px); } to { opacity: 1; transform: translateX(0); } }
        .staff-toast { animation: staff-toast-in 220ms cubic-bezier(0.16, 1, 0.3, 1); }
        .staff-menu { animation: staff-menu-in 160ms cubic-bezier(0.16, 1, 0.3, 1); transform-origin: top right; }
        .staff-menu.flip { animation-name: staff-menu-in-up; transform-origin: bottom right; }
        /* Items fade in one after another so the list reads top-to-bottom
           instead of appearing as a single block. */
        .staff-menu > * { animation: staff-menu-item-in 180ms cubic-bezier(0.16, 1, 0.3, 1) backwards; }
        .staff-menu > *:nth-child(1) { animation-delay: 40ms; }
        .staff-menu > *:nth-child(2) { animation-delay: 70ms; }
        .staff-menu > *:nth-child(3) { animation-delay: 100ms; }
        .staff-menu > *:nth-child(4) { animation-delay: 130ms; }
        .staff-menu > *:nth-child(n+5) { animation-delay: 160ms; }
        @keyframes staff-node-in { from { opacity: 0; transform: translateX(8px); } to { opacity: 1; transform: translateX(0); } }
        .staff-node { animation: staff-node-in 300ms cubic-bezier(0.16, 1, 0.3, 1) both; }
        @keyframes staff-card-in { from { opacity: 0; transform: translateY(12px) scale(0.96); } to { opacity: 1; transform: none; } }
        @keyframes staff-edge-in { from { opacity: 0; } to { opacity: 1; } }
        .staff-card { animation: staff-card-in 380ms cubic-bezier(0.16, 1, 0.3, 1) both; }
        .staff-edge { animation: staff-edge-in 380ms ease both; }
        @media (prefers-reduced-motion: reduce) {
          .staff-toast, .staff-menu, .staff-menu > *, .staff-node, .staff-card, .staff-edge { animation: none; }
        }
      `}</style>

      {/* Toast */}

      {/* Delete Confirm Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center">
          <div className="bg-white rounded-xl shadow-xl p-6 w-80 border border-gray-200">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 rounded-full bg-red-50 flex items-center justify-center">
                <Trash2 className="w-4 h-4 text-red-500" />
              </div>
              <h3 className="font-semibold text-gray-900">Delete {isNsmRow(deleteConfirm) ? "NSM" : "Staff"}</h3>
            </div>
            <p className="text-sm text-gray-500 mb-5">
              This permanently removes {deleteConfirm.staff_name || "the staff member"} and their login from the database.
              {isNsmRow(deleteConfirm) ? " Any RSM reporting to this NSM must be reassigned first." : ""} This action cannot be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDeleteConfirm(null)}
                className={`px-4 py-2 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 ${pressable}`}
              >
                Cancel
              </button>
              <button
                onClick={() => void handleDelete(deleteConfirm)}
                disabled={deletingId === deleteConfirm.staff_id}
                className={`px-4 py-2 text-sm bg-red-500 text-white rounded-lg hover:bg-red-600 font-medium disabled:opacity-60 ${pressable}`}
              >
                {deletingId === deleteConfirm.staff_id ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Activate / Deactivate Confirm Modal */}
      {statusConfirm && (() => {
        const nextStatus: StaffStatus = normalizeStaffStatus(statusConfirm.status) === "ACTIVE" ? "INACTIVE" : "ACTIVE"
        const deactivating = nextStatus === "INACTIVE"
        return (
          <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center">
            <div className="bg-white rounded-xl shadow-xl p-6 w-96 border border-gray-200">
              <h3 className="font-semibold text-gray-900 mb-3">
                {deactivating ? "Deactivate Staff" : "Activate Staff"}
              </h3>
              <p className="text-sm text-gray-500 mb-5">
                {deactivating
                  ? `${statusConfirm.staff_name || "This staff member"} will be signed out and blocked from logging in until reactivated.`
                  : `${statusConfirm.staff_name || "This staff member"} will be able to log in again.`}
              </p>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setStatusConfirm(null)}
                  className={`px-4 py-2 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 ${pressable}`}
                >
                  Cancel
                </button>
                <button
                  onClick={() => void updateStaffStatus(statusConfirm, nextStatus)}
                  disabled={statusUpdatingId === statusConfirm.staff_id}
                  className={`px-4 py-2 text-sm rounded-lg text-white font-medium disabled:opacity-50 ${pressable} ${
                    deactivating ? "bg-red-500 hover:bg-red-600" : "bg-emerald-600 hover:bg-emerald-700"
                  }`}
                >
                  {statusUpdatingId === statusConfirm.staff_id ? "Saving..." : deactivating ? "Deactivate" : "Activate"}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      <HierarchyPanel open={hierarchyOpen} onClose={() => setHierarchyOpen(false)} data={data} reports={directReports} />

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
                onClick={() => setHierarchyOpen(true)}
                className={`flex items-center gap-2 px-4 py-2 text-sm bg-white border border-gray-200 rounded-lg text-gray-700 hover:bg-gray-50 shadow-sm ${pressable}`}
              >
                <Network className="w-4 h-4" />
                Hierarchy
              </button>
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
            {(roleFilter || statusFilter) && (
              <button
                type="button"
                onClick={() => { setRoleFilter(""); setStatusFilter("") }}
                className="text-xs text-gray-500 underline hover:text-gray-800"
              >
                Clear filters
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
                    <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-xs font-semibold text-gray-600 uppercase tracking-wide">City</div>
                  </th>

                  <th className="p-1.5 text-left">
                    <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-xs font-semibold text-gray-600 uppercase tracking-wide">State</div>
                  </th>

                  <th className="p-1.5 text-left">
                    <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-xs font-semibold text-gray-600 uppercase tracking-wide">Gender</div>
                  </th>

                  <th className="p-1.5 text-left">
                    <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-xs font-semibold text-gray-600 uppercase tracking-wide">Team</div>
                  </th>

                  <th className="p-1.5 text-left">
                    <div className="relative">
                      <select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value as "" | StaffStatus)}
                        className="w-full appearance-none rounded-lg border border-gray-200 bg-gray-50 pl-4 pr-8 py-2.5 text-xs font-semibold uppercase tracking-wide text-gray-600 outline-none transition cursor-pointer focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20"
                      >
                        <option value="">Status</option>
                        <option value="ACTIVE">Active</option>
                        <option value="INACTIVE">Inactive</option>
                        <option value="SUSPENDED">Suspended</option>
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                    </div>
                  </th>

                  <th className="p-1.5 text-left">
                    <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-xs font-semibold text-gray-600 uppercase tracking-wide">Reports To</div>
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
                    {Array.from({ length: 11 }).map((_, j) => (
                      <td key={j} className="px-4 py-4">
                        <div className={`${SHIMMER} h-4 w-full`} />
                      </td>
                    ))}
                  </tr>
                ))}

                {/* Empty */}
                {!isLoading && displayedData.length === 0 && (
                  <tr>
                    <td colSpan={11} className="px-6 py-16 text-center">
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
                    <tr key={nodeKey(staff)} className="hover:bg-gray-50 transition-colors">
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

                      <td className="px-4 py-4 text-gray-600 text-xs whitespace-nowrap" title={(staff.assigned_cities ?? []).join(", ")}>
                        {listSummary(staff.assigned_cities, staff.staff_location) || <span className="text-gray-300">-</span>}
                      </td>

                      <td className="px-4 py-4 text-gray-600 text-xs whitespace-nowrap" title={(staff.assigned_states ?? []).join(", ")}>
                        {listSummary(staff.assigned_states) || <span className="text-gray-300">-</span>}
                      </td>

                      <td className="px-4 py-4 text-gray-600 text-xs capitalize">{staff.gender || <span className="text-gray-300">-</span>}</td>

                      <td className="px-4 py-4">
                        {(() => {
                          const team = directReports.get(nodeKey(staff)) ?? []
                          if (!team.length) return <span className="text-gray-300 text-xs">-</span>
                          return (
                            <div className="flex flex-col gap-0.5" title={team.map(m => `${m.staff_name} (${roleBadge(m).label})`).join(", ")}>
                              {team.slice(0, 2).map(m => (
                                <span key={nodeKey(m)} className="text-gray-700 text-xs whitespace-nowrap">
                                  {m.staff_name} <span className="text-gray-400">· {roleBadge(m).label}</span>
                                </span>
                              ))}
                              {team.length > 2 && <span className="text-gray-400 text-[11px]">+{team.length - 2} more</span>}
                            </div>
                          )
                        })()}
                      </td>

                      <td className="px-4 py-4">
                        {(() => {
                          const badge = statusBadge(normalizeStaffStatus(staff.status))
                          return (
                            <span className={`${badge.bg} ${badge.text} text-xs font-medium px-2.5 py-1 rounded-full whitespace-nowrap`}>
                              {badge.label}
                            </span>
                          )
                        })()}
                      </td>

                      <td className="px-4 py-4">
                        {(() => {
                          const manager = reportingManagerOf(staff)
                          if (!manager) return <span className="text-gray-300 text-xs">-</span>
                          return (
                            <div className="flex flex-col">
                              <span className="text-gray-700 text-xs font-medium">{manager.name || "-"}</span>
                              {manager.email && <span className="text-gray-400 text-[11px]">{manager.email}</span>}
                            </div>
                          )
                        })()}
                      </td>

                      <td className="px-4 py-4">
                        <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                          <div className="relative">
                            <button
                              onClick={(e) => openFloatingMenu(e, nodeKey(staff), setOpenMenu)}
                              data-menu-id={nodeKey(staff)}
                              className={`p-2 rounded-md text-gray-600 hover:bg-gray-50 ${pressable}`}
                              aria-label="Open actions"
                            >
                              <MoreVertical className="w-4 h-4" />
                            </button>
                            {isMenuOpen(openMenu, nodeKey(staff)) && (
                              <div
                                ref={measureFloatingMenu(nodeKey(staff), setOpenMenu)}
                                onClick={(e) => e.stopPropagation()}
                                data-menu-id={nodeKey(staff)}
                                style={{ top: openMenu?.top ?? 0, left: openMenu?.left ?? 0 }}
                                className={`staff-menu${openMenu?.flip ? " flip" : ""} fixed w-44 bg-white border border-gray-200 rounded-md shadow-lg ring-1 ring-black/5 z-[9999] py-1 overflow-hidden`}
                              >
                                <Link href={getStaffEditRoute(apiId(staff))} className="block px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">Edit</Link>
                                <button onClick={(e) => { e.stopPropagation(); setStatusConfirm(staff); setOpenMenu(null) }} className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
                                  {normalizeStaffStatus(staff.status) === "ACTIVE" ? "Deactivate" : "Activate"}
                                </button>
                                <button onClick={(e) => { e.stopPropagation(); setDeleteConfirm(staff); setOpenMenu(null) }} className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50">Delete</button>
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