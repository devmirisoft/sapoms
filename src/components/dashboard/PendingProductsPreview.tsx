"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Role = "admin" | "staff" | "dealer";

type DashboardActor = {
  role: Role;
  id: string;
  roletype?: string;
};

type PendingProductRow = {
  productKey: string;
  catalogueNumber: string;
  productName: string;
  category: string;
  orderedQuantity: number;
  dispatchedQuantity: number;
  pendingQuantity: number;
  fulfillmentPercent: number;
  pendingOrders: number;
  dealersAffected: number;
};

type PendingProductSummary = {
  productsPending: number;
  totalPendingUnits: number;
  ordersWithPendingItems: number;
  dealersAffected: number;
};

type PendingProductsPayload = {
  items: PendingProductRow[];
  summary: PendingProductSummary;
};

type ApiResponse = {
  success: boolean;
  data?: PendingProductsPayload;
  message?: string;
};

type PendingProductsPreviewProps = {
  role: Role;
  moreHref: string;
};

function resolveDashboardActor(expectedRole: Role): DashboardActor | null {
  if (typeof window === "undefined") return null;

  try {
    if (expectedRole === "dealer") {
      const userRaw = localStorage.getItem("UserData");
      if (userRaw) {
        const parsed = JSON.parse(userRaw);
        if (parsed?.Dealer_Id) {
          return { role: "dealer", id: String(parsed.Dealer_Id) };
        }
      }
      return null;
    }

    const staffRaw = localStorage.getItem("staffData");
    if (staffRaw) {
      const parsed = JSON.parse(staffRaw);
      if (parsed?.staff_id) {
        return {
          role: parsed.staff_roletype === "0" ? "admin" : "staff",
          id: String(parsed.staff_id),
          roletype: String(parsed.staff_roletype ?? ""),
        };
      }
    }

    const userRaw = localStorage.getItem("UserData");
    if (userRaw) {
      const parsed = JSON.parse(userRaw);
      if (parsed?.staff_id) {
        return {
          role: parsed.staff_roletype === "0" ? "admin" : "staff",
          id: String(parsed.staff_id),
          roletype: String(parsed.staff_roletype ?? ""),
        };
      }
    }

    const adminRaw = localStorage.getItem("AdminData") || localStorage.getItem("admin");
    if (adminRaw) {
      const parsed = JSON.parse(adminRaw);
      if (parsed && Object.keys(parsed).length > 0) {
        return {
          role: "admin",
          id: String(parsed.id || parsed.admin_id || parsed.Admin_Id || "admin"),
          roletype: "0",
        };
      }
    }
  } catch {}

  return null;
}

function buildActorHeaders(actor: DashboardActor): HeadersInit {
  return {};
}

function formatNumber(value: number) {
  return Number(value || 0).toLocaleString("en-IN");
}

function emptyText(role: Role) {
  if (role === "dealer") return "All products from your eligible orders are fully dispatched.";
  if (role === "staff") return "No products are pending for your assigned dealers.";
  return "No products are currently pending delivery.";
}

