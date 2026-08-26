"use client";

import { useState } from "react";

import RouteGuard from "@/components/auth/RouteGuard";
import Sidebar from "@/components/layout/sidebar";
import SmartSearchBar from "@/components/SartSearchBar";
import { useAuthSession } from "@/hooks/useAuthSession";

export default function OrdersLayout({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const auth = useAuthSession();
  const user = !auth.loading && auth.session.status === "authenticated" ? auth.session.user : null;
  const role = !auth.loading && auth.session.status === "authenticated" ? auth.session.role : null;

  const displayName =
    role === "accountant" ? user?.name || "Accountant" :
    role === "dealer" ? user?.Dealer_Name || "Dealer" :
    role === "staff" ? user?.staff_name || "Staff" :
    user?.name ?? user?.username ?? "Admin";

  const displaySub =
    role === "accountant" ? user?.email ?? "Finance portal" :
    role === "dealer" ? user?.Dealer_City ?? "Dealer dashboard" :
    role === "staff" ? [user?.staff_location, user?.staff_designation].filter(Boolean).join(" - ") || `ID: ${user?.staff_id ?? ""}` :
    "System administration dashboard";

  const searchPlaceholder =
    role === "admin" ? "Search orders, dealers, staff..." :
    role === "dealer" ? "Search orders, products..." :
    role === "accountant" ? "Search orders, payments..." :
    "Search orders, dealers...";

  const userId =
    role === "dealer" ? String(user?.Dealer_Id ?? "") :
    role === "staff" ? String(user?.staff_id ?? "") :
    undefined;

  return (
    <RouteGuard>
      <style>{`
        .dl-topbar {
          position: sticky;
          top: 0;
          z-index: 20;
          height: 62px;
          padding: 0 22px;
          background: linear-gradient(to right, #1f4b8d, #0d0c16);
          border-bottom: 1px solid rgba(255,255,255,0.08);
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .dl-hamburger {
          flex-shrink: 0;
          width: 38px; height: 38px;
          border-radius: 10px;
          border: 1px solid rgba(255,255,255,0.15);
          background: rgba(255,255,255,0.06);
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; color: #fff;
          transition: background .15s;
        }
        .dl-hamburger:hover { background: rgba(255,255,255,0.12); }
        .dl-title { font-size: 15px; font-weight: 600; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .dl-sub { font-size: 11px; color: rgba(255,255,255,0.5); margin-top: 1px; }
      `}</style>

      <div style={{ minHeight: "100vh", background: "#f0f2f5", fontFamily: "'DM Sans', sans-serif" }}>
        <Sidebar open={open} onClose={() => setOpen(false)} />

        <div className={`dl-shell${open ? " sb-expanded" : ""}`} style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
          <header className="dl-topbar">
            <button
              className="dl-hamburger"
              onClick={() => setOpen((value) => !value)}
              aria-label="Toggle sidebar"
              aria-expanded={open}
            >
              <span className="dl-burger" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
            </button>

            <img src="https://omsonsapp.vercel.app/headicon.png" alt="Omsons" style={{ height: 44, flexShrink: 0 }} />

            <div style={{ minWidth: 0 }}>
              <div className="dl-title">{user ? `Welcome, ${displayName}` : "Dashboard"}</div>
              {displaySub && <div className="dl-sub">{displaySub}</div>}
            </div>

            {role && (
              <SmartSearchBar
                role={role}
                userId={userId}
                placeholder={searchPlaceholder}
              />
            )}
          </header>

          <main style={{ flex: 1 }}>{children}</main>
        </div>
      </div>
    </RouteGuard>
  );
}
