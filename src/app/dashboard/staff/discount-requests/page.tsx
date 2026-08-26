"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Receipt, RefreshCw, ArrowLeft } from "lucide-react";

type StaffUser = {
  staff_id: string;
  staff_name: string;
  staff_email?: string;
  staff_designation?: string;
  staff_location?: string;
  role?: string;
  sales_region?: string;
};

type DiscountRequest = {
  id: string;
  dealerId: string;
  dealerName?: string;
  dealerCode?: string;
  dealerEmail?: string;
  staffId?: string;
  staffName?: string;
  dealerPhone?: string;
  requestedDiscountPercent: number;
  currentDiscountPercent: number;
  subtotal: number;
  currentDiscountAmount: number;
  requestedDiscountAmount: number;
  currentFinalPayable: number;
  requestedFinalPayable: number;
  discountScope?: "order" | "product";
  targetProduct?: {
    productKey?: string;
    productname?: string;
    displayName?: string;
    variantCode?: string;
  } | null;
  status: "pending" | "approved" | "rejected";
  rsmApprovalStatus?: "pending" | "approved" | "rejected" | "cancelled";
  rsmReviewedBy?: string;
  rsmReviewedAt?: string | null;
  rsmNote?: string;
  adminNote?: string;
  createdAt: string;
};

type TabKey = "awaiting" | "pending" | "approved" | "rejected" | "all";

const TABS: { key: TabKey; label: string; rsmOnly?: boolean }[] = [
  { key: "awaiting", label: "Awaiting my review", rsmOnly: true },
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Disapproved" },
  { key: "all", label: "All" },
];