export default function PendingProductsPreview({ role, moreHref }: PendingProductsPreviewProps) {
  const [actor, setActor] = useState<DashboardActor | null>(() => resolveDashboardActor(role));
  const [payload, setPayload] = useState<PendingProductsPayload | null>(null);
  const [loading, setLoading] = useState(() => Boolean(resolveDashboardActor(role)));
  const [error, setError] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    const refreshActor = () => {
      setActor(resolveDashboardActor(role));
      setPayload(null);
      setError("");
    };
    window.addEventListener("storage", refreshActor);
    window.addEventListener("omsons-auth-changed", refreshActor);
    return () => {
      window.removeEventListener("storage", refreshActor);
      window.removeEventListener("omsons-auth-changed", refreshActor);
    };
  }, [role]);

  useEffect(() => {
    const handleDispatchUpdated = () => setRefreshToken((current) => current + 1);
    window.addEventListener("orderDispatchUpdated", handleDispatchUpdated);
    return () => window.removeEventListener("orderDispatchUpdated", handleDispatchUpdated);
  }, []);

  useEffect(() => {
    if (!actor) {
      return;
    }

    if (actor.role !== role) {
      return;
    }

    const controller = new AbortController();

    const params = new URLSearchParams({
      page: "1",
      pageSize: "5",
      sort: "pending_desc",
    });
    if (refreshToken > 0) params.set("refreshToken", String(refreshToken));

    fetch(`/api/pending-products?${params.toString()}`, {
      headers: buildActorHeaders(actor),
      signal: controller.signal,
    })
      .then(async (response) => {
        const json = (await response.json()) as ApiResponse;
        if (!response.ok || !json.success || !json.data) {
          throw new Error(json.message || "Unable to fetch pending orders.");
        }
        setPayload(json.data);
      })
      .catch((caught) => {
        if (controller.signal.aborted || (caught as Error).name === "AbortError") return;
        setError((caught as Error).message || "Unable to fetch pending orders.");
        setPayload(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort("component cleanup");
  }, [actor, role, refreshToken]);

  const cards = useMemo(() => {
    if (!payload) return [];
    return [
      ["Products Pending", formatNumber(payload.summary.productsPending)],
      ["Total Pending Units", formatNumber(payload.summary.totalPendingUnits)],
      [role === "dealer" ? "My Orders With Pending Products" : "Orders With Pending Products", formatNumber(payload.summary.ordersWithPendingItems)],
      [role === "staff" ? "Assigned Dealers Affected" : "Dealers Affected", formatNumber(payload.summary.dealersAffected)],
    ].filter(([label]) => role !== "dealer" || label !== "Dealers Affected");
  }, [payload, role]);

  return (
    <section style={{ background: "rgba(255,255,255,0.88)", border: "1px solid rgba(60,60,67,.075)", boxShadow: "0 1px 2px rgba(0,0,0,.02), 0 10px 34px rgba(0,0,0,.045)", backdropFilter: "saturate(180%) blur(20px)", borderRadius: 24, padding: 22, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 18, marginBottom: 18, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 16, lineHeight: 1.2, fontWeight: 680, letterSpacing: "-.022em", color: "#1d1d1f" }}>Pending Products</div>
          <div style={{ fontSize: 11.5, lineHeight: 1.35, color: "#6e6e73", marginTop: 4 }}>Product-wise delivery quantities from eligible orders</div>
        </div>
        <Link href={moreHref} style={{ color: "#007aff", fontSize: 11.5, fontWeight: 620, textDecoration: "none", whiteSpace: "nowrap" }}>
          View report &rarr;
        </Link>
      </div>

      {loading ? (
        <div style={{ color: "#8e8e93", fontSize: 12, padding: "22px 0" }}>Loading pending product data...</div>
      ) : error ? (
        <div style={{ color: "#b42318", background: "rgba(255,255,255,.8)", border: "1px solid rgba(255,59,48,.16)", borderRadius: 16, padding: "12px 14px", fontSize: 13 }}>{error}</div>
      ) : !payload || payload.items.length === 0 ? (
        <div style={{ border: "1px dashed rgba(60,60,67,.18)", borderRadius: 16, padding: "24px 16px", textAlign: "center", fontSize: 12, color: "#8e8e93" }}>
          {emptyText(role)}
        </div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 14, marginBottom: 16 }}>
            {cards.map(([label, value]) => (
              <div key={label} style={{ border: "1px solid rgba(60,60,67,.11)", borderRadius: 16, padding: "14px 16px" }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#6e6e73", letterSpacing: "-.005em" }}>{label}</div>
                <div style={{ marginTop: 10, fontSize: 26, lineHeight: 1, fontWeight: 700, letterSpacing: "-.045em", color: "#1d1d1f", fontVariantNumeric: "tabular-nums" }}>{value}</div>
              </div>
            ))}
          </div>

          <div style={{ display: "grid", gap: 10 }}>
            {payload.items.map((item) => (
              <div key={item.productKey} style={{ border: "1px solid rgba(60,60,67,.11)", borderRadius: 16, padding: "14px 16px", display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
                <div style={{ minWidth: 0, flex: "1 1 260px" }}>
                  <div style={{ fontSize: 12.5, fontWeight: 620, letterSpacing: "-.01em", color: "#1d1d1f" }}>{item.productName}</div>
                  <div style={{ fontSize: 10.5, color: "#8e8e93", marginTop: 4 }}>
                    {item.catalogueNumber || "No catalogue"} &middot; {item.category || "Uncategorized"}
                  </div>
                  <div style={{ fontSize: 11, color: "#6e6e73", marginTop: 6 }}>
                    {formatNumber(item.dispatchedQuantity)} of {formatNumber(item.orderedQuantity)} dispatched | {formatNumber(item.pendingOrders)} orders
                    {role !== "dealer" ? ` | ${formatNumber(item.dealersAffected)} dealers` : ""}
                  </div>
                </div>
                <div style={{ textAlign: "right", minWidth: 120 }}>
                  <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-.045em", color: "#ff3b30", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{formatNumber(item.pendingQuantity)}</div>
                  <div style={{ fontSize: 11, color: "#8e8e93", marginTop: 6, fontVariantNumeric: "tabular-nums" }}>{Math.min(100, Math.max(0, item.fulfillmentPercent))}% fulfilled</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
