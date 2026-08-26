"use client";

import { useEffect, useMemo, useState } from "react";
import {
  canUserEditDispatch,
  DISPATCH_MUTATION_STATUSES,
  DISPATCH_STATUS_LABELS,
  isAcceptedOrderForDispatch,
  isDeletedOrderForDispatch,
  type DispatchStatus,
  type DispatchUserSession,
  type OrderDispatchRecord,
} from "@/lib/orderDispatch";

type DispatchPanelItem = {
  orderItemId?: string | null;
  orderedQuantity?: number;
  dispatchedQuantity?: number;
  remainingQuantity?: number;
  dispatchStatus?: DispatchStatus;
  dispatchHistory?: OrderDispatchRecord["updates"];
  occurrence?: number;
  orderdata_id?: string;
  orderdata_cat_no?: string;
  product_name?: string;
  product_discription?: string;
  remark?: string;
  remarks?: string;
  fallbackProductNote?: string;
};

type ResolvedDispatchPanelItem = DispatchPanelItem & {
  orderedQuantity: number;
  dispatchedQuantity: number;
  remainingQuantity: number;
  dispatchStatus: DispatchStatus;
  dispatchHistory: OrderDispatchRecord["updates"];
  occurrence: number;
};

type Props = {
  isOpen: boolean;
  orderId: string;
  dealerId?: string;
  assignedStaffId?: string | null;
  acceptOrder?: string | null;
  delStatus?: string | null;
  items: DispatchPanelItem[];
  currentUser: DispatchUserSession | null;
  selectedItemId: string | null;
  onClose: () => void;
  onRecordSaved: (record: OrderDispatchRecord) => void;
};

type FormState = {
  dispatchQuantity: string;
  status: DispatchStatus | "";
  remark: string;
};

const REMARK_LIMIT = 500;

function buildAuthHeaders(user: DispatchUserSession | null): HeadersInit {
  return {
    "Content-Type": "application/json",


  };
}

function statusSelectLabel(status: DispatchStatus) {
  return DISPATCH_STATUS_LABELS[status];
}

function originalRemarks(item: DispatchPanelItem | null) {
  if (!item) return "";
  return [item.remark, item.remarks].filter(Boolean).join(" | ");
}

function initialStatus(item: DispatchPanelItem): DispatchStatus {
  return Number(item.remainingQuantity ?? 0) === 0 ? "successful" : "packing";
}

function normalizeSelectedItem(item: DispatchPanelItem): ResolvedDispatchPanelItem {
  return {
    ...item,
    orderedQuantity: Number(item.orderedQuantity ?? 0),
    dispatchedQuantity: Number(item.dispatchedQuantity ?? 0),
    remainingQuantity: Number(item.remainingQuantity ?? 0),
    dispatchStatus: item.dispatchStatus ?? "pending",
    dispatchHistory: Array.isArray(item.dispatchHistory) ? item.dispatchHistory : [],
    occurrence: Number(item.occurrence ?? 1) || 1,
  };
}

