"use client";

import { useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";

import RouteGuard from "@/components/auth/RouteGuard";
import DashboardSmartSearch from "@/components/dashboard/DashboardSmartSearch";
import DealerHelpButton from "@/components/dashboard/DealerHelpButton";
import SmartSearchBar from "@/components/SartSearchBar";
import Sidebar from "@/components/layout/sidebar";
import { clearAuthStorage, type AppRole, type StoredUser } from "@/lib/roleAccess";
import { useAuthSession } from "@/hooks/useAuthSession";

let ledgerWarmupStarted = false;

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const auth = useAuthSession();
  const router = useRouter();

  const user: StoredUser | null =
    !auth.loading && auth.session.status === "authenticated" ? auth.session.user : null;
  const role: AppRole | null =
    !auth.loading && auth.session.status === "authenticated" ? auth.session.role : null;

  useEffect(() => {
    if (auth.loading || auth.session.status !== "authenticated") return;
    if (auth.session.role === "staff" || auth.session.role === "dealer") return;
    if (ledgerWarmupStarted) return;
    ledgerWarmupStarted = true;

    void fetch("/api/ledger", { cache: "no-store" }).catch((error) => {
      console.error("[dashboard ledger preload]", error);
      ledgerWarmupStarted = false;
    });
  }, [auth.loading, auth.session]);

  const displayName =
    role === "accountant"
      ? user?.name || "Accountant"
      : role === "dealer"
        ? user?.Dealer_Name || "Dealer"
        : role === "staff"
          ? user?.staff_name || "Staff"
          : user?.name ?? user?.username ?? "Admin";

  const displaySub =
    role === "accountant"
      ? user?.email ?? "Finance portal"
      : role === "dealer"
        ? user?.Dealer_City ?? "Dealer dashboard"
        : role === "staff"
          ? [user?.staff_location, user?.staff_designation].filter(Boolean).join(" · ") || `ID: ${user?.staff_id ?? ""}`
          : "System administration dashboard";

  const searchPlaceholder =
    role === "admin"
      ? "Search products, orders, dealers, staff..."
      : role === "dealer"
        ? "Search products and your orders..."
        : role === "accountant"
          ? "Search orders, payments..."
          : "Search products and assigned orders...";

  const userId =
    role === "dealer"
      ? String(user?.Dealer_Id ?? "")
      : role === "staff"
        ? String(user?.staff_id ?? "")
        : undefined;

  const dashboardActorId =
    role === "dealer"
      ? String(user?.Dealer_Id ?? "")
      : role === "staff"
        ? String(user?.staff_id ?? "")
        : String(user?.staff_id ?? user?.id ?? user?.admin_id ?? user?.Admin_Id ?? user?.email ?? "");

  const dashboardRoleType =
    role === "admin"
      ? String(user?.staff_roletype ?? "0")
      : String(user?.staff_roletype ?? "");

  const handleLogout = () => {
    void fetch("/api/auth/logout", { method: "POST", credentials: "include" }).finally(() => {
      clearAuthStorage(localStorage);
      window.dispatchEvent(new Event("omsons-auth-changed"));
      router.push("/auth/login");
    });
  };

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
          width: 38px;
          height: 38px;
          border-radius: 10px;
          border: 1px solid rgba(255,255,255,0.15);
          background: rgba(255,255,255,0.06);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          color: #fff;
          transition: background 0.15s;
        }
        .dl-hamburger:hover {
          background: rgba(255,255,255,0.12);
        }
        .dl-title {
          font-size: 15px;
          font-weight: 600;
          color: #fff;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .dl-sub {
          font-size: 11px;
          color: rgba(255,255,255,0.5);
          margin-top: 1px;
        }
        .dl-top-actions {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-left: auto;
          min-width: 0;
          flex: 1;
        }
        .dl-search-area {
          min-width: 0;
          flex: 1;
          display: flex;
          justify-content: flex-end;
        }
        .dl-search-area .ss-wrap {
          width: 100%;
          max-width: 640px;
          margin: 0;
        }
        .dl-logout {
          height: 38px;
          flex-shrink: 0;
          padding: 0 14px;
          border-radius: 11px;
          background: transparent;
          border: 1px solid rgba(255,255,255,0.09);
          font-size: 13px;
          font-weight: 500;
          color: rgba(226,232,240,0.72);
          cursor: pointer;
          font-family: inherit;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          transition: all .16s;
        }
        .dl-logout:hover {
          background: rgba(239,68,68,0.1);
          border-color: rgba(239,68,68,0.28);
          color: #f87171;
        }
        .dl-help {
          height: 38px;
          flex-shrink: 0;
          padding: 0 14px;
          border-radius: 11px;
          background: transparent;
          border: 1px solid rgba(255,255,255,0.09);
          font-size: 13px;
          font-weight: 500;
          color: rgba(226,232,240,0.72);
          cursor: pointer;
          font-family: inherit;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          transition: all .16s;
        }
        .dl-help:hover {
          background: rgba(56,189,248,0.12);
          border-color: rgba(56,189,248,0.3);
          color: #7dd3fc;
        }
        @media (max-width: 900px) {
          .dl-topbar {
            padding: 0 14px;
            gap: 10px;
          }
          .dl-top-actions {
            gap: 10px;
          }
        }
        @media (max-width: 680px) {
          .dl-sub {
            display: none;
          }
          .dl-logout span,
          .dl-help span {
            display: none;
          }
          .dl-logout,
          .dl-help {
            width: 38px;
            padding: 0;
          }
        }
      `}</style>

      <div style={{ minHeight: "100vh", background: "#f0f2f5", fontFamily: "Arial, Helvetica, sans-serif" }}>
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

            {/* <img
              src="https://omsonsapp.vercel.app/headicon.png"
              alt="Omsons"
              style={{ height: 44, flexShrink: 0 }}
            /> */}

            <div style={{ minWidth: 0 }}>
              <div className="dl-title">{user ? `Welcome, ${displayName}` : "Dashboard"}</div>
              {displaySub && <div className="dl-sub">{displaySub}</div>}
            </div>

            <div className="dl-top-actions">
              <div className="dl-search-area">
                {role === "accountant" ? (
                  <SmartSearchBar
                    role={role ?? "accountant"}
                    userId={userId}
                    placeholder={searchPlaceholder}
                  />
                ) : (
                  <DashboardSmartSearch
                    role={role ?? "staff"}
                    actorId={dashboardActorId}
                    roletype={dashboardRoleType}
                    placeholder={searchPlaceholder}
                  />
                )}
              </div>

              {role === "dealer" && <DealerHelpButton className="dl-help" />}

              <button className="dl-logout" onClick={handleLogout}>
                <LogOut size={14} />
                <span>Sign out</span>
              </button>
            </div>
          </header>

          <main style={{ flex: 1 }}>{children}</main>
        </div>
      </div>
    </RouteGuard>
  );
}
