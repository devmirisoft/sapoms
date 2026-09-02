"use client";

import React, { useState, useEffect } from "react";
import moment from "moment";
import { useInvoiceManager, Invoice } from "@/hooks/useInvoicemanager";
import { showToast } from "@/components/ui/toast";

interface InvoiceModalProps {
  isOpen:   boolean;
  onClose:  () => void;
  // Route params reach callers as string | string[] | undefined, so this is
  // widened rather than casting the lie away at each call site.
  dealerId?: string | number | null;
}

export function InvoiceModal({ isOpen, onClose, dealerId }: InvoiceModalProps) {
  const {
    invoices, isLoading, error,
    fetchInvoicesList, downloadStoredInvoice, removeInvoice,
  } = useInvoiceManager();

  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [searchQuery,     setSearchQuery    ] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Collapsed to one stable string so the effect's dependency list keeps a
  // constant size even while the caller's dealer id is still resolving.
  const scopedDealerId = dealerId == null ? "" : String(dealerId).trim();

  useEffect(() => {
    if (isOpen) {
      // Scope the list to the dealer whose ledger opened this modal; without it
      // an admin viewing one dealer sees every dealer's invoices.
      fetchInvoicesList(scopedDealerId);
      setSearchQuery("");
      setSelectedInvoice(null);
    }
  }, [isOpen, scopedDealerId, fetchInvoicesList]);

  if (!isOpen) return null;

  const filtered = invoices.filter(inv =>
    searchQuery === "" ||
    inv.invoiceNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
    inv.buyerName.toLowerCase().includes(searchQuery.toLowerCase())
  );


  const handleDownload = async (inv: Invoice) => {
    const res = await downloadStoredInvoice(inv);
    if (!res.success) showToast("error", res.error || "Download failed");
    else showToast("success", "Invoice downloaded");
  };

  const handleDelete = async () => {
    const inv = invoices.find(i => i.id === deleteConfirmId);
    if (!inv) return;
    const res = await removeInvoice(inv.id);
    if (res.success) { showToast("success", "Invoice deleted"); setDeleteConfirmId(null); }
    else showToast("error", res.error || "Delete failed");
  };

  return (
    <>
      {/* ── Main Modal ── */}
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
        onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      >
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[88vh] flex flex-col overflow-hidden">

          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gray-50">
            <div>
              <h2 className="text-[16px] font-bold text-gray-900">Invoices</h2>
              {!isLoading && (
                <p className="text-[12px] text-gray-500 mt-0.5">{filtered.length} invoice{filtered.length !== 1 ? "s" : ""}</p>
              )}
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-200 transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>

          {/* Search */}
          <div className="px-6 py-3 border-b border-gray-100 bg-white">
            <div className="relative max-w-sm">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
              </svg>
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search by invoice no. or dealer name…"
                className="pl-9 pr-4 py-2 w-full text-[13px] border border-gray-200 rounded-xl bg-gray-50 outline-none focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all placeholder:text-gray-400"
              />
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400">
                <div className="w-7 h-7 border-3 border-gray-200 border-t-indigo-500 rounded-full animate-spin" />
                <p className="text-[13px]">Loading invoices…</p>
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center py-16 gap-2 text-gray-400">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="1.5">
                  <circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/>
                </svg>
                <p className="text-[13px] text-red-600">{error}</p>
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-2 text-gray-400">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" strokeWidth="1.2">
                  <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>
                  <rect x="9" y="3" width="6" height="4" rx="1"/>
                </svg>
                <p className="text-[13px]">{searchQuery ? "No invoices match your search" : "No invoices yet"}</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 sticky top-0">
                    {["Invoice No.", "Dealer", "Date", "Net Amount", "Actions"].map(h => (
                      <th key={h} className={`px-6 py-3 text-[11px] font-bold uppercase tracking-wider text-gray-500 ${h === "Net Amount" || h === "Actions" ? "text-right" : "text-left"}`}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.map(inv => (
                    <tr key={inv.id} className="hover:bg-gray-50/60 transition-colors group">
                      <td className="px-6 py-4">
                        <p className="font-mono text-[13px] font-bold text-indigo-700">{inv.invoiceNumber}</p>
                        <p className="text-[11px] text-gray-400 mt-0.5 font-mono">{inv.orderNumber}</p>
                      </td>
                      <td className="px-6 py-4 text-[13px] text-gray-800 font-medium">{inv.buyerName || "—"}</td>
                      <td className="px-6 py-4 text-[13px] text-gray-600">
                        {moment(inv.invoiceDate).format("DD MMM YYYY")}
                        <p className="text-[11px] text-gray-400 mt-0.5">{moment(inv.createdAt).fromNow()}</p>
                      </td>
                      <td className="px-6 py-4 text-right font-mono text-[13px] font-semibold text-gray-900">
                        ₹{Number(inv.totalAmount).toLocaleString("en-IN")}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => setSelectedInvoice(inv)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-white border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 text-gray-600 hover:text-indigo-700 rounded-lg text-[11px] font-semibold transition-all"
                          >
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                            View
                          </button>
                          <button
                            onClick={() => handleDownload(inv)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-white border border-gray-200 hover:border-emerald-300 hover:bg-emerald-50 text-gray-600 hover:text-emerald-700 rounded-lg text-[11px] font-semibold transition-all"
                          >
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                            Download
                          </button>
                          <button
                            onClick={() => setDeleteConfirmId(inv.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-white border border-gray-200 hover:border-red-300 hover:bg-red-50 text-gray-600 hover:text-red-700 rounded-lg text-[11px] font-semibold transition-all"
                          >
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6m5 0V4h4v2"/></svg>
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-3 border-t border-gray-100 bg-gray-50 flex items-center justify-end">
            <button onClick={onClose} className="px-4 py-2 text-[13px] font-medium text-gray-700 hover:bg-gray-200 rounded-lg transition-colors">
              Close
            </button>
          </div>
        </div>
      </div>

      {/* ── Detail Modal ── */}
      {selectedInvoice && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40"
          onClick={e => { if (e.target === e.currentTarget) setSelectedInvoice(null); }}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <div>
                <h3 className="text-[15px] font-bold text-gray-900">{selectedInvoice.invoiceNumber}</h3>
                <p className="text-[12px] text-gray-500 mt-0.5">{selectedInvoice.buyerName}</p>
              </div>
              <button onClick={() => setSelectedInvoice(null)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
              </button>
            </div>

            <div className="px-6 py-5 grid grid-cols-2 gap-4">
              {[
                { label: "Invoice No.",  value: selectedInvoice.invoiceNumber  },
                { label: "Dealer",       value: selectedInvoice.buyerName      },
                { label: "Invoice Date", value: moment(selectedInvoice.invoiceDate).format("DD MMM YYYY") },
                { label: "Net Amount",   value: `₹${Number(selectedInvoice.totalAmount).toLocaleString("en-IN")}` },
                { label: "Created",      value: moment(selectedInvoice.createdAt).format("DD MMM YYYY  HH:mm") },
              ].map(f => (
                <div key={f.label}>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{f.label}</p>
                  <p className="text-[13px] font-semibold text-gray-900 mt-0.5">{f.value}</p>
                </div>
              ))}
            </div>

            <div className="px-6 pb-5 flex gap-2">
              <button
                onClick={() => { handleDownload(selectedInvoice); setSelectedInvoice(null); }}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-[13px] font-semibold transition-colors"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Download PDF
              </button>
              <a
                href={`${selectedInvoice.downloadUrl}&mode=inline`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-xl text-[13px] font-semibold transition-colors"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                Open in Browser
              </a>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Confirm ── */}
      {deleteConfirmId && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40"
          onClick={e => { if (e.target === e.currentTarget) setDeleteConfirmId(null); }}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center mb-4">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6m5 0V4h4v2"/></svg>
            </div>
            <h3 className="text-[15px] font-bold text-gray-900">Delete Invoice?</h3>
            <p className="text-[13px] text-gray-500 mt-1 mb-5">This will permanently remove the PDF and its record. Cannot be undone.</p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteConfirmId(null)} className="flex-1 py-2.5 border border-gray-200 rounded-xl text-[13px] font-medium text-gray-700 hover:bg-gray-50 transition-colors">Cancel</button>
              <button onClick={handleDelete} className="flex-1 py-2.5 bg-red-500 hover:bg-red-600 text-white rounded-xl text-[13px] font-semibold transition-colors">Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Toast ── */}
    </>
  );
}