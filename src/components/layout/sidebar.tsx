"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard, UserRoundPlus, Users, SquareUser,
  Plus, ClipboardList, Home, LogOut, Package, Images,
  ShieldCheck, Gift, Receipt, TrendingUp, BookOpen, FileText,
  Wallet, MapPinned, ChevronRight, Truck, ScrollText,
  Handshake, Box, FilePen, ChartColumn, Calculator, Settings,
} from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { clearAuthStorage, type AppRole, type StoredUser } from "@/lib/roleAccess";
import { useAuthSession } from "@/hooks/useAuthSession";

type NavItem = { label: string; href: string; icon: React.ReactNode; section?: string; badgeKey?: BadgeKey };
type BadgeKey = "discountRequests" | "fundRequests" | "dealerRequests" | "pendingOrders" | "drafts" | "orders" | "settlements";
type SidebarUser = {
  role: AppRole;
  name?: string;
  username?: string;
  email?: string;
  Dealer_Name?: string;
  Dealer_Email?: string;
  Dealer_Number?: string;
  Dealer_Dealercode?: string;
  staff_name?: string;
  staff_email?: string;
  staff_roletype?: string;
  ADMIN_IMAGE?: string;
};

const NAV: Record<AppRole, NavItem[]> = {
  admin: [
    { section: "Overview",    label: "Dashboard",          href: "/dashboard/admin",                                 icon: <LayoutDashboard size={15} /> },
    {                         label: "Profile",            href: "/dashboard/admin/profile",                         icon: <SquareUser size={15} />      },
    { section: "Dealers",     label: "Dealer List",        href: "/dashboard/admin/dealer/DealerList",               icon: <Users size={15} />           },
    {                         label: "Dealer Ledger",       href: "/dashboard/admin/ledger",                          icon: <BookOpen size={15} />        },
    // {                         label: "Add Dealer",          href: "/dashboard/admin/dealer/AddDealerForm",            icon: <UserRoundPlus size={15} />   },
    {                         label: "Dealer Requests",     href: "/dashboard/admin/dealer/requests",                 icon: <Receipt size={15} />, badgeKey: "dealerRequests" },
    {                         label: "Terms Acceptance",    href: "/dashboard/admin/terms-acceptance",                icon: <FileText size={15} />        },
    { section: "Staff",       label: "Staff List",         href: "/dashboard/admin/staff/stafflist",                 icon: <Users size={15} />           },
    {                         label: "Manage Regions",     href: "/dashboard/admin/manage-regions",                 icon: <MapPinned size={15} />       },
   // {                         label: "Add Staff",           href: "/dashboard/admin/staff/addstaff",                  icon: <SquareUser size={15} />      },
    { section: "Products",    label: "Products",           href: "/Pages/products",                                  icon: <Package size={15} />         },
   // {                         label: "Add Product",         href: "/Pages/products/addproducts",                      icon: <Plus size={15} />            },
    { section: "Orders",      label: "Order List",         href: "/orders",                           icon: <ClipboardList size={15} />   },
    {                         label: "Pending Orders",      href: "/Pages/Ordermanagement/outstandingorders",         icon: <ClipboardList size={15} />, badgeKey: "pendingOrders" },
    {                         label: "Pending Products",    href: "/dashboard/admin/pending-products",                icon: <Package size={15} />         },
    {                         label: "Discount Approvals",  href: "/dashboard/admin/custom-discount-approvals",       icon: <Receipt size={15} />, badgeKey: "discountRequests" },
    {                         label: "Courier Services",    href: "/dashboard/admin/couriers",                        icon: <Truck size={15} />           },
    { section: "Content",     label: "Slider Images",      href: "/dashboard/admin/slider",                          icon: <Images size={15} />          },
    {                         label: "Hot Items",           href: "/dashboard/admin/hot-items",                       icon: <Images size={15} />          },
    { section: "Forms",       label: "Filter Requirement Forms", href: "/dashboard/admin/forms",                    icon: <FileText size={15} />        },
    { section: "Reports",     label: "Dealer Category Report", href: "/dashboard/admin/reports/dealer-category",     icon: <TrendingUp size={15} />      },
    { section: "Accountants", label: "Manage Accountants", href: "/dashboard/admin/manageAccountants/add-account",   icon: <ShieldCheck size={15} />     },
    { section: "Rewards",     label: "Dealer Rewards",     href: "/dashboard/admin/rewards",                         icon: <Gift size={15} />            },
    // Visible across the admin portal, but the API is ADMIN-only: an NSM opening
    // this gets the access notice on the page rather than a blank table.
    { section: "System",      label: "Audit Logs",         href: "/dashboard/admin/audit-logs",                      icon: <ScrollText size={15} />      },
  ],
  dealer: [
    { section: "Home",     label: "Home",             href: "/home",                          icon: <Home size={15} />          },
    {                      label: "Dashboard",         href: "/dashboard/dealer",              icon: <LayoutDashboard size={15} /> },
    {                      label: "Profile",           href: "/dashboard/dealer/profile",      icon: <SquareUser size={15} />      },
    { section: "Orders",   label: "My Order Status",  href: "/orders",         icon: <ClipboardList size={15} />, badgeKey: "orders" },
    {                      label: "My Order History",  href: "/orders",                        icon: <ClipboardList size={15} /> },
    {                      label: "Pending Products",  href: "/dashboard/dealer/pending-products", icon: <Package size={15} /> },
    {                      label: "Add Order",         href: "/dashboard/dealer/AddOrderForm", icon: <Plus size={15} />          },
    {                      label: "Saved Drafts",      href: "/drafts",                        icon: <FileText size={15} />, badgeKey: "drafts" },
    {                      label: "Approved Discounts", href: "/dashboard/dealer/approved-discounts", icon: <Receipt size={15} /> },
    { section: "Finance",  label: "My Ledger",         href: "/Pages/ledger",                  icon: <Wallet size={15} />        },
    {                      label: "My Fund Requests",  href: "/dashboard/dealer/fund-requests", icon: <Receipt size={15} />, badgeKey: "fundRequests" },
  ],
  staff: [
    { section: "Overview", label: "Dashboard",     href: "/dashboard/staff",                                icon: <LayoutDashboard size={15} /> },
    {                     label: "Profile",       href: "/dashboard/staff/profile",                        icon: <SquareUser size={15} />      },
    {                     label: "Add Dealer",    href: "/dashboard/admin/dealer/AddDealerForm",           icon: <UserRoundPlus size={15} />   },
    {                     label: "Dealer Requests", href: "/dashboard/staff/dealer-requests",              icon: <Receipt size={15} />, badgeKey: "dealerRequests" },
    {                     label: "Discount Requests", href: "/dashboard/staff/discount-requests",           icon: <Receipt size={15} />, badgeKey: "discountRequests" },
    {                     label: "Fund Requests",     href: "/dashboard/staff/fund-requests",                icon: <Wallet size={15} />, badgeKey: "fundRequests" },
    { section: "Orders",   label: "Order List",    href: "/orders",                          icon: <ClipboardList size={15} />   },
    {                      label: "Pending Orders", href: "/Pages/Ordermanagement/outstandingorders",        icon: <ClipboardList size={15} />, badgeKey: "pendingOrders" },
    {                      label: "Pending Products", href: "/dashboard/staff/pending-products",             icon: <Package size={15} />         },
    { section: "Dealers",  label: "Dealer List",   href: "/dashboard/staff/dealerlist",              icon: <Users size={15} />           },
    {                      label: "Dealer Ledger",  href: "/Pages/ledger",                                   icon: <BookOpen size={15} />        },
    { section: "Forms",    label: "Filter Requirement Forms", href: "/dashboard/staff/forms",                      icon: <FileText size={15} />        },
    {                      label: "New Filter Form",          href: "/dashboard/staff/forms/add",                   icon: <Plus size={15} />            },
    { section: "Reports",  label: "Dealer Category Report", href: "/dashboard/staff/reports/dealer-category", icon: <TrendingUp size={15} />      },
  ],
  accountant: [
    { section: "Overview",  label: "Dashboard",      href: "/dashboard/accountant",                         icon: <LayoutDashboard size={15} /> },
    { section: "Orders",    label: "All Orders",     href: "/orders",
            icon: <Receipt size={15} />         },
    { section: "Finance",   label: "Order Book",     href: "/dashboard/accountant/order-book",              icon: <BookOpen size={15} />        },
    {                       label: "Wallet Settlements", href: "/dashboard/accountant/settle",              icon: <Wallet size={15} />, badgeKey: "settlements" },
    {                       label: "Advance Order Requests", href: "/dashboard/accountant/fund-requests",     icon: <Wallet size={15} />, badgeKey: "fundRequests" },
    {                       label: "Fund Addition Records",  href: "/dashboard/accountant/fund-records",      icon: <BookOpen size={15} />        },
    {                       label: "Dealer Ledger",   href: "/dashboard/admin/ledger",                       icon: <Wallet size={15} />          },
    {                       label: "Reports",        href: "/dashboard/accountant",                          icon: <TrendingUp size={15} />      },
  ],
};

