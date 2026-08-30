"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import {
  HiOutlineBeaker,
  HiOutlineSquares2X2,
  HiOutlineShoppingCart,
  HiOutlineClipboardDocumentList,
  HiOutlineChartBarSquare,
  HiOutlineCube,
  HiOutlineUserGroup,
  HiOutlineFire,
  HiOutlineArrowRightOnRectangle,
} from "react-icons/hi2"
import { clearAuthStorage } from "@/lib/roleAccess"

type UserData = {
  Dealer_Name?: string
  Dealer_Email?: string
  username?: string
  email?: string
  name?: string
  image?: string
  Dealer_Image?: string
  ADMIN_IMAGE?: string
  imageUrl?: string
}

function AccountList() {
  const [user, setUser]       = useState<UserData>({})
  const [role, setRole]       = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)
  const [imageSrc, setImageSrc] = useState<string>("https://i.sstatic.net/l60Hf.png")

  useEffect(() => {
    if (typeof window === "undefined") return
    try {
      const roleType = localStorage.getItem("roletype")
      const userData = JSON.parse(localStorage.getItem("UserData") || "{}")
      setRole(roleType)
      setUser(userData)
      // derive image src from stored user data, add timestamp to bust cache after updates
      const candidate = userData?.image || userData?.Dealer_Image || userData?.ADMIN_IMAGE || userData?.imageUrl || null
      if (candidate) setImageSrc(`${candidate}?t=${Date.now()}`)
    } catch { /* ignore */ }
    setMounted(true)
  }, [])

  if (!mounted) return null

  

  const userName =
    role === "3" ? user.name || user.username || "Administrator"
    : role === "2" ? user.Dealer_Name || user.name || "Dealer"
    : user.name || user.username || "Staff"

  const userEmail =
    role === "3" ? user.email || "admin@omsons.com"
    : role === "2" ? user.Dealer_Email || user.email || "dealer@omsons.com"
    : user.email || "staff@omsons.com"

  const dashboardLink =
    role === "3" ? "/dashboard/admin"
    : role === "2" ? "/dashboard/dealer"
    : "/dashboard/staff"

  const roleLabel =
    role === "3" ? "Admin" : role === "2" ? "Dealer" : "Staff"

  const ordersLink =
    role === "3" ? "/orders"
    : role === "2" ? "/orders"
    : "/dashboard/staff/orderstatus"

  const handleLogout = () => {
    clearAuthStorage(localStorage)
    window.dispatchEvent(new Event("omsons-auth-changed"))
    window.location.href = "/auth/login"
  }

  const linkStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 13,
    color: "#374151",
    textDecoration: "none",
    padding: "4px 0",
    transition: "color .15s",
  }

  return (
    <div className="bg-white rounded-lg shadow-sm overflow-hidden text-black">
      {/* ── Profile header ── */}
      <div className="w-full bg-gradient-to-r from-indigo-50 to-purple-50 p-3 border-b border-indigo-100">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 flex-1">
            <img src={imageSrc} alt="profile" className="w-10 h-10 rounded-full object-cover border-2 border-indigo-200" />
            <div className="flex flex-col min-w-0">
              <span className="text-sm font-semibold text-gray-900 truncate">{userName}</span>
              <span className="text-xs text-gray-500 truncate">{userEmail}</span>
              <span className="text-xs font-medium text-indigo-600">{roleLabel}</span>
            </div>
          </div>
          <button onClick={handleLogout} className="flex items-center gap-1.5 text-xs font-semibold text-red-500 hover:text-red-600 hover:bg-red-50 rounded-lg px-3 py-1.5 transition-colors border border-red-100">
            <HiOutlineArrowRightOnRectangle className="w-3.5 h-3.5" />
            Sign out
          </button>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="grid grid-cols-2 divide-x divide-gray-100">

        {/* LEFT — Quick Links */}
        <div className="px-5 py-4">
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Quick Links</h3>
          <ul className="space-y-1">
            <li>
              <Link href="/Products" style={linkStyle} className="hover:text-indigo-600">
                <HiOutlineBeaker className="w-4 h-4 shrink-0" /> All Products
              </Link>
            </li>
            <li>
              <Link href="/categories" style={linkStyle} className="hover:text-indigo-600">
                <HiOutlineSquares2X2 className="w-4 h-4 shrink-0" /> Categories
              </Link>
            </li>
            <li>
              <Link href="/Pages/Cart" style={linkStyle} className="hover:text-indigo-600">
                <HiOutlineShoppingCart className="w-4 h-4 shrink-0" /> My Cart
              </Link>
            </li>
            {role === "2" && (
              <li>
                <Link href="/dashboard/dealer/AddOrderForm" style={linkStyle} className="hover:text-indigo-600">
                  <HiOutlineClipboardDocumentList className="w-4 h-4 shrink-0" /> New Order
                </Link>
              </li>
            )}
          </ul>
        </div>

        {/* RIGHT — Account */}
        <div className="px-5 py-4">
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Your Account</h3>
          <ul className="space-y-1">
            <li>
              <Link href={dashboardLink} style={linkStyle} className="hover:text-indigo-600">
                <HiOutlineChartBarSquare className="w-4 h-4 shrink-0" />
                {role === "3" ? "Admin Panel" : "Dashboard"}
              </Link>
            </li>
            <li>
              <Link href={ordersLink} style={linkStyle} className="hover:text-indigo-600">
                <HiOutlineCube className="w-4 h-4 shrink-0" /> Orders
              </Link>
            </li>
            {role === "3" && (
              <>
                <li>
                  <Link href="/dashboard/admin/dealer/DealerList" style={linkStyle} className="hover:text-indigo-600">
                    <HiOutlineUserGroup className="w-4 h-4 shrink-0" /> Dealers
                  </Link>
                </li>
                <li>
                  <Link href="/dashboard/admin/hot-items" style={linkStyle} className="hover:text-indigo-600">
                    <HiOutlineFire className="w-4 h-4 shrink-0" /> Hot Items
                  </Link>
                </li>
              </>
            )}
            {role !== "3" && role !== "2" && (
              <li>
                <Link href="/dashboard/staff/orderstatus" style={linkStyle} className="hover:text-indigo-600">
                  <HiOutlineClipboardDocumentList className="w-4 h-4 shrink-0" /> Order Status
                </Link>
              </li>
            )}
          </ul>
        </div>
      </div>
    </div>
  )
}

export default AccountList
