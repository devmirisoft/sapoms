import { useState, useCallback } from "react";
import {
  generateOrderInvoicePDF,
  uploadOrderInvoice,
  listInvoices,
  deleteInvoice,
  downloadOrderInvoice,
  OrderInvoiceData,
  InvoiceResult,
} from "@/lib/invoicegenerator";

// Matches the StoredInvoice shape returned by /api/invoices. The PDF is not
// reachable by URL: downloadUrl points at the authenticated download route.
export interface Invoice {
  id:            string;
  invoiceNumber: string;
  orderNumber:   string;
  dealerId:      string;
  buyerName:     string;
  invoiceDate:   string;
  totalAmount:   number;
  fileName:      string;
  downloadUrl:   string;
  createdAt:     string;
}

export function useInvoiceManager() {
  const [isLoading, setIsLoading] = useState(false);
  const [error,     setError    ] = useState<string | null>(null);
  const [invoices,  setInvoices ] = useState<Invoice[]>([]);

  /** Generate PDF from order data and upload it to cloud storage */
  const generateAndUpload = useCallback(async (order: OrderInvoiceData): Promise<InvoiceResult> => {
    setIsLoading(true);
    setError(null);
    try {
      const blob   = await generateOrderInvoicePDF(order);
      const result = await uploadOrderInvoice(blob, order);
      if (!result.success) setError(result.error || "Upload failed");
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(msg);
      return { success: false, message: msg, error: msg };
    } finally {
      setIsLoading(false);
    }
  }, []);

  /** Download invoice PDF directly to device */
  const downloadInvoicePDF = useCallback(async (order: OrderInvoiceData): Promise<InvoiceResult> => {
    return downloadOrderInvoice(order);
  }, []);

  /** Fetch the invoice list the current actor is allowed to see */
  const fetchInvoicesList = useCallback(async (_dealerId?: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await listInvoices(_dealerId || "", 100);
      if (result.success) {
        setInvoices(result.data as Invoice[]);
      } else {
        setError(result.error || "Failed to load invoices");
      }
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(msg);
      return { success: false, message: msg, error: msg, data: [] };
    } finally {
      setIsLoading(false);
    }
  }, []);

  /** Download an already-stored invoice through the authenticated route */
  const downloadStoredInvoice = useCallback(async (invoice: Invoice): Promise<InvoiceResult> => {
    try {
      const response = await fetch(invoice.downloadUrl, { credentials: "include", cache: "no-store" });
      if (!response.ok) throw new Error("Failed to fetch file");
      const blob = await response.blob();
      const url  = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href     = url;
      link.download = invoice.fileName || `${invoice.invoiceNumber.replace(/\//g, "-")}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      return { success: true, message: "Downloaded" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(msg);
      return { success: false, message: "Download failed", error: msg };
    }
  }, []);

  /** Delete an invoice (soft-deletes the record, releases the stored PDF) */
  const removeInvoice = useCallback(async (invoiceId: string): Promise<InvoiceResult> => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await deleteInvoice(invoiceId);
      if (result.success) {
        setInvoices(prev => prev.filter(inv => inv.id !== invoiceId));
      } else {
        setError(result.error || "Delete failed");
      }
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(msg);
      return { success: false, message: msg, error: msg };
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    isLoading,
    error,
    invoices,
    generateAndUpload,
    downloadInvoicePDF,
    fetchInvoicesList,
    downloadStoredInvoice,
    removeInvoice,
  };
}