const SECTION_ICONS: Record<string, React.ReactNode> = {
  Dealers: <Handshake />, Staff: <Users />, Products: <Box />, Orders: <ClipboardList />,
  Content: <FileText />, Forms: <FilePen />, Reports: <ChartColumn />, Accountants: <Calculator />,
  Rewards: <Gift />, System: <Settings />, Finance: <Wallet />,
};

export function getInitials(name?: string) {
  const words = name?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (!words.length) return "AD";
  // "Admin" -> "AD", "Ravi Kumar" -> "RK"
  return (words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0]).toUpperCase();
}

function staffRoleLabel(rt?: string) {
  return rt === "0" ? "Admin" : rt === "1" ? "Sales Manager" : rt === "2" ? "Staff" : "Staff";
}

/* Pinned is a per-person preference living in localStorage, so it is read
   through an external store: the server snapshot is always "unpinned", which
   keeps hydration stable, and every mounted sidebar stays in sync. */
const PIN_KEY = "sb-pinned";
const pinListeners = new Set<() => void>();

function subscribePin(onChange: () => void) {
  pinListeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    pinListeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readPin() {
  try {
    return localStorage.getItem(PIN_KEY) === "1";
  } catch {
    return false;
  }
}

function writePin(next: boolean) {
  try {
    localStorage.setItem(PIN_KEY, next ? "1" : "0");
  } catch {
    /* private mode — the preference simply will not persist */
  }
  pinListeners.forEach((notify) => notify());
}

/* Every nav badge comes from one endpoint, which scopes each number to the
   actor the same way the page behind the badge does. */
function useBadgeCounts(role: AppRole | undefined, pathname: string) {
  const [counts, setCounts] = useState<Partial<Record<BadgeKey, number>>>({});

  useEffect(() => {
    if (!role) {
      setCounts({});
      return;
    }

    let cancelled = false;
    const load = () => {
      fetch("/api/sidebar-counts", { credentials: "include", cache: "no-store" })
        .then((res) => (res.ok ? res.json() : null))
        .then((json) => {
          if (!cancelled && json?.counts) setCounts(json.counts);
        })
        .catch(() => {
          /* a badge is ancillary — leave the last good numbers rather than
             flashing an error into the nav */
        });
    };

    load();
    // Refetch when the tab regains focus so a decision made elsewhere (or in
    // another tab) is reflected without a reload.
    window.addEventListener("focus", load);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", load);
    };
    // pathname is a dependency so acting on the page updates the badge on the
    // way out of it.
  }, [role, pathname]);

  return counts;
}

