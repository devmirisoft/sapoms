'use client'
import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { CheckCircle2, Search, Trash2, Eye, EyeOff, MoreVertical, Pencil, Wallet, Power, PowerOff, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, ChevronsUpDown, X, UserPlus, Inbox } from 'lucide-react'
import { confirmAlert } from 'react-confirm-alert'
import { staffRoleBadge } from '@/lib/staffRoleLabel'
import { showToast } from "@/components/ui/toast";
import { type FloatingMenuState, isMenuOpen, openFloatingMenu, measureFloatingMenu } from "@/components/ui/floating-menu";
type DealerStatus = "active" | "inactive" | "suspended"
type DealerStatusFilter = "" | "ACTIVE" | "INACTIVE" | "SUSPENDED"
type WalletFilter = "" | "active" | "inactive"

function normalizeDealerStatus(value: unknown): DealerStatus {
  const normalized = String(value ?? "").trim().toLowerCase()
  if (normalized === "active") return "active"
  if (normalized === "suspended") return "suspended"
  return "inactive"
}

function toApiStatus(value: DealerStatus) {
  return value === "active" ? "ACTIVE" : value === "suspended" ? "SUSPENDED" : "INACTIVE"
}

function isActiveDealerStatus(value: unknown) {
  return normalizeDealerStatus(value) === "active"
}