function money(value: number) {
  return `Rs. ${Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function statusBadge(status: DiscountRequest["status"]) {
  if (status === "approved") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "rejected") return "border-red-200 bg-red-50 text-red-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

function statusLabel(status: DiscountRequest["status"]) {
  return status === "rejected" ? "Disapproved" : status[0].toUpperCase() + status.slice(1);
}

export default function StaffDiscountRequestsPage() {
  const router = useRouter();
  const [user, setUser] = useState<StaffUser | null>(null);
  const [isRsm, setIsRsm] = useState(false);
  const [requests, setRequests] = useState<DiscountRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<TabKey>("pending");
  const [updating, setUpdating] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem("staffData") || localStorage.getItem("UserData");
      if (!raw) {
        router.push("/auth/login");
        return;
      }
      const parsed = JSON.parse(raw);
      if (!parsed?.staff_id) {
        router.push("/auth/login");
        return;
      }
      setUser(parsed);
    } catch {
      router.push("/auth/login");
    }
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me", { credentials: "include", cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (cancelled) return;
        const rawRole = String(json?.data?.role ?? "").toLowerCase();
        setIsRsm(rawRole === "rsm");
        if (json?.data) setUser((prev) => (prev ? { ...prev, role: rawRole, sales_region: json.data.sales_region } : prev));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const staffId = user?.staff_id;
  const load = useCallback(async () => {
    if (!staffId) return;
    setLoading(true);
    setError("");
    try {
      // An RSM's scope is their region plus their reporting team, resolved
      // server-side; sending staff_id would narrow it back to their own.
      const query = isRsm
        ? "limit=200"
        : `staff_id=${encodeURIComponent(staffId)}&limit=200`;
      const res = await fetch(`/api/custom-discount-requests?${query}`, { credentials: "include", cache: "no-store" });
      const json = await res.json();
      if (!json.success) throw new Error(json.message ?? "Failed to load discount requests");
      setRequests(json.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load discount requests");
    } finally {
      setLoading(false);
    }
  }, [staffId, isRsm]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (isRsm) setTab("awaiting");
  }, [isRsm]);

  const review = async (request: DiscountRequest, rsmStatus: "approved" | "rejected") => {
    setUpdating(request.id);
    setError("");
    try {
      const res = await fetch(`/api/custom-discount-requests/${request.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          rsmStatus,
          rsmNote: (notes[request.id] ?? "").trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message ?? "Update failed");
      setRequests((prev) => prev.map((row) => (row.id === request.id ? { ...row, ...json.data } : row)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update request");
    } finally {
      setUpdating(null);
    }
  };

  const awaitingRsm = useMemo(
    () => requests.filter((r) => (r.rsmApprovalStatus ?? "pending") === "pending" && r.status === "pending"),
    [requests],
  );

  const stats = useMemo(() => ({
    all: requests.length,
    awaiting: awaitingRsm.length,
    pending: requests.filter((r) => r.status === "pending").length,
    approved: requests.filter((r) => r.status === "approved").length,
    rejected: requests.filter((r) => r.status === "rejected").length,
  }), [requests, awaitingRsm]);

  const visibleTabs = useMemo(() => TABS.filter((t) => !t.rsmOnly || isRsm), [isRsm]);

  const visibleRequests = useMemo(() => {
    if (tab === "all") return requests;
    if (tab === "awaiting") return awaitingRsm;
    return requests.filter((r) => r.status === tab);
  }, [requests, tab, awaitingRsm]);

  return (
    <div className="min-h-screen bg-gray-50 px-6 py-6" style={{ fontFamily: "'DM Sans','Helvetica Neue',sans-serif" }}>
      <div className="mx-auto max-w-[1840px] space-y-5">
        <div className="flex flex-col gap-4 border-b border-gray-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Link
              href="/dashboard/staff"
              className="mb-3 inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-gray-600 hover:bg-gray-100"
            >
              <ArrowLeft size={14} />
              Back to dashboard
            </Link>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
                <Receipt size={18} />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-gray-900">Discount Requests</h1>
                <p className="mt-1 text-sm text-gray-500">
                  {isRsm
                    ? `Review discount requests for your region${user?.sales_region ? ` (${user.sales_region})` : ""}. Your approval sends them to Admin.`
                    : "Read-only view of discount requests linked to your staff ID."}
                </p>
              </div>
            </div>
          </div>

          <button
            onClick={() => void load()}
            className="w-fit rounded-xl border border-gray-200 bg-white px-4 py-2 text-[13px] font-semibold text-gray-700 hover:bg-gray-100"
          >
            Refresh
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {visibleTabs.map((item) => {
            const active = tab === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setTab(item.key)}
                className={`rounded-2xl border px-4 py-3 text-left shadow-sm transition ${
                  active
                    ? "border-indigo-300 bg-indigo-50 ring-2 ring-indigo-200"
                    : "border-gray-200 bg-white hover:bg-gray-50"
                }`}
              >
                <p className={`text-[11px] font-bold uppercase tracking-wider ${active ? "text-indigo-500" : "text-gray-400"}`}>
                  {item.label}
                </p>
                <p className={`mt-1 font-mono text-xl font-bold ${active ? "text-indigo-700" : "text-gray-900"}`}>
                  {stats[item.key]}
                </p>
              </button>
            );
          })}
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
            {isRsm ? "No discount requests in this view for your region." : "No discount requests found for this staff member."}
          </div>
        ) : (
          <div className="space-y-4">
            {visibleRequests.map((request) => (
              <div key={request.id} className="rounded-2xl border border-gray-200 bg-white shadow-sm">
                <div className="flex flex-col gap-4 border-b border-gray-100 px-5 py-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-[16px] font-bold text-gray-900">{request.dealerName || "Dealer"}</h2>
                      <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${statusBadge(request.status)}`}>
                        {statusLabel(request.status)}
                      </span>
                      <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-[11px] font-bold text-indigo-700">
                        {(request.discountScope ?? "order") === "product" ? "Product discount" : "Order discount"}
                      </span>
                      {(request.rsmApprovalStatus ?? "pending") === "pending" && request.status === "pending" && (
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-bold text-amber-700">
                          Awaiting RSM
                        </span>
                      )}
                      {request.rsmApprovalStatus === "approved" && request.status === "pending" && (
                        <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 text-[11px] font-bold text-sky-700">
                          With Admin
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-gray-500">
                      <span>ID: {request.dealerId}</span>
                      {isRsm && request.staffName && (
                        <span className="font-semibold text-indigo-700">
                          Raised by: {request.staffName}
                          {request.staffId === user?.staff_id ? " (you)" : ""}
                        </span>
                      )}
                      {request.dealerCode && <span>Code: {request.dealerCode}</span>}
                      {request.dealerPhone && <span>{request.dealerPhone}</span>}
                      {request.dealerEmail && <span>{request.dealerEmail}</span>}
                    </div>
                    <p className="mt-2 text-[12px] text-gray-400">
                      Requested {request.createdAt ? new Date(request.createdAt).toLocaleString("en-IN") : "-"}
                    </p>
                    {(request.discountScope ?? "order") === "product" && (
                      <p className="mt-2 text-[12px] font-semibold text-indigo-700">
                        Applies to: {request.targetProduct?.displayName || request.targetProduct?.variantCode || request.targetProduct?.productname || "Selected product"}
                      </p>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div className="rounded-xl border border-gray-200 px-3 py-2">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Current</p>
                      <p className="mt-1 font-mono text-[14px] font-bold text-gray-900">{request.currentDiscountPercent}%</p>
                    </div>
                    <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-500">Requested</p>
                      <p className="mt-1 font-mono text-[14px] font-bold text-indigo-700">{request.requestedDiscountPercent}%</p>
                    </div>
                    <div className="rounded-xl border border-gray-200 px-3 py-2">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Current Amt</p>
                      <p className="mt-1 font-mono text-[14px] font-bold text-gray-900">{money(request.currentDiscountAmount)}</p>
                    </div>
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">Requested Amt</p>
                      <p className="mt-1 font-mono text-[14px] font-bold text-emerald-700">{money(request.requestedDiscountAmount)}</p>
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 px-5 py-4 lg:grid-cols-[1fr_340px]">
                  <div className="space-y-3">
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Subtotal</p>
                        <p className="mt-1 font-mono text-[13px] font-semibold text-gray-700">{money(request.subtotal)}</p>
                      </div>
                      <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Current Net</p>
                        <p className="mt-1 font-mono text-[13px] font-semibold text-gray-700">{money(request.currentFinalPayable)}</p>
                      </div>
                      <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Requested Net</p>
                        <p className="mt-1 font-mono text-[13px] font-semibold text-gray-700">{money(request.requestedFinalPayable)}</p>
                      </div>
                      <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Status</p>
                        <p className="mt-1 font-mono text-[13px] font-semibold text-gray-700">{statusLabel(request.status)}</p>
                      </div>
                    </div>
                  </div>

                  {(() => {
                    const rsmState = request.rsmApprovalStatus ?? "pending";
                    const canReview = isRsm && rsmState === "pending" && request.status === "pending";
                    if (!isRsm) {
                      return (
                        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Read Only</p>
                          <p className="mt-2 text-[12px] leading-5 text-gray-600">
                            This page is view-only for staff. Approval, rejection, note editing, and status changes remain admin-only.
                          </p>
                          <p className="mt-3 text-[12px] text-gray-500">
                            Created on {request.createdAt ? new Date(request.createdAt).toLocaleDateString("en-IN") : "-"}
                          </p>
                        </div>
                      );
                    }
                    return (
                      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">RSM Review</p>
                        {canReview ? (
                          <>
                            <p className="mt-2 text-[12px] leading-5 text-gray-600">
                              Approving forwards this request to Admin for final approval. Disapproving rejects it outright.
                            </p>
                            <textarea
                              value={notes[request.id] ?? ""}
                              onChange={(e) => setNotes((prev) => ({ ...prev, [request.id]: e.target.value }))}
                              placeholder="Note for the dealer (optional; used if you disapprove)"
                              rows={3}
                              className="mt-3 w-full rounded-lg border border-gray-200 px-3 py-2 text-[12px] text-gray-700 outline-none focus:border-indigo-300"
                            />
                            <div className="mt-3 flex gap-2">
                              <button
                                type="button"
                                disabled={updating === request.id}
                                onClick={() => void review(request, "approved")}
                                className="flex-1 rounded-lg bg-emerald-600 px-3 py-2 text-[12px] font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                              >
                                {updating === request.id ? "Saving..." : "Approve"}
                              </button>
                              <button
                                type="button"
                                disabled={updating === request.id}
                                onClick={() => void review(request, "rejected")}
                                className="flex-1 rounded-lg bg-red-600 px-3 py-2 text-[12px] font-bold text-white hover:bg-red-700 disabled:opacity-50"
                              >
                                {updating === request.id ? "Saving..." : "Disapprove"}
                              </button>
                            </div>
                          </>
                        ) : (
                          <>
                            <p className="mt-2 text-[12px] leading-5 text-gray-600">
                              {rsmState === "approved"
                                ? "You approved this request. It is now with Admin for final approval."
                                : rsmState === "rejected"
                                  ? "This request was disapproved at RSM review."
                                  : "RSM review is complete for this request."}
                            </p>
                            {request.rsmReviewedBy && (
                              <p className="mt-2 text-[12px] text-gray-500">
                                Reviewed by {request.rsmReviewedBy}
                                {request.rsmReviewedAt ? ` on ${new Date(request.rsmReviewedAt).toLocaleDateString("en-IN")}` : ""}
                              </p>
                            )}
                            {request.rsmNote && (
                              <p className="mt-2 text-[12px] text-gray-600">RSM note: {request.rsmNote}</p>
                            )}
                            {request.adminNote && (
                              <p className="mt-2 text-[12px] text-gray-600">Admin note: {request.adminNote}</p>
                            )}
                          </>
                        )}
                        <p className="mt-3 text-[12px] text-gray-500">
                          Created on {request.createdAt ? new Date(request.createdAt).toLocaleDateString("en-IN") : "-"}
                        </p>
                      </div>
                    );
                  })()}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