export default function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname              = usePathname();
  const router                = useRouter();
  const auth                  = useAuthSession();
  const mounted               = !auth.loading;
  const user                  =
    !auth.loading && auth.session.status === "authenticated"
      ? ({ ...auth.session.user, role: auth.session.role } as StoredUser & SidebarUser)
      : null;
  const role                  = user?.role;
  const pinned = useSyncExternalStore(subscribePin, readPin, () => false);
  const badgeCounts = useBadgeCounts(role, pathname);

  // The page shell lives in the layouts, so signal the pinned width globally.
  useEffect(() => {
    const root = document.documentElement;
    if (pinned) root.dataset.sbPinned = "1";
    else delete root.dataset.sbPinned;
  }, [pinned]);

  const togglePin = () => writePin(!pinned);
  // Accordion: at most one section open, and nothing open until clicked.
  const [openSection, setOpenSection] = useState<string | null>(null);

  const name =
    role === "dealer"     ? user?.Dealer_Name :
    role === "staff"      ? user?.staff_name  :
    role === "accountant" ? user?.name        :
    user?.name ?? user?.username ?? "Administrator";

  const meta =
    role === "dealer"     ? (user?.Dealer_Email ?? user?.Dealer_Number ?? "") :
    role === "staff"      ? (user?.staff_email ?? "")                         :
    role === "accountant" ? (user?.email ?? "")                               :
    (user?.email ?? "admin@omsons.com");

  const badge =
    role === "dealer"     ? user?.Dealer_Dealercode          :
    role === "staff"      ? staffRoleLabel(user?.staff_roletype) :
    role === "accountant" ? "Accountant"                     :
    user?.role ?? "Administrator";

  const portal =
    role === "admin"      ? "Admin Portal"      :
    role === "dealer"     ? "Dealer Portal"     :
    role === "accountant" ? "Finance Portal"    :
    "Staff Portal";

  const handleLogout = () => {
    void fetch("/api/auth/logout", { method: "POST", credentials: "include" }).finally(() => {
      clearAuthStorage(localStorage);
      window.dispatchEvent(new Event("omsons-auth-changed"));
      router.push("/auth/login");
    });
  };

  const grouped: { section?: string; items: NavItem[] }[] = [];
  (role ? NAV[role] : []).forEach(item => {
    if (item.section) {
      grouped.push({ section: item.section, items: [item] });
    } else {
      const last = grouped[grouped.length - 1];
      if (last) last.items.push(item);
    }
  });


  return (
    <>
      <style>{`
        .sb-overlay {
          position: fixed; inset: 0; z-index: 30;
          background: rgba(0,0,0,0.5); backdrop-filter: blur(3px);
          opacity: 0; pointer-events: none;
          transition: opacity .28s;
        }
        .sb-overlay.show { opacity: 1; pointer-events: all; }

        .sb-panel {
          position: fixed; top: 0; left: 0; bottom: 0;
          width: 264px; z-index: 40;
          background: #075ED6;
          display: flex; flex-direction: column;
          transform: translateX(-100%);
          overflow: hidden;
          transition: transform .3s cubic-bezier(0.4,0,0.2,1), width .3s cubic-bezier(0.4,0,0.2,1), box-shadow .3s ease;
          will-change: transform, width;
        }
        .sb-panel.open { transform: translateX(0); }

        /* The page shell each layout wraps around its topbar + main. */
        .dl-shell { transition: margin-left .3s cubic-bezier(0.4,0,0.2,1); }

        /* Head */
        .sb-head {
          display: flex; align-items: center; gap: 12px;
          transition: gap .3s cubic-bezier(.32,.72,0,1), padding .3s cubic-bezier(.32,.72,0,1);
          height: 72px; box-sizing: border-box; padding: 0 13px; /* 46px mark centred in the 72px rail and header */
        }
        .sb-mark {
          width: 46px; height: 46px; flex: 0 0 auto; padding: 4px; box-sizing: border-box;
          border-radius: 12px;
          background: #fff;
          overflow: hidden;
          box-shadow: 0 2px 8px rgba(0,0,0,0.12);
        }
        .sb-mark img { width: 100%; height: 100%; object-fit: contain; display: block; }
        .sb-headtext { min-width: 0; padding-left: 12px; border-left: 1px solid rgba(255,255,255,0.3); }
        .sb-title { font-size: 16px; font-weight: 700; color: #fff; letter-spacing: -.2px; }
        .sb-chip {
          display: block; margin-top: 3px;
          color: rgba(255,255,255,0.85); font-size: 10.5px; font-weight: 500;
          letter-spacing: .16em; text-transform: uppercase;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        /* User card */
        .sb-user {
          margin: 10px 14px 0; padding: 14px;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.28);
          border-radius: 14px;
          display: flex; align-items: center; gap: 12px;
          transition: gap .3s cubic-bezier(.32,.72,0,1), margin .3s cubic-bezier(.32,.72,0,1), padding .3s cubic-bezier(.32,.72,0,1);
        }
        .sb-avatar {
          width: 44px; height: 44px; flex: 0 0 auto;
          border-radius: 50%;
          background: #3d8bfd;
          display: grid; place-items: center;
          font-size: 15px; font-weight: 700; color: #fff;
          overflow: hidden;
        }
        .sb-avatar img { width: 100%; height: 100%; object-fit: cover; }
        .sb-usertext { min-width: 0; }
        .sb-uname { font-size: 14px; font-weight: 700; color: #fff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .sb-meta  { font-size: 12px; color: rgba(255,255,255,0.9); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .sb-role  { margin-top: 6px; display: inline-block; font-size: 11px; background: rgba(255,255,255,0.2); color: #fff; padding: 1px 10px; border-radius: 999px; }

        .sb-divider { height: 1px; flex: 0 0 auto; margin: 14px 18px; background: rgba(255,255,255,0.18); }

        /* Nav */
        .sb-nav { flex: 1; padding: 0 14px; overflow-y: auto; overflow-x: hidden; }
        .sb-nav::-webkit-scrollbar { width: 4px; }
        .sb-nav::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.18); border-radius: 3px; }

        /* The first group (Overview / Home) is a fixed label with its links always shown. */
        .sb-lead-label {
          padding: 2px 4px 10px;
          font-size: 11px; font-weight: 600;
          letter-spacing: .16em; text-transform: uppercase;
          color: rgba(255,255,255,0.8);
          white-space: nowrap; overflow: hidden;
        }
        .sb-group.lead { margin-bottom: 14px; padding-bottom: 14px; border-bottom: 1px solid rgba(255,255,255,0.18); }

        /* Every other group is a collapsible row with its own icon. */
        .sb-section {
          position: relative;
          width: 100%; height: 46px;
          display: flex; align-items: center;
          padding: 0; margin-bottom: 2px;
          border: 0; border-radius: 12px;
          background: transparent;
          color: #fff;
          cursor: pointer;
          font-family: inherit; font-size: 12.5px; font-weight: 600;
          letter-spacing: .14em; text-transform: uppercase;
          text-align: left;
          user-select: none;
          transition: background .16s;
        }
        .sb-section:hover { background: rgba(255,255,255,0.08); }
        .sb-group.open .sb-section { background: rgba(255,255,255,0.06); }
        .sb-section-icon {
          width: 16px !important; height: 16px !important; padding: 0 !important;
          margin-left: auto; margin-right: 14px; flex-shrink: 0;
          opacity: .85;
          transition: transform .3s cubic-bezier(.32,.72,0,1);
        }
        .sb-group.open .sb-section-icon { transform: rotate(90deg); }
        /* Closed is the resting state; a click opens one group at a time.
           The 0fr/1fr grid keeps the height animatable. */
        .sb-group-items {
          display: grid; grid-template-rows: 0fr; overflow: hidden;
          transition: grid-template-rows .34s cubic-bezier(.4,0,.2,1);
        }
        .sb-group.open > .sb-group-items,
        .sb-group.lead > .sb-group-items,
        .sb-group.bare > .sb-group-items { grid-template-rows: 1fr; }
        /* The rows animate the box; the content fades and slides with it, so the
           links don't appear pre-drawn behind a sliding edge. Closing runs the
           fade first (no delay), opening waits for the box to be underway. */
        .sb-group-inner {
          min-height: 0;
          opacity: 0; transform: translateY(-4px);
          transition: opacity .16s ease, transform .16s ease;
        }
        .sb-group.open > .sb-group-items > .sb-group-inner,
        .sb-group.lead > .sb-group-items > .sb-group-inner,
        .sb-group.bare > .sb-group-items > .sb-group-inner {
          opacity: 1; transform: none;
          transition: opacity .22s ease .08s, transform .26s cubic-bezier(.4,0,.2,1) .08s;
        }

        .sb-link {
          position: relative;
          display: flex; align-items: center; gap: 0;
          height: 46px; padding: 0; border-radius: 12px;
          font-size: 14px; font-weight: 500;
          color: #fff; text-decoration: none;
          margin-bottom: 2px;
          transition: background .16s, color .16s;
        }
        /* content-box padding makes the 20px glyph occupy a fixed 44px slot */
        .sb-link svg, .sb-section svg { width: 20px; height: 20px; flex: 0 0 auto; box-sizing: content-box; padding: 0 12px; }
        /* Links inside an opened section sit a step in and a size down. */
        .sb-group:not(.lead) .sb-link { height: 40px; font-size: 13px; color: rgba(255,255,255,0.9); }
        .sb-group:not(.lead) .sb-link svg { width: 16px; height: 16px; padding: 0 14px; }
        .sb-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .sb-link:hover { background: rgba(255,255,255,0.08); color: #fff; }
        .sb-link.active,
        .sb-group:not(.lead) .sb-link.active {
          background: rgba(255,255,255,0.16);
          color: #fff;
          font-weight: 600;
        }
        .sb-link-dot { width: 6px; height: 6px; border-radius: 50%; background: #fff; margin-left: auto; margin-right: 14px; flex-shrink: 0; opacity: 0; transition: opacity .15s; }
        .sb-group:not(.lead) .sb-link.active .sb-link-dot { opacity: 1; }

        /* Pending-approval count. Replaces the active dot when non-zero, so it
           occupies the same trailing slot and never shifts the label. A closed
           section shows the total of its links on its own row. */
        .sb-count {
          margin-left: auto; margin-right: 12px;
          flex-shrink: 0;
          min-width: 20px; height: 20px;
          padding: 0 6px;
          border-radius: 999px;
          background: #ef4444;
          color: #fff;
          font-size: 11px; font-weight: 650; line-height: 20px; letter-spacing: 0;
          text-align: center;
          font-variant-numeric: tabular-nums;
        }
        .sb-section .sb-count { margin-right: 6px; }
        .sb-section .sb-count + .sb-section-icon { margin-left: 0; }

        /* Footer */
        .sb-foot { padding: 14px; display: flex; flex-direction: column; gap: 6px; align-items: stretch; }
        .sb-logout {
          width: 100%; height: 48px; padding: 0; border-radius: 14px;
          background: transparent; border: 1px solid rgba(255,255,255,0.28);
          font-size: 14.5px; font-weight: 500; color: #fff;
          cursor: pointer; font-family: inherit;
          display: flex; align-items: center; justify-content: flex-start; gap: 0;
          transition: background .16s, color .16s, border-color .16s;
        }
        .sb-logout svg { width: 20px; height: 20px; flex: 0 0 auto; box-sizing: content-box; padding: 0 11px; }
        .sb-logout:hover { background: rgba(239,68,68,0.14); border-color: rgba(254,202,202,0.6); color: #fee2e2; }

        @media (min-width: 1024px) {
          .sb-overlay { display: none; }

          /* Rail is permanent. Hovering peeks it open over the page; clicking
             the edge strip pins it, and only then does the page shift. */
          .sb-panel { transform: none; width: 72px; }
          .sb-panel.pinned,
          .sb-panel:hover,
          .sb-panel:focus-within {
            width: 264px;
            box-shadow: 0 18px 50px rgba(0,0,0,.28);
          }
          /* Slower to peek than to close, so sweeping past does not trigger it. */
          .sb-panel:not(.pinned):hover { transition-delay: .12s; }
          .sb-panel.pinned { box-shadow: none; }

          .dl-shell { margin-left: 72px; }
          html[data-sb-pinned="1"] .dl-shell { margin-left: 264px; }

          /* Hover and the edge strip replace it here; it stays for the mobile drawer. */
          .dl-hamburger { display: none; }

          .sb-railstrip { display: block; }

          /* ── Collapsed rail: icons only, each centred on the 72px rail ── */
          .sb-panel:not(.pinned):not(:hover):not(:focus-within) .sb-head { gap: 0; }
          .sb-panel:not(.pinned):not(:hover):not(:focus-within) .sb-link-dot { display: none; }
          .sb-panel:not(.pinned):not(:hover):not(:focus-within) .sb-section-icon { opacity: 0; }

          /* Collapsed rail: the count stays, riding the icon's top-right. */
          .sb-panel:not(.pinned):not(:hover):not(:focus-within) .sb-count {
            position: absolute; top: 5px; left: 50%;
            margin: 0; transform: translateX(2px);
            min-width: 16px; height: 16px; padding: 0 4px;
            font-size: 10px; line-height: 16px;
            box-shadow: 0 0 0 2px #075ED6;
          }

          .sb-panel:not(.pinned):not(:hover):not(:focus-within) .sb-user {
            margin: 10px 13px 0; padding: 0; gap: 0;
            background: transparent;
            border-color: transparent;
          }

          .sb-panel:not(.pinned):not(:hover):not(:focus-within) .sb-nav::-webkit-scrollbar { width: 0; }
          .sb-panel:not(.pinned):not(:hover):not(:focus-within) .sb-logout { border-color: transparent; }
        }

        /* ── Motion ──────────────────────────────────────────────────
           Opening: the panel widens, then the text arrives.
           Closing: the text leaves first, then the panel narrows. */
        .sb-panel .sb-headtext,
        .sb-panel .sb-usertext,
        .sb-panel .sb-label,
        .sb-panel .sb-lead-label,
        .sb-panel .sb-link-dot {
          transition: opacity .22s ease .13s, transform .3s cubic-bezier(.32,.72,0,1) .13s;
        }
        @media (min-width: 1024px) {
          .sb-panel:not(.pinned):not(:hover):not(:focus-within) .sb-headtext,
          .sb-panel:not(.pinned):not(:hover):not(:focus-within) .sb-usertext,
          .sb-panel:not(.pinned):not(:hover):not(:focus-within) .sb-label,
          .sb-panel:not(.pinned):not(:hover):not(:focus-within) .sb-lead-label {
            display: block;
            opacity: 0;
            transform: translateX(-8px);
            pointer-events: none;
            transition: opacity .12s ease, transform .12s ease;
          }
        }

        /* ── Edge strip (rail) ── */
        .sb-railstrip {
          display: none;
          position: absolute; top: 0; bottom: 0; right: 0;
          width: 12px; padding: 0; border: 0;
          background: transparent; cursor: pointer;
          z-index: 1;
        }
        .sb-railstrip::after {
          content: "";
          position: absolute; top: 0; bottom: 0; left: 50%;
          width: 2px; margin-left: -1px; border-radius: 2px;
          background: transparent;
          transition: background .2s ease;
        }
        .sb-railstrip:hover::after { background: rgba(255,255,255,.28); }
        .sb-railstrip:focus-visible::after { background: #a5b4fc; }
        .sb-panel.pinned .sb-railstrip::after { background: rgba(255,255,255,.14); }

        @media (prefers-reduced-motion: reduce) {
          .sb-panel, .sb-head, .sb-user, .sb-nav, .sb-link, .sb-logout,
          .sb-label, .sb-headtext, .sb-usertext, .sb-link-dot,
          .sb-section, .sb-section-icon, .sb-group-items, .sb-group-inner, .dl-shell,
          .dl-burger span, .dl-hamburger, .sb-railstrip::after {
            transition-duration: .01ms !important;
            transition-delay: 0s !important;
          }
        }

        /* ── Mobile toggle: the bars fold into a close mark ── */
        .dl-hamburger { transition: background .15s ease, transform .18s ease; }
        .dl-hamburger:active { transform: scale(.94); }
        .dl-burger { position: relative; display: block; width: 17px; height: 12px; }
        .dl-burger span {
          position: absolute; left: 0; width: 100%; height: 2px;
          border-radius: 2px; background: currentColor;
          transition: transform .3s cubic-bezier(.65,.05,.36,1), opacity .18s ease;
        }
        .dl-burger span:nth-child(1) { top: 0; }
        .dl-burger span:nth-child(2) { top: 5px; }
        .dl-burger span:nth-child(3) { top: 10px; }
        .dl-hamburger[aria-expanded="true"] .dl-burger span:nth-child(1) { transform: translateY(5px) rotate(45deg); }
        .dl-hamburger[aria-expanded="true"] .dl-burger span:nth-child(2) { opacity: 0; transform: scaleX(.3); }
        .dl-hamburger[aria-expanded="true"] .dl-burger span:nth-child(3) { transform: translateY(-5px) rotate(-45deg); }
      `}</style>

      {/* Overlay — mobile only, the rail keeps the page reachable on wide screens */}
      <div
        className={`sb-overlay${open ? " show" : ""}`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <aside className={`sb-panel${open ? " open" : ""}${pinned ? " pinned" : ""}`}>

        {/* Head */}
        <div className="sb-head">
          <div className="sb-mark">
            <img src="/omsons_logo.jpeg" alt="Omsons" />
          </div>
          <div className="sb-headtext">
            <div className="sb-title">Workspace</div>
            <span className="sb-chip">{portal}</span>
          </div>
        </div>

        {/* User card */}
        <div className="sb-user">
          <div className="sb-avatar">
            {!mounted ? "…" : user?.ADMIN_IMAGE
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={user.ADMIN_IMAGE} alt="" />
              : getInitials(name)}
          </div>
          <div className="sb-usertext">
            <div className="sb-uname">
              {mounted ? (name ?? "Administrator") : "Loading…"}
            </div>
            <div className="sb-meta">
              {mounted ? meta : ""}
            </div>
            {mounted && badge && (
              <span className="sb-role">{badge}</span>
            )}
          </div>
        </div>

        <div className="sb-divider" />

        {/* Nav */}
        <nav className="sb-nav">
          {grouped.map((group, gi) => {
            const lead = gi === 0 && !!group.section;
            const isOpen = !lead && !!group.section && openSection === group.section;
            const groupCount = group.items.reduce((sum, item) => sum + (item.badgeKey ? badgeCounts[item.badgeKey] ?? 0 : 0), 0);
            return (
            <div key={gi} className={`sb-group${lead ? " lead" : ""}${isOpen ? " open" : ""}${group.section ? "" : " bare"}`}>
              {lead ? (
                <div className="sb-lead-label">{group.section}</div>
              ) : group.section ? (
                <button
                  type="button"
                  className="sb-section"
                  aria-expanded={isOpen}
                  onClick={() => setOpenSection(isOpen ? null : group.section!)}
                >
                  {SECTION_ICONS[group.section] ?? <FileText />}
                  <span className="sb-label">{group.section}</span>
                  {!isOpen && groupCount > 0 && (
                    <span className="sb-count" aria-label={`${groupCount} pending`}>{groupCount > 99 ? "99+" : groupCount}</span>
                  )}
                  <ChevronRight className="sb-section-icon" />
                </button>
              ) : null}
              <div className="sb-group-items">
                <div className="sb-group-inner">
                  {group.items.map(item => {
                    const active =
                      pathname === item.href ||
                      (item.href.length > 1 && pathname.startsWith(item.href));
                    const count = item.badgeKey ? badgeCounts[item.badgeKey] ?? 0 : 0;
                    return (
                      <Link
                        key={item.label}
                        href={item.href}
                        onClick={onClose}
                        className={`sb-link${active ? " active" : ""}`}
                      >
                        {item.icon}
                        <span className="sb-label">{item.label}</span>
                        {count > 0 ? (
                          <span className="sb-count" aria-label={`${count} pending`}>{count > 99 ? "99+" : count}</span>
                        ) : (
                          <span className="sb-link-dot" />
                        )}
                      </Link>
                    );
                  })}
                </div>
              </div>
            </div>
            );
          })}
        </nav>

        <div className="sb-divider" style={{ margin: "0 18px" }} />

        {/* Footer */}
        <div className="sb-foot">
          <button className="sb-logout" onClick={handleLogout} aria-label="Sign out">
            <LogOut />
            <span className="sb-label">Sign out</span>
          </button>
        </div>

        {/* Edge strip — click to pin the panel open, click again to release */}
        <button
          type="button"
          className="sb-railstrip"
          onClick={togglePin}
          aria-label={pinned ? "Unpin sidebar" : "Pin sidebar open"}
          aria-pressed={pinned}
          title={pinned ? "Unpin sidebar" : "Pin sidebar open"}
        />
      </aside>
    </>
  );
}