function DispatchPanelDialog({
  orderId,
  dealerId,
  assignedStaffId,
  acceptOrder,
  delStatus,
  selectedItem,
  currentUser,
  onClose,
  onRecordSaved,
  onSaved,
}: {
  orderId: string;
  dealerId?: string;
  assignedStaffId?: string | null;
  acceptOrder?: string | null;
  delStatus?: string | null;
  selectedItem: ResolvedDispatchPanelItem;
  currentUser: DispatchUserSession | null;
  onClose: () => void;
  onRecordSaved: (record: OrderDispatchRecord) => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<FormState>({
    dispatchQuantity: "",
    status: initialStatus(selectedItem),
    remark: "",
  });
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const canEdit = canUserEditDispatch(currentUser, {
    dealerId,
    assignedStaffId,
    acceptOrder,
    delStatus,
  });
  const isAccepted = isAcceptedOrderForDispatch(acceptOrder);
  const isDeleted = isDeletedOrderForDispatch(delStatus);

  const isPartiallyDispatched = selectedItem.dispatchStatus !== "not_in_stock"
    && selectedItem.dispatchedQuantity > 0
    && selectedItem.remainingQuantity > 0;
  const statusSummary = isPartiallyDispatched ? "Partially Dispatched" : statusSelectLabel(selectedItem.dispatchStatus);
  const noteText = String(selectedItem.fallbackProductNote ?? "").trim();
  const remarksText = originalRemarks(selectedItem);
  const submitDisabled = !canEdit || submitting;

  const handleChange = (field: keyof FormState, value: string) => {
    if (field === "remark" && value.length > REMARK_LIMIT) return;
    setForm((previous) => ({ ...previous, [field]: value }));
    setFormError("");
  };

  const handleSubmit = async () => {
    const dispatchQuantity = Number(form.dispatchQuantity);
    const trimmedRemark = form.remark.trim();

    if (!canEdit) {
      setFormError("You do not have permission to update dispatch details for this order.");
      return;
    }
    if (!form.dispatchQuantity.trim() || !Number.isFinite(dispatchQuantity) || !Number.isInteger(dispatchQuantity)) {
      setFormError("Dispatch Quantity must be a valid whole number.");
      return;
    }
    if (dispatchQuantity <= 0) {
      setFormError("Dispatch Quantity must be greater than zero.");
      return;
    }
    if (dispatchQuantity > selectedItem.remainingQuantity) {
      setFormError("Dispatch Quantity cannot exceed the currently remaining quantity.");
      return;
    }
    if (!form.status) {
      setFormError("Please choose a dispatch status.");
      return;
    }
    if (!trimmedRemark) {
      setFormError("Operational Remark is required.");
      return;
    }

    setSubmitting(true);
    setFormError("");

    try {
      const response = await fetch("/api/order-dispatch", {
        method: "POST",
        headers: buildAuthHeaders(currentUser),
        body: JSON.stringify({
          orderId,
          orderItemId: selectedItem.orderItemId ?? selectedItem.orderdata_id ?? undefined,
          sku: selectedItem.orderdata_cat_no ?? "",
          occurrence: selectedItem.occurrence,
          dealerId,
          assignedStaffId,
          orderedQuantity: selectedItem.orderedQuantity,
          dispatchQuantity,
          status: form.status,
          remark: trimmedRemark,
          acceptOrder,
          delStatus,
          legacyReadyQuantity: selectedItem.dispatchedQuantity,
          legacyStatus: selectedItem.dispatchStatus,
        }),
      });

      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.success || !json?.data) {
        setFormError(json?.message || "Failed to save dispatch update.");
        return;
      }

      onRecordSaved(json.data as OrderDispatchRecord);
      onSaved();
      window.dispatchEvent(new CustomEvent("orderDispatchUpdated", {
        detail: {
          orderId,
          orderItemId: selectedItem.orderItemId ?? selectedItem.orderdata_id ?? null,
        },
      }));
      onClose();
    } catch {
      setFormError("Failed to save dispatch update.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/25 p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-5xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-slate-200 px-6 py-5">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Dispatch Details</p>
            <h2 className="mt-1 text-[20px] font-bold text-slate-900">
              {selectedItem.product_name || selectedItem.orderdata_cat_no || "Product line"}
            </h2>
            <p className="mt-1 text-[13px] text-slate-500">
              Order ID: {orderId} · Line ID: {selectedItem.orderItemId || selectedItem.orderdata_id || "fallback"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
            aria-label="Close dispatch panel"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="grid max-h-[calc(90vh-96px)] grid-cols-1 gap-0 overflow-y-auto lg:grid-cols-[1.05fr_0.95fr]">
          <div className="border-b border-slate-200 p-6 lg:border-b-0 lg:border-r">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Catalogue</p>
                <p className="mt-1 font-mono text-[13px] font-semibold text-amber-700">{selectedItem.orderdata_cat_no || "-"}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Ordered</p>
                <p className="mt-1 font-mono text-[15px] font-bold text-slate-900">{selectedItem.orderedQuantity}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Dispatched</p>
                <p className="mt-1 font-mono text-[15px] font-bold text-emerald-700">{selectedItem.dispatchedQuantity}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Remaining</p>
                <p className="mt-1 font-mono text-[15px] font-bold text-rose-600">{selectedItem.remainingQuantity}</p>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-slate-200 p-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Current Status</p>
              <p className="mt-1 text-[14px] font-semibold text-slate-900">{statusSummary}</p>
              {selectedItem.product_discription && (
                <>
                  <p className="mt-4 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Specification</p>
                  <p className="mt-1 text-[13px] leading-6 text-slate-700">{selectedItem.product_discription}</p>
                </>
              )}
              {noteText && (
                <>
                  <p className="mt-4 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Product Note</p>
                  <p className="mt-1 text-[13px] leading-6 text-slate-700">{noteText}</p>
                </>
              )}
              {remarksText && (
                <>
                  <p className="mt-4 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Original Order Remarks</p>
                  <p className="mt-1 text-[13px] leading-6 text-slate-700">{remarksText}</p>
                </>
              )}
            </div>

            <div className="mt-4 rounded-2xl border border-slate-200">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Dispatch History</p>
                  <p className="mt-1 text-[13px] text-slate-500">
                    {selectedItem.dispatchHistory.length} update{selectedItem.dispatchHistory.length === 1 ? "" : "s"}
                  </p>
                </div>
              </div>

              {selectedItem.dispatchHistory.length === 0 ? (
                <div className="px-4 py-6 text-[13px] text-slate-500">No dispatch updates yet.</div>
              ) : (
                <div className="max-h-[320px] overflow-auto">
                  <table className="w-full border-collapse text-left">
                    <thead>
                      <tr className="border-b border-slate-100 bg-slate-50">
                        {["S.No.", "Dispatch Quantity", "Status", "Operational Remark", "Updated By", "Role", "Date/Time"].map((label) => (
                          <th key={label} className="px-4 py-3 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {selectedItem.dispatchHistory.map((entry, index) => (
                        <tr key={entry.id} className="border-b border-slate-100 align-top last:border-b-0">
                          <td className="px-4 py-3 font-mono text-[11px] text-slate-500">{String(index + 1).padStart(2, "0")}</td>
                          <td className="px-4 py-3 font-mono text-[12px] font-semibold text-slate-900">{entry.quantity}</td>
                          <td className="px-4 py-3 text-[12px] font-semibold text-indigo-700">{statusSelectLabel(entry.status)}</td>
                          <td className="px-4 py-3 text-[12px] leading-5 text-slate-700">{entry.remark}</td>
                          <td className="px-4 py-3 text-[12px] text-slate-600">{entry.actorId}</td>
                          <td className="px-4 py-3 text-[12px] capitalize text-slate-600">{entry.actorRole}</td>
                          <td className="px-4 py-3 text-[11px] text-slate-500">
                            {new Date(entry.createdAt).toLocaleString("en-IN")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          <div className="p-6">
            <div className="rounded-2xl border border-slate-200 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">
                    {canEdit ? "Add Dispatch Detail" : "Dispatch Summary"}
                  </p>
                  <p className="mt-1 text-[13px] text-slate-500">
                    {canEdit
                      ? "Dispatch Quantity is incremental for this update only."
                      : "This order can be viewed, but dispatch updates are not allowed for your current access."}
                  </p>
                </div>
                {!canEdit && (
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold text-slate-500">
                    Read only
                  </span>
                )}
              </div>

              <div className="mt-5 space-y-4">
                <div>
                  <label htmlFor="dispatch-quantity" className="mb-1.5 block text-[12px] font-semibold text-slate-700">
                    Dispatch Quantity
                  </label>
                  <input
                    id="dispatch-quantity"
                    type="number"
                    min="1"
                    step="1"
                    value={form.dispatchQuantity}
                    onChange={(event) => handleChange("dispatchQuantity", event.target.value)}
                    disabled={submitDisabled}
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-[13px] text-slate-900 outline-none transition focus:border-indigo-300"
                  />
                </div>

                <div>
                  <label htmlFor="dispatch-status" className="mb-1.5 block text-[12px] font-semibold text-slate-700">
                    Status
                  </label>
                  <select
                    id="dispatch-status"
                    value={form.status}
                    onChange={(event) => handleChange("status", event.target.value)}
                    disabled={submitDisabled}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[13px] text-slate-900 outline-none transition focus:border-indigo-300"
                  >
                    <option value="">Select status</option>
                    {DISPATCH_MUTATION_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {statusSelectLabel(status)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <label htmlFor="dispatch-remark" className="block text-[12px] font-semibold text-slate-700">
                      Operational Remark
                    </label>
                    <span className="text-[11px] font-medium text-slate-400">
                      {form.remark.length}/{REMARK_LIMIT}
                    </span>
                  </div>
                  <textarea
                    id="dispatch-remark"
                    rows={5}
                    maxLength={REMARK_LIMIT}
                    value={form.remark}
                    onChange={(event) => handleChange("remark", event.target.value)}
                    disabled={submitDisabled}
                    className="w-full resize-none rounded-2xl border border-slate-200 px-4 py-3 text-[13px] leading-6 text-slate-900 outline-none transition focus:border-indigo-300"
                    placeholder="Add the operational dispatch remark"
                  />
                </div>

                {!isAccepted && (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-700">
                    Dispatch updates are blocked until this order is accepted.
                  </div>
                )}

                {isDeleted && (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[12px] text-rose-700">
                    Dispatch updates are blocked for deleted or declined orders.
                  </div>
                )}

                {formError && (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[12px] text-rose-700">
                    {formError}
                  </div>
                )}

                <div className="flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[13px] font-semibold text-slate-600 transition hover:bg-slate-50"
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={submitDisabled}
                    className="rounded-2xl bg-slate-900 px-4 py-3 text-[13px] font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {submitting ? "Saving..." : "Save Dispatch Update"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ProductDispatchPanel({
  isOpen,
  orderId,
  dealerId,
  assignedStaffId,
  acceptOrder,
  delStatus,
  items,
  currentUser,
  selectedItemId,
  onClose,
  onRecordSaved,
}: Props) {
  const [successText, setSuccessText] = useState("");

  const selectedItem = useMemo(
    () => {
      const rawItem = items.find((item) => item.orderItemId === selectedItemId || item.orderdata_id === selectedItemId);
      return rawItem ? normalizeSelectedItem(rawItem) : null;
    },
    [items, selectedItemId]
  );

  useEffect(() => {
    if (!successText) return;
    const timeout = window.setTimeout(() => setSuccessText(""), 2500);
    return () => window.clearTimeout(timeout);
  }, [successText]);

  if (!isOpen || !selectedItem) {
    return successText ? (
      <div className="fixed bottom-4 right-4 z-[90] rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] font-semibold text-emerald-700 shadow-lg">
        {successText}
      </div>
    ) : null;
  }

  return (
    <>
      {successText && (
        <div className="fixed bottom-4 right-4 z-[90] rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] font-semibold text-emerald-700 shadow-lg">
          {successText}
        </div>
      )}

      <DispatchPanelDialog
        key={selectedItem.orderItemId ?? selectedItem.orderdata_id ?? selectedItem.occurrence}
        orderId={orderId}
        dealerId={dealerId}
        assignedStaffId={assignedStaffId}
        acceptOrder={acceptOrder}
        delStatus={delStatus}
        selectedItem={selectedItem}
        currentUser={currentUser}
        onClose={onClose}
        onRecordSaved={onRecordSaved}
        onSaved={() => setSuccessText("Dispatch details updated.")}
      />
    </>
  );
}