function dealerStatusBadge(value: DealerStatus) {
  if (value === "active") return { label: "Active", bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500" }
  if (value === "suspended") return { label: "Suspended", bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-500" }
  return { label: "Inactive", bg: "bg-red-50", text: "text-red-700", dot: "bg-red-500" }
}
type AssignedStaff = {
  staffId: string
  name: string
  phone?: string
  roleLabel: string
  roleKey: string
  salesRegion?: string
  staffRoleType?: string
  role?: string
}

type Dealer = {
  Dealer_Id: string
  Dealer_Name: string
  Dealer_City: string
  Dealer_Email: string
  Dealer_Number: string
  Dealer_Address: string
  Dealer_Pincode: string
  Dealer_Username: string
  Dealer_Password?: string
  Dealer_Dealercode: string
  Dealer_Notes: string
  Dealer_Image: string
  status: string
  assignedstaff: string
  staffname: string
  assignedStaff?: AssignedStaff[]
  discount: string
  gst: string
  creditdays: string
  annualtarget: string
  currentlimit: string
  walletStatus?: string
}

type DealerResponse = {
  data: Dealer[]
  count?: number
  total?: number
  last_page?: number
}

type StaffOption = {
  id: string | number
  name?: string
  email?: string
  staff_name?: string
  staff_email?: string
}

type StaffListResponse = {
  data?: StaffOption[]
  count?: number
  total?: number
  last_page?: number
}

type DealerSummaryCounts = {
  total: number
  active: number
  inactive: number
  wallet: number
  nonWallet: number
}

type AppRole = "admin" | "staff" | "accountant"

const SHIMMER = "animate-pulse bg-gray-200 rounded"
const ADMIN_DEALERS_URL = "/api/admin/dealers"
const ADMIN_STAFF_URL = "/api/admin/staff"
const ITEMS_PER_PAGE = 20
const STAFF_OPTIONS_LIMIT = 100
const getDealerEditRoute = (dealerId: string) => `/dashboard/admin/dealer/${encodeURIComponent(dealerId)}`
const getDealerViewRoute = (dealerId: string) => `${getDealerEditRoute(dealerId)}/view`
const getStaffDealerRoute = (dealerId: string) => `/dashboard/staff/dealer/${encodeURIComponent(dealerId)}`

// Shared feedback classes: press-down responds instantly (Apple's "respond
// on pointer-down, not release"), and prefers-reduced-motion drops the
// transform/transition entirely rather than losing the feedback outright.
const pressable = 'transition-transform duration-100 active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100'

function statusBadge(s: string) {
  return dealerStatusBadge(normalizeDealerStatus(s))
}

function getDealerResponseTotal(response: { total?: number; count?: number } | undefined, fallback: number) {
  return Number(response?.total ?? response?.count ?? fallback) || fallback
}

function getStaffDisplayName(staff: StaffOption): string {
  const id = String(staff.id).trim()
  const name = String(staff.name ?? staff.staff_name ?? "").trim() || (id ? `Staff #${id}` : "Staff")
  const email = String(staff.email ?? staff.staff_email ?? "").trim()
  return email ? `${name} (${email})` : name
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" })
  const text = await res.text()
  const preview = text.replace(/\s+/g, " ").trim().slice(0, 180)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  if (/^\s*</.test(text)) throw new Error("Expected JSON but received HTML")
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(preview ? "Invalid JSON response" : "Empty response")
  }
}

async function fetchAllStaffOptions(): Promise<StaffOption[]> {
  const staffUrl = (pageNumber: number) => `${ADMIN_STAFF_URL}?page=${pageNumber}&limit=${STAFF_OPTIONS_LIMIT}&search=`
  const firstPage = await fetchJson<StaffListResponse>(staffUrl(1))
  const staffById = new Map<string, StaffOption>()
  const addStaff = (staff: StaffOption) => {
    const id = String(staff.id ?? "").trim()
    if (!id || staffById.has(id)) return
    staffById.set(id, { ...staff, id })
  }

  (firstPage.data ?? []).forEach(addStaff)

  const totalStaffCount = getDealerResponseTotal(firstPage, staffById.size)
  const detectedPageSize = Math.max(1, firstPage.data?.length || STAFF_OPTIONS_LIMIT)
  const lastPage = Math.max(1, Number(firstPage.last_page) || Math.ceil(totalStaffCount / detectedPageSize))

  if (lastPage > 1) {
    const remainingPages = await Promise.all(
      Array.from({ length: lastPage - 1 }, (_, index) => fetchJson<StaffListResponse>(staffUrl(index + 2)))
    )

    remainingPages.forEach((pageResponse) => {
      (pageResponse.data ?? []).forEach(addStaff)
    })
  }

  let nextPage = lastPage + 1
  while (staffById.size < totalStaffCount) {
    const nextResponse = await fetchJson<StaffListResponse>(staffUrl(nextPage))
    const pageStaff = nextResponse.data ?? []
    if (pageStaff.length === 0) break

    pageStaff.forEach(addStaff)
    nextPage += 1
  }

  return Array.from(staffById.values()).sort((left, right) => getStaffDisplayName(left).localeCompare(getStaffDisplayName(right), undefined, { sensitivity: "base" }))
}
async function fetchAllDealerCities(): Promise<string[]> {
  const dealerUrl = (pageNumber: number) => `${ADMIN_DEALERS_URL}?page=${pageNumber}&limit=100&search=`

  const firstPage = await fetchJson<DealerResponse>(dealerUrl(1))
  const cities = new Set<string>()
  const addCities = (rows: Dealer[]) => {
    rows.forEach((dealer) => {
      const city = String(dealer.Dealer_City ?? "").trim()
      if (city) cities.add(city)
    })
  }
  addCities(firstPage.data ?? [])

  const totalDealerCount = getDealerResponseTotal(firstPage, firstPage.data?.length ?? 0)
  const detectedPageSize = Math.max(1, firstPage.data?.length || ITEMS_PER_PAGE)
  const lastPage = Math.max(1, Number(firstPage.last_page) || Math.ceil(totalDealerCount / detectedPageSize))

  if (lastPage > 1) {
    const remainingPages = await Promise.all(
      Array.from({ length: lastPage - 1 }, (_, index) => fetchJson<DealerResponse>(dealerUrl(index + 2)))
    )
    remainingPages.forEach((pageResponse) => addCities(pageResponse.data ?? []))
  }

  return Array.from(cities).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
}

// Pages through every dealer once to produce accurate active/inactive and
// wallet/non-wallet totals for the summary tiles — the main table query only
// ever holds one filtered page, so these can't be derived from it.
async function fetchDealerSummaryCounts(): Promise<DealerSummaryCounts> {
  const dealerUrl = (pageNumber: number) => `${ADMIN_DEALERS_URL}?page=${pageNumber}&limit=100&search=`

  let active = 0
  let wallet = 0
  let counted = 0
  const countRows = (rows: Dealer[]) => {
    rows.forEach((dealer) => {
      counted += 1
      if (isActiveDealerStatus(dealer.status)) active += 1
      if (String(dealer.walletStatus ?? "").toLowerCase() === "active") wallet += 1
    })
  }

  const firstPage = await fetchJson<DealerResponse>(dealerUrl(1))
  countRows(firstPage.data ?? [])

  const totalDealerCount = getDealerResponseTotal(firstPage, firstPage.data?.length ?? 0)
  const detectedPageSize = Math.max(1, firstPage.data?.length || ITEMS_PER_PAGE)
  const lastPage = Math.max(1, Number(firstPage.last_page) || Math.ceil(totalDealerCount / detectedPageSize))

  if (lastPage > 1) {
    const remainingPages = await Promise.all(
      Array.from({ length: lastPage - 1 }, (_, index) => fetchJson<DealerResponse>(dealerUrl(index + 2)))
    )
    remainingPages.forEach((pageResponse) => countRows(pageResponse.data ?? []))
  }

  const total = Math.max(totalDealerCount, counted)
  return {
    total,
    active,
    inactive: Math.max(0, total - active),
    wallet,
    nonWallet: Math.max(0, total - wallet),
  }
}

function getRole(): AppRole {
  if (typeof window === "undefined") return "admin"
  if (localStorage.getItem("accountant_token")) return "accountant"
  const rt = localStorage.getItem("roletype")
  if (rt === "1") return "staff"
  return "admin"
}

function getStaffId(): string {
  if (typeof window === "undefined") return ""

  for (const key of ["staffData", "UserData"]) {
    try {
      const raw = localStorage.getItem(key)
      if (!raw) continue
      const value = JSON.parse(raw) as { staff_id?: unknown }
      const staffId = String(value.staff_id ?? "").trim()
      if (staffId) return staffId
    } catch {
      // Try the next legacy session key.
    }
  }

  return ""
}

export default function DealerListPage() {
  const [role] = useState<AppRole>(() => getRole())
  const [staffId] = useState(() => getStaffId())
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState("")
  const [searchInput, setSearchInput] = useState("")
  const [selectedStaffId, setSelectedStaffId] = useState("")
  const [statusFilter, setStatusFilter] = useState<DealerStatusFilter>("")
  const [walletFilter, setWalletFilter] = useState<WalletFilter>("")
  const [cityFilter, setCityFilter] = useState("")
  const [nameSearchInput, setNameSearchInput] = useState("")
  const [nameSearch, setNameSearch] = useState("")
  const [emailSearchInput, setEmailSearchInput] = useState("")
  const [emailSearch, setEmailSearch] = useState("")
  const [phoneSearchInput, setPhoneSearchInput] = useState("")
  const [phoneSearch, setPhoneSearch] = useState("")
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [visiblePasswords, setVisiblePasswords] = useState<Set<string>>(() => new Set())
  const [openMenu, setOpenMenu] = useState<FloatingMenuState>(null)
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null)
  const [bulkActivating, setBulkActivating] = useState(false)
  const [statusOverrides, setStatusOverrides] = useState<Record<string, DealerStatus>>({})
  const [nameSort, setNameSort] = useState<"" | "asc" | "desc">("")

  const queryClient = useQueryClient()


  useEffect(() => {
    const handleDocClick = (e: MouseEvent) => {
      const path = typeof e.composedPath === "function" ? e.composedPath() : []
      if (Array.isArray(path) && path.some((el) => el instanceof HTMLElement && el.dataset.menuId)) return
      let node: Node | null = e.target instanceof Node ? e.target : null
      while (node) {
        if (node instanceof HTMLElement && node.dataset.menuId) return
        node = node.parentNode
      }
      setOpenMenu(null)
    }
    document.addEventListener('click', handleDocClick)
    return () => document.removeEventListener('click', handleDocClick)
  }, [])

  const { data: staffOptions = [], isLoading: staffOptionsLoading } = useQuery<StaffOption[]>({
    queryKey: ["adminDealerStaffOptions"],
    queryFn: fetchAllStaffOptions,
    enabled: role !== "staff",
    staleTime: 10 * 60 * 1000,
  })

  const { data: cityOptions = [], isLoading: cityOptionsLoading } = useQuery<string[]>({
    queryKey: ["adminDealerCityOptions"],
    queryFn: fetchAllDealerCities,
    staleTime: 10 * 60 * 1000,
  })

  const { data: summaryCounts, isLoading: summaryCountsLoading } = useQuery<DealerSummaryCounts>({
    queryKey: ["adminDealerSummaryCounts"],
    queryFn: fetchDealerSummaryCounts,
    staleTime: 5 * 60 * 1000,
  })

  const { data: response, isLoading, isError, refetch } = useQuery<DealerResponse>({
    queryKey: ["dealers", role, staffId, page, search, selectedStaffId, statusFilter, walletFilter, cityFilter, nameSearch, emailSearch, phoneSearch],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(ITEMS_PER_PAGE),
        search,
      })

      if (selectedStaffId) params.set("staffId", selectedStaffId)
      if (statusFilter) params.set("status", statusFilter)
      if (walletFilter) params.set("wallet", walletFilter)
      if (cityFilter) params.set("city", cityFilter)
      if (nameSearch) params.set("name", nameSearch)
      if (emailSearch) params.set("email", emailSearch)
      if (phoneSearch) params.set("phone", phoneSearch)

      return fetchJson<DealerResponse>(`${ADMIN_DEALERS_URL}?${params.toString()}`)
    },
    enabled: role !== "staff" || Boolean(staffId),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000,
  })

  const data: Dealer[] = useMemo(() => {
    const merged = (response?.data || []).map((dealer) => ({
      ...dealer,
      status: statusOverrides[String(dealer.Dealer_Id)] ?? normalizeDealerStatus(dealer.status),
    }))

    const filtered = role !== "staff" ? merged : (() => {
      const normalizedSearch = search.trim().toLowerCase()
      return merged
        .filter((dealer) => isActiveDealerStatus(dealer.status))
        .filter((dealer) => !normalizedSearch || [
          dealer.Dealer_Name,
          dealer.Dealer_Dealercode,
          dealer.Dealer_City,
          dealer.Dealer_Email,
          dealer.Dealer_Number,
        ].some((value) => String(value ?? "").toLowerCase().includes(normalizedSearch)))
    })()

    if (!nameSort) return filtered
    const sorted = [...filtered].sort((a, b) => (a.Dealer_Name || "").localeCompare(b.Dealer_Name || "", undefined, { sensitivity: "base" }))
    return nameSort === "asc" ? sorted : sorted.reverse()
  }, [response?.data, role, search, statusOverrides, nameSort])

  const total =
    role === "staff"
      ? data.length
      : response
        ? getDealerResponseTotal(response, (page - 1) * ITEMS_PER_PAGE + data.length)
        : (page - 1) * ITEMS_PER_PAGE + data.length

  const totalPages = role === "staff"
    ? 1
    : Number(response?.last_page) ||
    Math.ceil(total / ITEMS_PER_PAGE) ||
    (data.length < ITEMS_PER_PAGE ? page : page + 1)

  // Prefetch next page
  useEffect(() => {
    if (role === "staff") return
    queryClient.prefetchQuery({
      queryKey: ["dealers", role, staffId, page + 1, search, selectedStaffId, statusFilter, walletFilter, cityFilter, nameSearch, emailSearch, phoneSearch],
      queryFn: async () => {
        const params = new URLSearchParams({
          page: String(page + 1),
          limit: String(ITEMS_PER_PAGE),
          search,
        })

        if (selectedStaffId) params.set("staffId", selectedStaffId)
        if (statusFilter) params.set("status", statusFilter)
        if (walletFilter) params.set("wallet", walletFilter)
        if (cityFilter) params.set("city", cityFilter)
        if (nameSearch) params.set("name", nameSearch)
        if (emailSearch) params.set("email", emailSearch)
        if (phoneSearch) params.set("phone", phoneSearch)

        return fetchJson<DealerResponse>(`${ADMIN_DEALERS_URL}?${params.toString()}`)
      },
    })
  }, [page, queryClient, role, search, selectedStaffId, staffId, statusFilter, walletFilter, cityFilter, nameSearch, emailSearch, phoneSearch])

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => { setPage(1); setSearch(searchInput) }, 400)
    return () => clearTimeout(timer)
  }, [searchInput])

  // Debounced per-column searches (Dealer name, Email, Phone)
  useEffect(() => {
    const timer = setTimeout(() => { setPage(1); setNameSearch(nameSearchInput) }, 400)
    return () => clearTimeout(timer)
  }, [nameSearchInput])

  useEffect(() => {
    const timer = setTimeout(() => { setPage(1); setEmailSearch(emailSearchInput) }, 400)
    return () => clearTimeout(timer)
  }, [emailSearchInput])

  useEffect(() => {
    const timer = setTimeout(() => { setPage(1); setPhoneSearch(phoneSearchInput) }, 400)
    return () => clearTimeout(timer)
  }, [phoneSearchInput])

  const handleDelete = async (id: string) => {
    try {
      const response = await fetch(`${ADMIN_DEALERS_URL}/${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "include",
      })
      const payload = await response.json()
      if (!response.ok || !payload.success) throw new Error(payload.message ?? "Failed to delete dealer")
      showToast('success', "Dealer deleted successfully")
      setOpenMenu(null)
      void refetch()
      void queryClient.invalidateQueries({ queryKey: ["adminDealerSummaryCounts"] })
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : "Failed to delete dealer")
    } finally {
      setDeleteConfirm(null)
    }
  }

  const fetchAllDealerIds = async () => {
    const dealerUrl = (pageNumber: number) => `${ADMIN_DEALERS_URL}?page=${pageNumber}&limit=100&search=`

    const firstPage = await fetchJson<DealerResponse>(dealerUrl(1))
    const dealerIds = new Set(
      (firstPage.data ?? []).map((dealer) => String(dealer.Dealer_Id ?? "").trim()).filter(Boolean)
    )
    const totalDealerCount = getDealerResponseTotal(firstPage, dealerIds.size)
    const detectedPageSize = Math.max(1, firstPage.data?.length || ITEMS_PER_PAGE)
    const lastPage = Math.max(1, Number(firstPage.last_page) || Math.ceil(totalDealerCount / detectedPageSize))

    if (lastPage > 1) {
      const remainingPages = await Promise.all(
        Array.from({ length: lastPage - 1 }, (_, index) => fetchJson<DealerResponse>(dealerUrl(index + 2)))
      )

      remainingPages.forEach((pageResponse) => {
        const pageDealers = pageResponse.data ?? []
        pageDealers.forEach((dealer) => {
          const dealerId = String(dealer.Dealer_Id ?? "").trim()
          if (dealerId) dealerIds.add(dealerId)
        })
      })
    }

    let nextPage = lastPage + 1
    while (dealerIds.size < totalDealerCount) {
      const nextResponse = await fetchJson<DealerResponse>(dealerUrl(nextPage))
      const pageDealers = nextResponse.data ?? []
      if (pageDealers.length === 0) break

      pageDealers.forEach((dealer) => {
        const dealerId = String(dealer.Dealer_Id ?? "").trim()
        if (dealerId) dealerIds.add(dealerId)
      })

      nextPage += 1
    }

    return Array.from(dealerIds)
  }

  const activateAllDealers = async () => {
    setBulkActivating(true)
    try {
      const dealerIds = await fetchAllDealerIds()

      if (dealerIds.length === 0) {
        showToast("error", "No dealers found to activate.")
        return
      }

      await Promise.all(dealerIds.map((dealerId) => fetch(`${ADMIN_DEALERS_URL}/${encodeURIComponent(dealerId)}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status: "ACTIVE" }),
      }).then(async (response) => {
        const payload = await response.json()
        if (!response.ok || !payload.success) throw new Error(payload.message ?? "Failed to activate all dealers")
      })))

      setStatusOverrides((prev) => {
        const next = { ...prev }
        dealerIds.forEach((dealerId) => {
          next[dealerId] = "active"
        })
        return next
      })

      showToast("success", `Activated ${dealerIds.length} dealers successfully.`)
      void refetch()
      void queryClient.invalidateQueries({ queryKey: ["adminDealerSummaryCounts"] })
    } catch (error) {
      console.error("Failed to activate all dealers", error)
      showToast("error", error instanceof Error ? error.message : "Failed to activate all dealers")
    } finally {
      setBulkActivating(false)
    }
  }

  const confirmActivateAllDealers = () => {
    confirmAlert({
      customUI: ({ onClose }) => (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 shadow-xl">
            <div className="mb-3 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              </div>
              {/* <div>
                <h3 className="text-base font-semibold text-gray-900">Activate All Dealers</h3>
                <p className="text-sm text-gray-500">This will update every dealer account.</p>
              </div> */}
            </div>

            <p className="text-sm leading-6 text-gray-600">
              All dealers will be marked active and able to pass the dealer status check.
            </p>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className={`rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 ${pressable}`}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  onClose()
                  void activateAllDealers()
                }}
                className={`rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 ${pressable}`}
              >
                Activate all
              </button>
            </div>
          </div>
        </div>
      ),
    })
  }

  const updateDealerStatus = async (dealerId: string, nextStatus: DealerStatus) => {
    const normalizedDealerId = String(dealerId)
    setStatusUpdatingId(normalizedDealerId)
    try {
      const response = await fetch(`${ADMIN_DEALERS_URL}/${encodeURIComponent(normalizedDealerId)}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status: toApiStatus(nextStatus) }),
      })
      const payload = await response.json()
      if (!response.ok || !payload.success) throw new Error(payload.message ?? "Failed to update dealer status")
      const normalizedStatus = normalizeDealerStatus(payload.data?.status ?? nextStatus)

      setStatusOverrides((prev) => ({
        ...prev,
        [normalizedDealerId]: normalizedStatus,
      }))

      showToast('success', normalizedStatus === "active"
          ? "Dealer activated successfully."
          : "Dealer deactivated successfully.")
      setOpenMenu(null)
      void queryClient.invalidateQueries({ queryKey: ["adminDealerSummaryCounts"] })
    } catch (error) {
      console.error("Failed to update dealer status", error)
      showToast('error', error instanceof Error ? error.message : "Failed to update dealer status")
    } finally {
      setStatusUpdatingId(null)
    }
  }

  const confirmDealerStatusChange = (dealer: Dealer) => {
    const dealerId = String(dealer.Dealer_Id)
    const currentStatus = normalizeDealerStatus(dealer.status)
    const nextStatus: DealerStatus = currentStatus === "active" ? "inactive" : "active"
    const isDeactivating = nextStatus === "inactive"
    const dealerName = dealer.Dealer_Name || `Dealer ${dealerId}`

    confirmAlert({
      customUI: ({ onClose }) => (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 shadow-xl">
            <div className={`mb-3 flex items-center gap-3`}>
              <div className={`flex h-10 w-10 items-center justify-center rounded-full ${isDeactivating ? "bg-red-50" : "bg-emerald-50"}`}>
                <span className={`text-sm font-semibold ${isDeactivating ? "text-red-600" : "text-emerald-600"}`}>
                  {isDeactivating ? "!" : "?"}
                </span>
              </div>
              <div>
                <h3 className="text-base font-semibold text-gray-900">
                  {isDeactivating ? "Deactivate Dealer" : "Activate Dealer"}
                </h3>
                <p className="text-sm text-gray-500">{dealerName}</p>
              </div>
            </div>

            <p className="text-sm leading-6 text-gray-600">
              {isDeactivating
                ? "This dealer will no longer be able to access the dealer application until the account is activated again."
                : "This dealer will be able to access the dealer application again after activation."}
            </p>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className={`rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 ${pressable}`}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  onClose()
                  void updateDealerStatus(dealerId, nextStatus)
                }}
                className={`rounded-lg px-4 py-2 text-sm font-medium text-white ${pressable} ${isDeactivating ? "bg-red-500 hover:bg-red-600" : "bg-emerald-600 hover:bg-emerald-700"
                  }`}
              >
                {isDeactivating ? "Deactivate" : "Activate"}
              </button>
            </div>
          </div>
        </div>
      ),
    })
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

  const togglePassword = (dealerId: string) => {
    setVisiblePasswords(prev => {
      const next = new Set(prev)
      if (next.has(dealerId)) next.delete(dealerId)
      else next.add(dealerId)
      return next
    })
  }

  const canManageDealers = role === "admin" || role === "staff"
  const canViewDealerPasswords = role === "admin"
  const showStaffColumn = role !== "staff"
  const tableColumnCount = 8 + (canViewDealerPasswords ? 1 : 0) + (showStaffColumn ? 1 : 0)
  const startIndex = role === "staff" ? 1 : (page - 1) * ITEMS_PER_PAGE + 1
  const endIndex = role === "staff" ? data.length : Math.min(page * ITEMS_PER_PAGE, total)
  const activeFilterCount = [selectedStaffId, statusFilter, walletFilter, cityFilter, nameSearch, emailSearch, phoneSearch].filter(Boolean).length

  // Summary tiles double as filter buttons: clicking one sets the matching
  // status/wallet filter, clicking the active one again clears it.
  type SummaryTile = {
    key: string
    label: string
    value: number | undefined
    dot: string
    ring: string
    icon: typeof Power
    type: "status" | "wallet"
    filterValue: DealerStatusFilter | WalletFilter
  }

  const summaryTiles: SummaryTile[] = [
    { key: "active", label: "Active Dealers", value: summaryCounts?.active, dot: "bg-emerald-500", ring: "ring-emerald-500 border-emerald-200 bg-emerald-50/60", icon: Power, type: "status", filterValue: "ACTIVE" },
    { key: "inactive", label: "Inactive Dealers", value: summaryCounts?.inactive, dot: "bg-red-400", ring: "ring-red-500 border-red-200 bg-red-50/60", icon: PowerOff, type: "status", filterValue: "INACTIVE" },
    { key: "wallet", label: "Advance dealers", value: summaryCounts?.wallet, dot: "bg-sky-500", ring: "ring-sky-500 border-sky-200 bg-sky-50/60", icon: Wallet, type: "wallet", filterValue: "active" },
    { key: "nonWallet", label: "Credit dealers", value: summaryCounts?.nonWallet, dot: "bg-gray-400", ring: "ring-gray-400 border-gray-300 bg-gray-50", icon: Wallet, type: "wallet", filterValue: "inactive" },
  ]

  const isSummaryTileActive = (tile: SummaryTile) =>
    tile.type === "status" ? statusFilter === tile.filterValue : walletFilter === tile.filterValue

  const handleSummaryTileClick = (tile: SummaryTile) => {
    setPage(1)
    if (tile.type === "status") {
      setStatusFilter((prev) => (prev === tile.filterValue ? "" : (tile.filterValue as DealerStatusFilter)))
    } else {
      setWalletFilter((prev) => (prev === tile.filterValue ? "" : (tile.filterValue as WalletFilter)))
    }
  }

  return (
    <div className="min-h-screen bg-white">
      <style>{`
        @keyframes dealer-toast-in { from { opacity: 0; transform: translateY(-8px) scale(0.97); } to { opacity: 1; transform: translateY(0) scale(1); } }
        @keyframes dealer-menu-in { from { opacity: 0; transform: translateY(-6px) scale(0.96); } to { opacity: 1; transform: translateY(0) scale(1); } }
        @keyframes dealer-menu-in-up { from { opacity: 0; transform: translateY(6px) scale(0.96); } to { opacity: 1; transform: translateY(0) scale(1); } }
        @keyframes dealer-menu-item-in { from { opacity: 0; transform: translateX(-6px); } to { opacity: 1; transform: translateX(0); } }
        .dealer-toast { animation: dealer-toast-in 220ms cubic-bezier(0.16, 1, 0.3, 1); }
        .dealer-menu { animation: dealer-menu-in 160ms cubic-bezier(0.16, 1, 0.3, 1); transform-origin: top right; }
        .dealer-menu.flip { animation-name: dealer-menu-in-up; transform-origin: bottom right; }
        /* Items fade in one after another so the list reads top-to-bottom
           instead of appearing as a single block. */
        .dealer-menu > * { animation: dealer-menu-item-in 180ms cubic-bezier(0.16, 1, 0.3, 1) backwards; }
        .dealer-menu > *:nth-child(1) { animation-delay: 40ms; }
        .dealer-menu > *:nth-child(2) { animation-delay: 70ms; }
        .dealer-menu > *:nth-child(3) { animation-delay: 100ms; }
        .dealer-menu > *:nth-child(4) { animation-delay: 130ms; }
        .dealer-menu > *:nth-child(n+5) { animation-delay: 160ms; }
        @media (prefers-reduced-motion: reduce) {
          .dealer-toast, .dealer-menu, .dealer-menu > * { animation: none; }
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
              <h3 className="font-semibold text-gray-900">Delete Dealer</h3>
            </div>
            <p className="text-sm text-gray-500 mb-5">
              Are you sure you want to delete this dealer? This action cannot be undone.
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

        {/* Header: title + primary actions together */}
        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Dealer List</h1>
            <p className="text-sm text-gray-500 mt-1">
              {role === "staff" ? "View your active assigned dealers" : "Manage all registered dealers"}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {/* {canManageDealers && (
              <button
                type="button"
                onClick={confirmActivateAllDealers}
                disabled={bulkActivating}
                className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <CheckCircle2 className="h-4 w-4" />
                {bulkActivating ? "Activating..." : "Activate all dealers"}
              </button>
            )} */}
            <Link
              href={role === "staff" ? "/dashboard/staff/dealer-requests" : "/dashboard/admin/dealer/requests"}
              className={`inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 ${pressable}`}
            >
              <Inbox className="h-4 w-4" />
              Dealer Requests
            </Link>
            <button
              className={`inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 ${pressable}`}
              onClick={() => window.location.href = "/dashboard/admin/dealer/AddDealerForm"}
            >
              <UserPlus className="h-4 w-4" />
              Add dealer
            </button>
          </div>
        </div>

        {/* Summary tiles: active/inactive + wallet/non-wallet counts, also usable as one-click filters */}
        {role !== "staff" && (
          <div className="mb-5 flex flex-wrap gap-2">
            {summaryTiles.map((tile) => {
              const active = isSummaryTileActive(tile)
              return (
                <button
                  key={tile.key}
                  type="button"
                  onClick={() => handleSummaryTileClick(tile)}
                  aria-pressed={active}
                  className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-left transition-all duration-150 ease-out ${pressable} ${active
                      ? `ring-1 ${tile.ring}`
                      : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50"
                    }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${tile.dot}`} />
                  <span className="text-xs font-medium text-gray-500">{tile.label}</span>
                  <span className="text-sm font-bold text-gray-900">
                    {summaryCountsLoading ? "—" : (tile.value ?? 0).toLocaleString("en-IN")}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {/* Search only here — every column filter now lives inline in the table header below */}
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          {/* <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search dealers..."
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              className="pl-10 pr-9 py-2.5 border border-gray-200 rounded-lg text-sm bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition w-full"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => setSearchInput("")}
                className={`absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 ${pressable}`}
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div> */}

          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={() => {
                setPage(1)
                setSelectedStaffId("")
                setStatusFilter("")
                setWalletFilter("")
                setCityFilter("")
                setNameSearchInput("")
                setNameSearch("")
                setEmailSearchInput("")
                setEmailSearch("")
                setPhoneSearchInput("")
                setPhoneSearch("")
              }}
              className={`inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 ${pressable}`}
            >
              <X className="h-3.5 w-3.5" />
              Clear filters
            </button>
          )}
          <div className="flex my-auto mx-3 ">


             <button
              type="button"
              onClick={() => setNameSort((prev) => prev === "asc" ? "desc" : prev === "desc" ? "" : "asc")}
              className={`rounded-md  text-gray-400 hover:bg-gray-200 hover:text-gray-600 ${pressable} ${nameSort ? "text-indigo-600" : ""}`}
              aria-label={nameSort === "asc" ? "Sorted A to Z, click to sort Z to A" : nameSort === "desc" ? "Sorted Z to A, click to clear sort" : "Sort by dealer name"}
              title={nameSort === "asc" ? "A → Z" : nameSort === "desc" ? "Z → A" : "Sort alphabetically"}
            >
              <div className="flex p-2 items-center gap-1">
                <p className="text-sm text-gray-600">{nameSort === "asc" ? "A → Z" : nameSort === "desc" ? "Z → A" : "Sort alphabetically"}</p>
                {nameSort === "asc" ? <ChevronUp className="h-3.5 w-3.5" /> : nameSort === "desc" ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronsUpDown className="h-3.5 w-3.5" />}
              </div>
             </button>
          </div>
        </div>

        {isError && (
          <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
            Failed to load dealers. Please try again.
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
                        value={nameSearchInput}
                        onChange={(event) => setNameSearchInput(event.target.value)}
                        placeholder="Dealer"
                        className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2.5 pl-4 pr-16 text-xs font-semibold uppercase tracking-wide text-gray-600 placeholder:text-gray-600 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20"
                      />
                      <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
                        {nameSearchInput && (
                          <button
                            type="button"
                            onClick={() => setNameSearchInput("")}
                            className={`rounded-md p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-600 ${pressable}`}
                            aria-label="Clear dealer name search"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}

                      </div>
                    </div>
                  </th>
                  <th className="p-1.5 text-left">
                    <div className="relative">
                      <select
                        value={cityFilter}
                        onChange={(event) => {
                          setPage(1)
                          setCityFilter(event.target.value)
                        }}
                        disabled={cityOptionsLoading}
                        className="w-full appearance-none rounded-lg border border-gray-200 bg-gray-50 pl-4 pr-8 py-2.5 text-xs font-semibold uppercase tracking-wide text-gray-600 outline-none transition cursor-pointer focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <option value="">City</option>
                        {cityOptions.map((city) => (
                          <option key={city} value={city}>{city}</option>
                        ))}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                    </div>
                  </th>
                  <th className="p-1.5 text-left">
                    <div className="relative">
                      <input
                        type="text"
                        value={emailSearchInput}
                        onChange={(event) => setEmailSearchInput(event.target.value)}
                        placeholder="Email"
                        className="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-gray-600 placeholder:text-gray-600 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20"
                      />
                      {emailSearchInput && (
                        <button
                          type="button"
                          onClick={() => setEmailSearchInput("")}
                          className={`absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-600 ${pressable}`}
                          aria-label="Clear email search"
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
                        value={phoneSearchInput}
                        onChange={(event) => setPhoneSearchInput(event.target.value)}
                        placeholder="Phone"
                        className="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-gray-600 placeholder:text-gray-600 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20"
                      />
                      {phoneSearchInput && (
                        <button
                          type="button"
                          onClick={() => setPhoneSearchInput("")}
                          className={`absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-600 ${pressable}`}
                          aria-label="Clear phone search"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </th>
                  {canViewDealerPasswords && (
                    <th className="p-1.5 text-left">
                      <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-xs font-semibold text-gray-600 uppercase tracking-wide">Password</div>
                    </th>
                  )}
                  {showStaffColumn && (
                    <th className="p-1.5 text-left">
                      <div className="relative">
                        <select
                          aria-label="Staff filter"
                          value={selectedStaffId}
                          onChange={(event) => {
                            setPage(1)
                            setSelectedStaffId(event.target.value)
                          }}
                          disabled={staffOptionsLoading}
                          className="w-full appearance-none rounded-lg border border-gray-200 bg-gray-50 pl-4 pr-8 py-2.5 text-xs font-semibold uppercase tracking-wide text-gray-600 outline-none transition cursor-pointer focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <option value="">Staff</option>
                          {staffOptions.map((staff) => {
                            const staffOptionId = String(staff.id)
                            return (
                              <option key={staffOptionId} value={staffOptionId}>
                                {getStaffDisplayName(staff)}
                              </option>
                            )
                          })}
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                      </div>
                    </th>
                  )}
                  <th className="p-1.5 text-left">
                    <div className="relative">
                      <select
                        value={walletFilter}
                        onChange={(event) => {
                          setPage(1)
                          setWalletFilter(event.target.value as WalletFilter)
                        }}
                        className="w-full appearance-none rounded-lg border border-gray-200 bg-gray-50 pl-4 pr-8 py-2.5 text-xs font-semibold uppercase tracking-wide text-gray-600 outline-none transition cursor-pointer focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20"
                      >
                        <option value="">Payment type</option>
                        <option value="active">Advance dealers</option>
                        <option value="inactive">Credit dealers</option>
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                    </div>
                  </th>
                  <th className="p-1.5 text-left">
                    <div className="relative">
                      <select
                        value={statusFilter}
                        onChange={(event) => {
                          setPage(1)
                          setStatusFilter(event.target.value as DealerStatusFilter)
                        }}
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
                  <th className="p-1.5 text-right">
                    <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-xs font-semibold text-gray-600 uppercase tracking-wide">Actions</div>
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-gray-100">
                {/* Shimmer */}
                {isLoading && Array.from({ length: ITEMS_PER_PAGE }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: tableColumnCount }).map((_, j) => (
                      <td key={j} className="px-4 py-4">
                        <div className={`${SHIMMER} h-4 w-full`} />
                      </td>
                    ))}
                  </tr>
                ))}

                {/* Empty */}
                {!isLoading && data.length === 0 && (
                  <tr>
                    <td colSpan={tableColumnCount} className="px-6 py-12 text-center text-gray-400 text-sm">
                      No dealers found
                    </td>
                  </tr>
                )}

                {/* Rows */}
                {!isLoading && data.map((dealer, i) => {
                  const badge = statusBadge(dealer.status)
                  const walletActive = String(dealer.walletStatus ?? "").toLowerCase() === "active"
                  const passwordVisible = visiblePasswords.has(dealer.Dealer_Id)
                  return (
                    <tr key={dealer.Dealer_Id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-4 text-gray-400 text-xs">{startIndex + i}</td>

                      <td className="px-4 py-4">
                        <div className="flex items-center gap-3">
                          {/* <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-xs font-semibold shrink-0">
                            {initials(dealer.Dealer_Name)}
                          </div> */}
                          <Link
                            href={getDealerEditRoute(dealer.Dealer_Id)}
                            className="font-medium text-gray-800 hover:text-indigo-700 transition-colors"
                          >
                            {dealer.Dealer_Name || "-"}
                          </Link>
                        </div>
                      </td>

                      <td className="px-4 py-4">
                        <span className="bg-blue-50 text-blue-600 text-xs font-medium px-2.5 py-1 rounded-full">
                          {dealer.Dealer_City || "-"}
                        </span>
                      </td>

                      <td className="px-4 py-4 text-gray-500 text-xs">{dealer.Dealer_Email || "-"}</td>
                      <td className="px-4 py-4 text-gray-600 text-xs">{dealer.Dealer_Number || "-"}</td>

                      {canViewDealerPasswords && (
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-2">
                            <span className={`font-mono text-xs ${passwordVisible ? "text-gray-700 tracking-normal" : "text-gray-400 tracking-widest"}`}>
                              {passwordVisible ? dealer.Dealer_Password || "-" : "********"}
                            </span>
                            {dealer.Dealer_Password && (
                              <button
                                type="button"
                                onClick={() => togglePassword(dealer.Dealer_Id)}
                                className={`p-1 rounded-md text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 ${pressable}`}
                                aria-label={passwordVisible ? "Hide dealer password" : "Show dealer password"}
                                title={passwordVisible ? "Hide password" : "Show password"}
                              >
                                {passwordVisible
                                  ? <EyeOff className="w-3.5 h-3.5" />
                                  : <Eye className="w-3.5 h-3.5" />
                                }
                              </button>
                            )}
                          </div>
                        </td>
                      )}

                      {showStaffColumn && (
                        <td className="px-4 py-4 text-xs text-gray-600">
                          {dealer.assignedStaff?.length ? (
                            <div className="flex flex-col gap-1.5">
                              {dealer.assignedStaff.map((staff) => {
                                const roleBadge = staffRoleBadge(staff)
                                return (
                                  <div key={staff.staffId} className="flex items-center gap-1.5">
                                    <span className="truncate">{staff.name || `Staff #${staff.staffId}`}</span>
                                    {staff.phone && <span className="shrink-0 text-gray-400">{staff.phone}</span>}
                                    <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${roleBadge.bg} ${roleBadge.text}`}>
                                      {roleBadge.label}
                                    </span>
                                  </div>
                                )
                              })}
                            </div>
                          ) : (
                            dealer.staffname || dealer.assignedstaff || "-" 
                          )}
                        </td>
                      )}

                      <td className="px-4 py-4">
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${walletActive ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-600"}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${walletActive ? "bg-emerald-500" : "bg-gray-400"}`} />
                          {walletActive ? "Advance" : "Credit"}
                        </span>
                      </td>

                      <td className="px-4 py-4">
                        <span className={`inline-flex items-center gap-1.5 ${badge.bg} ${badge.text} text-xs font-medium px-2.5 py-1 rounded-full`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${badge.dot}`} />
                          {badge.label}
                        </span>
                      </td>

                      <td className="px-4 py-4">
                        <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                          <div className="relative">
                            <button
                              onClick={(e) => openFloatingMenu(e, dealer.Dealer_Id, setOpenMenu)}
                              data-menu-id={dealer.Dealer_Id}
                              className={`p-2 rounded-md text-gray-600 hover:bg-gray-50 ${pressable}`}
                              aria-label="Open actions"
                            >
                              <MoreVertical className="w-4 h-4" />
                            </button>
                            {isMenuOpen(openMenu, dealer.Dealer_Id) && (
                              <div
                                ref={measureFloatingMenu(dealer.Dealer_Id, setOpenMenu)}
                                onClick={(e) => e.stopPropagation()}
                                data-menu-id={dealer.Dealer_Id}
                                style={{ top: openMenu?.top ?? 0, left: openMenu?.left ?? 0 }}
                                className={`dealer-menu${openMenu?.flip ? " flip" : ""} fixed w-48 bg-white border border-gray-200 rounded-lg shadow-lg ring-1 ring-black/5 z-[9999] py-1 overflow-hidden`}
                              >
                                <Link href={getDealerViewRoute(dealer.Dealer_Id)} className="flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
                                  <Eye className="h-3.5 w-3.5 text-gray-400" /> View
                                </Link>
                                {role === 'staff' && (
                                  <Link href={getStaffDealerRoute(dealer.Dealer_Id)} className="flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
                                    <Eye className="h-3.5 w-3.5 text-gray-400" /> View (staff) 
                                  </Link>
                                )}
                                {canManageDealers && (
                                  <>
                                    <Link href={getDealerEditRoute(dealer.Dealer_Id)} className="flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
                                      <Pencil className="h-3.5 w-3.5 text-gray-400" /> Edit
                                    </Link>
                                    {walletActive && (
                                      <Link href={`/dashboard/admin/dealer/${encodeURIComponent(dealer.Dealer_Id)}/ledger?wallet=addfund`} className="flex items-center gap-2.5 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50">
                                        <Wallet className="h-3.5 w-3.5" /> Payment
                                      </Link>
                                    )}
                                    <button
                                      onClick={(e) => { e.stopPropagation(); confirmDealerStatusChange(dealer) }}
                                      disabled={statusUpdatingId === String(dealer.Dealer_Id)}
                                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-indigo-600 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                      {normalizeDealerStatus(dealer.status) === "active"
                                        ? <PowerOff className="h-3.5 w-3.5" />
                                        : <Power className="h-3.5 w-3.5" />}
                                      {statusUpdatingId === String(dealer.Dealer_Id)
                                        ? "Updating..."
                                        : normalizeDealerStatus(dealer.status) === "active"
                                          ? "Deactivate"
                                          : "Activate"}
                                    </button>
                                    <button onClick={(e) => { e.stopPropagation(); setDeleteConfirm(dealer.Dealer_Id); setOpenMenu(null) }} className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50">
                                      <Trash2 className="h-3.5 w-3.5" /> Delete
                                    </button>
                                  </>
                                )}
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
              {data.length > 0 ? `Showing ${startIndex}-${endIndex} of ${total}` : "No results"}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => handlePageChange(page - 1)}
                disabled={page === 1}
                className={`inline-flex items-center gap-1 px-3 py-1.5 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed ${pressable}`}
              >
                <ChevronLeft className="h-3.5 w-3.5" /> Prev
              </button>

              {pageNumbers().map((p, idx) =>
                p === "..." ? (
                  <span key={`ellipsis-${idx}`} className="px-2 text-gray-400 text-sm">...</span>
                ) : (
                  <button
                    key={p}
                    onClick={() => handlePageChange(p)}
                    className={`px-3 py-1.5 text-sm rounded-lg border ${pressable} ${p === page
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
                disabled={page === totalPages}
                className={`inline-flex items-center gap-1 px-3 py-1.5 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed ${pressable}`}
              >
                Next <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}