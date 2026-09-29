"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, LogOut, Maximize, Minimize, Moon, Sun, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";

import RouteGuard from "@/components/auth/RouteGuard";
import DashboardSmartSearch from "@/components/dashboard/DashboardSmartSearch";
import DealerHelpButton from "@/components/dashboard/DealerHelpButton";
import NotificationBell from "@/components/dashboard/NotificationBell";
import SmartSearchBar from "@/components/SartSearchBar";
import Sidebar, { getInitials } from "@/components/layout/sidebar";
import { clearAuthStorage, type AppRole, type StoredUser } from "@/lib/roleAccess";
import { useAuthSession } from "@/hooks/useAuthSession";

let ledgerWarmupStarted = false;

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [dark, setDark] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    try {
      setDark(localStorage.getItem("omsons-theme") === "dark");
    } catch {}
    const onFs = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dl-dark", dark);
    try {
      localStorage.setItem("omsons-theme", dark ? "dark" : "light");
    } catch {}
    return () => document.documentElement.classList.remove("dl-dark");
  }, [dark]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        document.querySelector<HTMLInputElement>(".dl-search-area input")?.focus();
      }
      if (event.key === "Escape") setUserMenu(false);
    };
    const onDown = (event: MouseEvent) => {
      if (!userMenuRef.current?.contains(event.target as Node)) setUserMenu(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, []);

  const profileHref = role && role !== "accountant" ? `/dashboard/${role}/profile` : null;

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().catch(() => {});
  };

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
          height: 72px;
          padding: 0 22px;
          background: #075ED6;
          box-shadow: 0 2px 12px rgba(7,94,214,0.25);
          display: flex;
          align-items: center;
          gap: 14px;
          color: #fff;
        }
        .dl-hamburger {
          flex-shrink: 0;
          width: 40px;
          height: 40px;
          border-radius: 50%;
          border: 1px solid rgba(255,255,255,0.18);
          background: rgba(255,255,255,0.12);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          color: #fff;
          transition: background 0.15s;
        }
        .dl-hamburger:hover { background: rgba(255,255,255,0.2); }
        .dl-divider {
          width: 1px;
          height: 36px;
          flex-shrink: 0;
          background: rgba(255,255,255,0.25);
        }
        .dl-title {
          font-size: 17px;
          font-weight: 700;
          color: #fff;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .dl-sub {
          font-size: 12.5px;
          color: rgba(255,255,255,0.8);
          margin-top: 2px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .dl-search-area {
          position: relative;
          flex: 1;
          min-width: 0;
          max-width: 640px;
          margin: 0 auto;
          display: flex;
        }
        .dl-search-area .ss-wrap {
          width: 100%;
          max-width: none;
          margin: 0;
        }
        .dl-search-area > div { max-width: none; }
        .dl-search-area form,
        .dl-search-area .ss-input-row {
          height: 44px;
          border-radius: 999px;
          background: rgba(255,255,255,0.16);
          border: 1px solid rgba(255,255,255,0.2);
          box-shadow: none;
          padding-right: 88px;
        }
        .dl-search-area form { padding-left: 6px; }
        .dl-search-area .ss-input-row { padding-left: 16px; }
        .dl-search-area form:focus-within,
        .dl-search-area .ss-input-row.focused {
          background: rgba(255,255,255,0.22);
          border-color: rgba(255,255,255,0.45);
        }
        .dl-search-area input { font-size: 14px; }
        .dl-search-area input::placeholder { color: rgba(255,255,255,0.85); }
        .dl-search-area form > div:first-child,
        .dl-search-area .ss-icon { color: #fff; }
        .dl-kbd {
          position: absolute;
          right: 10px;
          top: 50%;
          transform: translateY(-50%);
          pointer-events: none;
          padding: 4px 9px;
          border-radius: 8px;
          background: rgba(255,255,255,0.18);
          font: 600 12px/1.2 inherit;
          color: #fff;
          white-space: nowrap;
        }
        .dl-actions {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-shrink: 0;
        }
        .dl-icon-btn {
          position: relative;
          width: 42px;
          height: 42px;
          flex-shrink: 0;
          border-radius: 50%;
          background: rgba(255,255,255,0.12);
          border: 1px solid rgba(255,255,255,0.14);
          color: #fff;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background .16s;
        }
        .dl-icon-btn:hover { background: rgba(255,255,255,0.22); }
        .dl-help span { display: none; }
        .dl-bell-dot {
          position: absolute;
          top: 7px;
          right: 9px;
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: #ef4444;
          box-shadow: 0 0 0 2px #075ED6;
        }
        .dl-menu-root { position: relative; }
        .dl-user {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 0 4px 0 0;
          background: transparent;
          border: 0;
          color: #fff;
          cursor: pointer;
          font-family: inherit;
        }
        .dl-avatar {
          width: 42px;
          height: 42px;
          flex-shrink: 0;
          border-radius: 50%;
          border: 1px solid rgba(255,255,255,0.4);
          background: rgba(255,255,255,0.12);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          font-weight: 700;
        }
        .dl-user-name {
          max-width: 140px;
          font-size: 14px;
          font-weight: 700;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .dl-menu {
          position: absolute;
          top: calc(100% + 12px);
          right: 0;
          z-index: 50;
          width: 240px;
          border-radius: 14px;
          border: 1px solid #e2e8f0;
          background: #fff;
          color: #0f172a;
          box-shadow: 0 18px 40px rgba(15,23,42,0.18);
          overflow: hidden;
        }
        .dl-menu-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 14px;
          border-bottom: 1px solid #f1f5f9;
          font-size: 13.5px;
          font-weight: 700;
        }
        .dl-menu-head span {
          font-size: 11px;
          padding: 1px 8px;
          border-radius: 999px;
          background: #e8f0fd;
          color: #075ED6;
        }
        .dl-menu-sub { font-size: 12px; font-weight: 400; color: #64748b; margin-top: 2px; }
        .dl-menu-item {
          width: 100%;
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 14px;
          font-size: 13.5px;
          color: #0f172a;
          background: none;
          border: 0;
          cursor: pointer;
          font-family: inherit;
          text-decoration: none;
        }
        .dl-menu-item:hover { background: #f1f5f9; }
        .dl-menu-item.danger { color: #dc2626; }
        .dl-menu-item.danger:hover { background: #fef2f2; }
        .dl-notif-menu { width: 340px; }
        .dl-notif-list { max-height: min(420px, 70vh); overflow-y: auto; margin: 0; padding: 4px 0; list-style: none; }
        .dl-notif-item {
          display: flex;
          gap: 10px;
          padding: 10px 14px;
          color: inherit;
          text-decoration: none;
        }
        .dl-notif-item:hover { background: #f8fafc; }
        .dl-notif-dot { width: 8px; height: 8px; border-radius: 50%; margin-top: 6px; flex-shrink: 0; }
        .dl-notif-title { display: block; font-size: 13px; font-weight: 600; }
        .dl-notif-desc { display: block; font-size: 12px; color: #475569; margin-top: 1px; }
        .dl-notif-time { display: block; font-size: 11px; color: #94a3b8; margin-top: 3px; }
        .dl-notif-empty { padding: 24px 14px; text-align: center; font-size: 13px; color: #64748b; }
        /* ponytail: pages use hardcoded colors, so dark mode inverts the page and flips back
           the already-dark header/sidebar and media. Replace with real dark: styles if needed. */
        html.dl-dark {
          filter: invert(1) hue-rotate(180deg);
          background: #fff;
        }
        html.dl-dark .dl-topbar,
        html.dl-dark .sb-panel,
        html.dl-dark main :is(img, video, canvas, iframe) {
          filter: invert(1) hue-rotate(180deg);
        }
        @media (max-width: 1100px) {
          .dl-user-name, .dl-user svg, .dl-kbd { display: none; }
          .dl-search-area form, .dl-search-area .ss-input-row { padding-right: 12px; }
        }
        @media (max-width: 900px) {
          .dl-topbar { padding: 0 14px; gap: 10px; }
          .dl-actions { gap: 8px; }
          .dl-sub, .dl-divider, .dl-fs { display: none; }
        }
        @media (max-width: 680px) {
          .dl-welcome { display: none; }
          .dl-icon-btn, .dl-avatar { width: 38px; height: 38px; }
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

            <div className="dl-welcome" style={{ minWidth: 0 }}>
              <div className="dl-title">{user ? `Welcome, ${displayName}` : "Dashboard"}</div>
              {displaySub && <div className="dl-sub">{displaySub}</div>}
            </div>

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
              <kbd className="dl-kbd">Ctrl + K</kbd>
            </div>

            <div className="dl-actions">
              {role === "dealer" && <DealerHelpButton className="dl-icon-btn dl-help" />}

              {user ? <NotificationBell className="dl-icon-btn" /> : null}

              <button
                className="dl-icon-btn dl-fs"
                onClick={toggleFullscreen}
                aria-label={fullscreen ? "Exit full screen" : "Enter full screen"}
                title={fullscreen ? "Exit full screen" : "Full screen"}
              >
                {fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
              </button>

              <button
                className="dl-icon-btn"
                onClick={() => setDark((value) => !value)}
                aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
                title={dark ? "Light mode" : "Dark mode"}
              >
                {dark ? <Sun size={18} /> : <Moon size={18} />}
              </button>

              <div className="dl-divider" />

              <div className="dl-menu-root" ref={userMenuRef}>
                <button
                  className="dl-user"
                  onClick={() => setUserMenu((value) => !value)}
                  aria-haspopup="menu"
                  aria-expanded={userMenu}
                >
                  <span className="dl-avatar">{getInitials(displayName)}</span>
                  <span className="dl-user-name">{displayName}</span>
                  <ChevronDown size={16} />
                </button>

                {userMenu && (
                  <div className="dl-menu" role="menu">
                    <div className="dl-menu-head" style={{ display: "block" }}>
                      {displayName}
                      {displaySub && <div className="dl-menu-sub">{displaySub}</div>}
                    </div>
                    {profileHref && (
                      <Link href={profileHref} className="dl-menu-item" role="menuitem" onClick={() => setUserMenu(false)}>
                        <UserRound size={15} /> Profile
                      </Link>
                    )}
                    <button className="dl-menu-item danger" role="menuitem" onClick={handleLogout}>
                      <LogOut size={15} /> Sign out
                    </button>
                  </div>
                )}
              </div>
            </div>
          </header>

          <main style={{ flex: 1 }}>{children}</main>
        </div>
      </div>
    </RouteGuard>
  );
}
