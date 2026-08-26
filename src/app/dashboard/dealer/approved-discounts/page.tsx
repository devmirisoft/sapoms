"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  normalizeCustomDiscountRequestRecord,
  type NormalizedCustomDiscountRequest,
} from "@/lib/customDiscountRequests";

type TabKey = "pending" | "approved" | "rejected";
type DealerUser = {
  Dealer_Id: string;
};

function money(value: number) {
  return `Rs. ${Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function resolveDealer() {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem("UserData");
    const loggedIn = localStorage.getItem("status");
    if (!raw || JSON.parse(loggedIn ?? "false") !== true) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function statusBadge(status: string) {
  if (status === "approved") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "rejected") return "border-red-200 bg-red-50 text-red-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

function statusLabel(status: string) {
  if (status === "rejected") return "Rejected";
  if (status === "approved") return "Approved";
  return "Pending Approval";
}

function countPieces(request: NormalizedCustomDiscountRequest) {
  return request.orderSnapshot.products.reduce((sum, product) => sum + Number(product.totalPieces || 0), 0);
}

export default function ApprovedDiscountsPage() {
  const router = useRouter();
  const [dealer] = useState<DealerUser | null>(() => resolveDealer());
  const [requests, setRequests] = useState<NormalizedCustomDiscountRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<TabKey>("pending");

  useEffect(() => {
    if (!dealer?.Dealer_Id) {
      router.push("/login");
    }
  }, [dealer, router]);

  const loadRequests = useCallback(async () => {
    if (!dealer?.Dealer_Id) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/custom-discount-requests?dealer_id=${encodeURIComponent(dealer.Dealer_Id)}&limit=200`);
      const json = await res.json();
      if (!json.success) throw new Error(json.message ?? "Failed to load discount requests");
      setRequests((json.data ?? []).map(normalizeCustomDiscountRequestRecord));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load discount requests");
    } finally {
      setLoading(false);
    }
  }, [dealer]);

  useEffect(() => {
    if (!dealer?.Dealer_Id) return;
    queueMicrotask(() => {
      void loadRequests();
    });
  }, [dealer, loadRequests]);

  const stats = useMemo(() => ({
    pending: requests.filter((request) => request.normalizedStatus === "pending").length,
    approved: requests.filter((request) => request.normalizedStatus === "approved").length,
    rejected: requests.filter((request) => request.normalizedStatus === "rejected").length,
  }), [requests]);

  const visibleRequests = useMemo(() => (
    requests.filter((request) => request.normalizedStatus === tab)
  ), [requests, tab]);

  return (
    <div className="min-h-screen bg-gray-50 px-6 py-6" style={{ fontFamily: "'DM Sans','Helvetica Neue',sans-serif" }}>
      <div className="mx-auto max-w-[1840px] space-y-5">
        <div className="flex flex-col gap-4 border-b border-gray-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <button
              onClick={() => router.back()}
              className="mb-3 inline-flex items-center rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-gray-600 hover:bg-gray-100"
            >
              Back
            </button>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">Approved Discounts</h1>
            <p className="mt-1 text-sm text-gray-500">Track pending, approved, and rejected full-order discount requests.</p>
          </div>

          <button
            onClick={loadRequests}
            className="w-fit rounded-xl border border-gray-200 bg-white px-4 py-2 text-[13px] font-semibold text-gray-700 hover:bg-gray-100"
          >
            Refresh
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {[
            { key: "pending", label: "Pending Approval", value: stats.pending },
            { key: "approved", label: "Approved", value: stats.approved },
            { key: "rejected", label: "Rejected", value: stats.rejected },
          ].map((item) => (
            <button
              key={item.key}
              onClick={() => setTab(item.key as TabKey)}
              className={`rounded-2xl border px-4 py-3 text-left transition-colors ${
                tab === item.key ? "border-indigo-300 bg-indigo-50" : "border-gray-200 bg-white hover:bg-gray-50"
              }`}
            >
              <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">{item.label}</p>
              <p className="mt-1 font-mono text-xl font-bold text-gray-900">{item.value}</p>
            </button>
          ))}
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex min-h-[260px] items-center justify-center rounded-2xl border border-gray-200 bg-white text-sm text-gray-500">
            Loading discount requests...
          </div>
        ) : visibleRequests.length === 0 ? (
          <div className="flex min-h-[260px] items-center justify-center rounded-2xl border border-gray-200 bg-white text-sm text-gray-500">
            No {statusLabel(tab).toLowerCase()} requests found.
          </div>
        ) : (
          <div className="space-y-4">
            {visibleRequests.map((request) => {
              const totalPieces = countPieces(request);
              const productCount = request.orderSnapshot.products.length;
              return (
                <div key={request.id} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${statusBadge(request.normalizedStatus)}`}>
                          {statusLabel(request.normalizedStatus)}
                        </span>
                        <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-[11px] font-bold text-indigo-700">
                          {request.discountScope === "product" ? "Product Discount" : "Order Discount"}
                        </span>
                        {request.isLegacySnapshot && (
                          <span className="rounded-full border border-gray-200 bg-gray-100 px-2.5 py-0.5 text-[11px] font-bold text-gray-600">
                            Legacy Request
                          </span>
                        )}
                      </div>
                      <div>
                        <p className="text-[16px] font-bold text-gray-900">
                          Request Ref. {request.requestReference || request.id}
                        </p>
                        <p className="mt-1 text-[12px] text-gray-500">
                          Submitted {request.createdAt ? new Date(request.createdAt).toLocaleString("en-IN") : "-"}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-gray-500">
                        <span>{productCount} products</span>
                        <span>{totalPieces} pieces</span>
                        {request.shipto && <span className="max-w-[420px] truncate">Ship To: {request.shipto}</span>}
                      </div>
                      {request.rsmNote && (
                        <p className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-[12px] text-gray-700">
                          RSM note: {request.rsmNote}
                        </p>
                      )}
                      {request.adminNote && (
                        <p className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-[12px] text-gray-700">
                          Admin note: {request.adminNote}
                        </p>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {request.normalizedStatus === "pending" && (
                        <button
                          type="button"
                          disabled
                          className="rounded-xl border border-amber-300 bg-amber-500 px-4 py-2 text-[12px] font-bold text-white cursor-not-allowed"
                        >
                          Wait for Approval
                        </button>
                      )}
                      {request.normalizedStatus === "approved" && (
                        <button
                          onClick={() => router.push(`/dashboard/dealer/AddOrderForm?reorder=${request.id}`)}
                          disabled={!request.allowReorder}
                          className="rounded-xl bg-emerald-600 px-4 py-2 text-[12px] font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500"
                        >
                          Use Approved Order
                        </button>
                      )}
                      {request.normalizedStatus === "rejected" && request.rejectionDraftId && (
                        <button
                          onClick={() => router.push(`/dashboard/dealer/AddOrderForm?draft=${request.rejectionDraftId}`)}
                          className="rounded-xl border border-red-200 bg-white px-4 py-2 text-[12px] font-bold text-red-600 hover:bg-red-50"
                        >
                          Open Rejected Draft
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
                    <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Gross Amount</p>
                      <p className="mt-1 font-mono text-[14px] font-bold text-gray-900">{money(request.orderSnapshot.grossAmount)}</p>
                    </div>
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-amber-700">Base Discount</p>
                      <p className="mt-1 font-mono text-[14px] font-bold text-amber-700">{money(request.orderSnapshot.baseDiscountAmount)}</p>
                    </div>
                    <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-600">Requested Custom</p>
                      <p className="mt-1 font-mono text-[14px] font-bold text-indigo-700">{money(request.orderSnapshot.requestedAdditionalDiscountAmount)}</p>
                    </div>
                    <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Requested Total Discount</p>
                      <p className="mt-1 font-mono text-[14px] font-bold text-gray-900">{money(request.orderSnapshot.totalDiscountAmount)}</p>
                    </div>
                    <div className="rounded-xl border border-gray-900 bg-gray-900 px-4 py-3 text-white">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-white/60">Requested Net Payable</p>
                      <p className="mt-1 font-mono text-[14px] font-bold">{money(request.orderSnapshot.requestedNetPayableAmount)}</p>
                    </div>
                    <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Requested Discount</p>
                      <p className="mt-1 font-mono text-[14px] font-bold text-gray-900">
                        {request.requestedOrderDiscountPercent ?? request.requestedDiscountPercent}%
                      </p>
                    </div>
                  </div>

                  <details className="mt-4 overflow-hidden rounded-xl border border-gray-200" open>
                    <summary className="cursor-pointer list-none bg-gray-50 px-4 py-3 text-[12px] font-bold text-gray-700">
                      Product List ({productCount} products)
                    </summary>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-white">
                          <tr className="border-b border-gray-100">
                            {["Cat. No.", "Product", "Qty", "Pack Size", "Pieces", "Unit Price", "Gross", "Base", "Requested Custom", "Final"].map((header) => (
                              <th key={header} className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-gray-400">
                                {header}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {request.orderSnapshot.products.map((product, index) => (
                            <tr key={`${request.id}-${product.productKey || product.sku}-${index}`}>
                              <td className="px-3 py-3 font-mono text-[12px] font-bold text-amber-700">{product.catalogueNumber || product.sku || "-"}</td>
                              <td className="px-3 py-3">
                                <p className="text-[12px] font-semibold text-gray-900">{product.productName || "-"}</p>
                                <div className="mt-1 flex flex-wrap gap-1.5">
                                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${product.usesCustomDiscount ? "border-indigo-200 bg-indigo-50 text-indigo-700" : "border-gray-200 bg-gray-100 text-gray-600"}`}>
                                    {product.usesCustomDiscount ? "Custom Approval Requested" : "Standard Discount"}
                                  </span>
                                  {product.isPriority && (
                                    <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-700">
                                      Priority
                                    </span>
                                  )}
                                </div>
                                {product.productNote && (
                                  <p className="mt-1 text-[11px] text-gray-500">Product Note: {product.productNote}</p>
                                )}
                              </td>
                              <td className="px-3 py-3 font-mono text-[12px] text-gray-700">{product.quantity}</td>
                              <td className="px-3 py-3 font-mono text-[12px] text-gray-700">{product.packSize}</td>
                              <td className="px-3 py-3 font-mono text-[12px] text-gray-700">{product.totalPieces}</td>
                              <td className="px-3 py-3 font-mono text-[12px] text-gray-700">{money(product.unitPrice)}</td>
                              <td className="px-3 py-3 font-mono text-[12px] text-gray-900">{money(product.grossAmount)}</td>
                              <td className="px-3 py-3 font-mono text-[12px] text-amber-700">
                                {product.baseDiscountPercent}% · -{money(product.baseDiscountAmount)}
                              </td>
                              <td className="px-3 py-3 font-mono text-[12px] text-indigo-700">
                                {product.usesCustomDiscount
                                  ? `${product.requestedCustomDiscountPercent ?? 0}% · -${money(product.requestedCustomDiscountAmount ?? 0)}`
                                  : "Standard Discount"}
                              </td>
                              <td className="px-3 py-3 font-mono text-[12px] font-bold text-emerald-700">{money(product.finalAmount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>

                  {(request.orderSnapshot.orderNote || request.shipto || request.refno) && (
                    <div className="mt-4 grid gap-3 md:grid-cols-3">
                      <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Order Note</p>
                        <p className="mt-1 whitespace-pre-wrap text-[12px] text-gray-700">{request.orderSnapshot.orderNote || "-"}</p>
                      </div>
                      <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Ship To</p>
                        <p className="mt-1 whitespace-pre-wrap text-[12px] text-gray-700">{request.shipto || "-"}</p>
                      </div>
                      <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Customer Ref No.</p>
                        <p className="mt-1 whitespace-pre-wrap text-[12px] text-gray-700">{request.refno || "-"}</p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
