/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/set-state-in-effect */
// app/order/page.tsx
"use client";

import React, { useState, useEffect, useRef, useMemo, Suspense } from "react";
import axios from "axios";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { toast, ToastContainer } from "react-toastify";
import moment from "moment";
import Select, { components, type FilterOptionOption, type StylesConfig } from "react-select";
import { useCartStore } from "@/Store/store";
import { fetchDealerStatus } from "@/lib/dealerStatus";
import discountUtils from "@/lib/discount";
import { createIdempotencyKey } from "@/lib/idempotency";
import { formatDisplayOrderNumber } from "@/lib/orderDisplay";
import {
  buildCatalogueIndex,
  findCatalogueEntry,
  getCatalogueProductDescriptor,
  getCatalogueProductLabel,
  getCatalogueSection,
  getVariantLabel,
  type CatalogueIndex,
  type CatalogueProduct,
  type CatalogueVariant,
} from "@/lib/catalogue";
import { loadCatalogueProducts } from "@/lib/catalogueClient";
import {
  saveDraft,
  updateDraft,
  type DraftProductRow,
} from "@/lib/drafts";
import {
  buildDraftApprovalState,
  buildOrderApprovalSnapshot,
  findLatestRequestForDraft,
  normalizeApprovalProductKey,
  normalizeCustomDiscountRequestRecord,
  type DraftApprovalState,
  type NormalizedCustomDiscountRequest,
} from "@/lib/customDiscountRequests";
import { useDraft } from "@/lib/useDrafts";
import { buildPriorityRemarks } from "@/lib/orderPriority";
import cataloguePricing from "@/lib/cataloguePricing";
import {
  buildOrderRemarks as buildLineRemarks,
} from "@/lib/orderProductNotes.mjs";
const { calculateStackedDiscount, getDiscountStatusMessage } = discountUtils;

// ─── Types ────────────────────────────────────────────────────────────────────
type ProductRow = {
  key: number;
  productname: string;
  displayName: string;
  variantCode: string;
  producQuanity: number;
  price: number; // rupees per unit
  baseListPrice?: number; // rupees per pack, derived as catalogue unit price * pack size
  packSize: number;
  isPriority?: boolean;
  productNote?: string;
  catalogueSection?: string;
  catalogueProductSku?: string;
  catalogueVariantSku?: string;
};

type CustomDiscountScope = "order" | "product";

type WalletSnapshot = {
  status: "active" | "inactive";
  availableBalance: number;
  totalConsumed: number;
  transactions: Array<{ id: string; type: string; amount: number; createdAt?: string }>;
};

type CustomDiscountRequest = {
  id: string;
  dealerId?: string;
  staffId?: string;
  assignedStaffId?: string;
  status: "pending" | "approved" | "rejected";
  orderId?: string;
  order_id?: string;
  orderNumber?: string;
  order_number?: string;
  orderDraftId?: string;
  order_draft_id?: string;
  discountScope?: CustomDiscountScope;
  requestedDiscountPercent: number;
  currentDiscountPercent: number;
  requestedOrderDiscountPercent?: number | null;
  requestedProductDiscounts?: Record<string, number>;
  orderSignature: string;
  allowReorder?: boolean;
  targetProduct?: {
    productKey?: string;
    productname?: string;
    displayName?: string;
    variantCode?: string;
  };
  products?: any[];
  orderSnapshot?: Record<string, unknown>;
  draftProducts?: any[];
  shipto?: string;
  refno?: string;
  orderNote?: string;
  adminNote?: string;
  rejectionDraftId?: string;
  createdAt?: string;
  reviewedAt?: string | null;
};

// ─── Product meta from nested_products.json ───────────────────────────────────
type ProductMeta = { image: string | null; productName: string; packSize: number };

type CatalogueNumberOption = {
  value: string;
  label: string;
  searchSku: string;
  searchText: string;
  productName: string;
  descriptor: string;
  specSummary: string;
};

function buildVariantLookup(data: any[]): Record<string, ProductMeta> {
  const map: Record<string, ProductMeta> = {};
  for (const product of data) {
    const image = (product.images ?? product.Images ?? []).find(Boolean) ?? null;
    const desc = product.Description ?? product.descriptionHtml ?? "";
    const packMap = parsePackSizes(desc);
    for (const variant of product.variants ?? []) {
      const sku = variant.SKU ?? variant.sku;
      const variantImage = (variant.images ?? variant.Images ?? []).find(Boolean) ?? image;
      map[sku] = { image: variantImage, productName: product.name ?? product.Name, packSize: packMap[sku] ?? variant.pack ?? 1 };
    }
  }
  return map;
}

function parsePackSizes(html: string): Record<string, number> {
  const result: Record<string, number> = {};
  if (!html) return result;
  const theadMatch = html.match(/<thead>([\s\S]*?)<\/thead>/i);
  if (!theadMatch) return result;
  const headers = [...theadMatch[1].matchAll(/<td>([\s\S]*?)<\/td>/gi)]
    .map(m => m[1].replace(/<[^>]*>/g, "").trim());
  const packIdx = headers.findIndex(h => /pack|qty|quantity/i.test(h));
  if (packIdx === -1) return result;
  const tbodyMatch = html.match(/<tbody>([\s\S]*?)<\/tbody>/i);
  if (!tbodyMatch) return result;
  [...tbodyMatch[1].matchAll(/<tr>([\s\S]*?)<\/tr>/gi)].forEach(tr => {
    const cells = [...tr[1].matchAll(/<td>([\s\S]*?)<\/td>/gi)]
      .map(m => m[1].replace(/<[^>]*>/g, "").trim());
    const catNo = cells[0];
    const n = parseInt(cells[packIdx] ?? "1", 10);
    if (catNo) result[catNo] = isNaN(n) ? 1 : n;
  });
  return result;
}

/** Format paise → ₹ string */
function fmt(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function toPaise(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.round(amount * 100);
}

function payloadAmount(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return "0";
  return String(Math.round((amount + Number.EPSILON) * 100) / 100);
}

const ORDER_DETAILS_FALLBACK_STORAGE_KEY = "omsons.orderDetailsFallback.v1";

function saveLocalOrderDetailsFallback(orderId: string, fallback: Record<string, unknown>) {
  if (typeof window === "undefined" || !orderId) return;
  try {
    const raw = localStorage.getItem(ORDER_DETAILS_FALLBACK_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const records = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
    localStorage.setItem(ORDER_DETAILS_FALLBACK_STORAGE_KEY, JSON.stringify({
      ...records,
      [orderId]: {
        ...fallback,
        orderId,
        order_id: orderId,
        savedAt: new Date().toISOString(),
      },
    }));
  } catch {}
}

function roundRupees(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function safePositiveNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function cartPriceToRupees(rawPrice: unknown, apiPrice: unknown = 0): number {
  const cartPrice = safePositiveNumber(rawPrice);
  const fallbackPrice = safePositiveNumber(apiPrice);
  if (!cartPrice) return fallbackPrice;
  // Cart prices are stored as paise per individual unit.
  return roundRupees(cartPrice / 100);
}

async function fetchWithSessionRefresh(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, { credentials: "include", ...init });
  if (response.status !== 401) return response;

  const refresh = await fetch("/api/auth/refresh", {
    method: "POST",
    credentials: "include",
    cache: "no-store",
  });
  if (!refresh.ok) return response;

  return fetch(input, { credentials: "include", ...init });
}

function mergeCatalogueSources(primaryProducts: CatalogueProduct[], fallbackProducts: CatalogueProduct[]) {
  const merged = new Map<string, CatalogueProduct>();

  for (const product of fallbackProducts) {
    const key = String(product.sku || product.id || "").trim();
    if (key) merged.set(key, product);
  }

  for (const product of primaryProducts) {
    const key = String(product.sku || product.id || "").trim();
    if (key) merged.set(key, product);
  }

  return Array.from(merged.values());
}

function rowSubtotalPaise(row: ProductRow): number {
  const quantity = safePositiveNumber(row.producQuanity);
  const packSize = safePositiveNumber(row.packSize) || 1;
  const price = safePositiveNumber(row.price);
  const baseListPrice = safePositiveNumber(row.baseListPrice) || (packSize * price);
  return Math.max(0, Math.round(quantity * baseListPrice * 100));
}

function rowBaseListPrice(row: ProductRow): number {
  const packSize = safePositiveNumber(row.packSize) || 1;
  return safePositiveNumber(row.baseListPrice) || (packSize * safePositiveNumber(row.price));
}

function hashString(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function buildOrderSignature(rows: ProductRow[], subtotalAmount: number): string {
  const items = rows
    .filter((r) => r.productname)
    .map((r) => ({
      productname: r.productname,
      quantity: safePositiveNumber(r.producQuanity),
      price: safePositiveNumber(r.price),
      packSize: safePositiveNumber(r.packSize) || 1,
      priority: !!r.isPriority,
    }));
  return hashString(JSON.stringify({ subtotal: payloadAmount(subtotalAmount), items }));
}

function getProductKey(row: ProductRow): string {
  return String(row.variantCode || row.productname || "").trim();
}

function buildProductSignature(row: ProductRow): string {
  return buildOrderSignature([row], rowSubtotalPaise(row) / 100);
}

function buildOrderRemarks(
  variantCode: string,
  isPriority: boolean | undefined,
  orderNote: string,
): string {
  return buildLineRemarks(
    buildPriorityRemarks(variantCode, isPriority),
    orderNote,
  );
}

function extractOrderIdFromResponse(data: any): string {
  const candidates = [
    data?.order_id,
    data?.orderId,
    data?.Order_Id,
    data?.OrderID,
    data?.id,
    data?.lastid,
    data?.last_id,
    data?.data?.order_id,
    data?.data?.orderId,
    data?.data?.id,
    Array.isArray(data?.data) ? data.data[0]?.order_id : undefined,
  ];
  const direct = candidates.find((v) => v !== undefined && v !== null && String(v).trim());
  if (direct) return String(direct).trim();

  const msg = String(data?.msg || data?.message || "");
  return msg.match(/OM\/\d{4}\/(\d+)/i)?.[1] || msg.match(/order\s*(?:id|no\.?)?\s*#?\s*(\d+)/i)?.[1] || "";
}

function buildExpectedOrderNumber(lastOrderId: string | undefined | null): string {
  const raw = String(lastOrderId ?? "").trim();
  const lastPart = raw.split("/").pop() ?? "";
  const digits = (lastPart.match(/\d+/g)?.join("") ?? "").trim();
  const lastNumber = digits ? parseInt(digits, 10) : 0;
  const nextNumber = (Number.isFinite(lastNumber) ? lastNumber : 0) + 1;
  return formatDisplayOrderNumber(String(nextNumber));
}

// ─── Coupons ──────────────────────────────────────────────────────────────────
const COUPONS: Record<string, number> = {
  "test60": 60,
  "SAVE50": 50,
  "VIP80": 80,
};


type PhpExchangeLog = {
  method: "GET" | "POST";
  url: string;
  request?: unknown;
  response?: unknown;
  error?: unknown;
};

function readFormData(fd: FormData): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  fd.forEach((value, key) => {
    const parsedValue = value instanceof File
      ? {
        fileName: value.name,
        fileSize: value.size,
        fileType: value.type,
        lastModified: value.lastModified,
      }
      : parseLogValue(value);

    if (Object.prototype.hasOwnProperty.call(result, key)) {
      const existing = result[key];
      result[key] = Array.isArray(existing) ? [...existing, parsedValue] : [existing, parsedValue];
      return;
    }

    result[key] = parsedValue;
  });

  return result;
}

function parseLogValue(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return value;
  if (!["{", "["].includes(trimmed[0])) return value;

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function getAxiosDebugError(error: unknown) {
  if (axios.isAxiosError(error)) {
    const responseData = error.response?.data;
    const normalizedResponse =
      responseData === undefined || responseData === null
        ? undefined
        : typeof responseData === "string"
          ? responseData
          : Array.isArray(responseData)
            ? responseData
            : typeof responseData === "object"
              ? (Object.keys(responseData).length > 0 ? responseData : "Empty error response object")
              : responseData;

    return {
      message: error.message,
      code: error.code,
      status: error.response?.status,
      statusText: error.response?.statusText,
      response: normalizedResponse,
    };
  }

  return error instanceof Error ? { message: error.message } : error;
}

function logPhpExchange(label: string, details: PhpExchangeLog) {
  console.groupCollapsed(`[PHP backend] ${label}`);
  console.info("method", details.method);
  console.info("url", details.url);
  if (details.request !== undefined) console.info("sending to PHP", details.request);
  if (details.response !== undefined) console.info("received from PHP", details.response);
  if (details.error !== undefined) console.error("PHP request failed", details.error);
  console.groupEnd();
}

// ─── Empty row factory ────────────────────────────────────────────────────────
const emptyRow = (): ProductRow => ({
  key: Date.now() + Math.random(),
  productname: "",
  displayName: "",
  variantCode: "",
  producQuanity: 1,
  price: 0,
  packSize: 1,
  isPriority: false,
  productNote: "",
});

// ─────────────────────────────────────────────────────────────────────────────
// Inner component — uses useSearchParams so must live inside <Suspense>
// ─────────────────────────────────────────────────────────────────────────────
function AddOrderPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const draftIdParam = searchParams.get("draft");
  const reorderIdParam = searchParams.get("reorder");

  const cartItems = useCartStore((s) => s.cart);
  const clearCart = useCartStore((s) => s.clearCart);

  const fromCart = searchParams.get("from") === "cart";

  const [loading, setLoading] = useState(false);
  const [draftSaving, setDraftSaving] = useState(false);
  const [reorderLoading, setReorderLoading] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [wallet, setWallet] = useState<WalletSnapshot | null>(null);
  const [walletLoading, setWalletLoading] = useState(false);
  const orderIdempotencyKey = useRef<string | null>(null);
  const [products, setProducts] = useState<any[]>([]);
  const [catalogueIndex, setCatalogueIndex] = useState<CatalogueIndex<CatalogueProduct> | null>(null);
  const [variantLookup, setVariantLookup] = useState<Record<string, ProductMeta>>({});
  const [shipto, setShipto] = useState("");
  const [refno, setRefno] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [tab, setTab] = useState<"manual" | "excel">("manual");
  const [expectedOrderNumber, setExpectedOrderNumber] = useState("");
  const [expectedOrderLoading, setExpectedOrderLoading] = useState(false);
  const seededRef = useRef(false);

  // ── Draft state ───────────────────────────────────────────────────────────
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("Untitled Draft");
  const [showNameModal, setShowNameModal] = useState(false);
  const [pendingDraftName, setPendingDraftName] = useState("");
  const [draftBanner, setDraftBanner] = useState<string | null>(null);
  const [draftApprovalState, setDraftApprovalState] = useState<DraftApprovalState | null>(null);

  // ── Coupon state ──────────────────────────────────────────────────────────
  const [couponInput, setCouponInput] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState<{ code: string; pct: number } | null>(null);
  const [couponError, setCouponError] = useState("");
  const [couponSuccess, setCouponSuccess] = useState("");

  // ── Order note + custom discount approval ────────────────────────────────
  const [orderNote, setOrderNote] = useState("");
  const [showCustomDiscountEditor, setShowCustomDiscountEditor] = useState(false);
  const [customDiscountInput, setCustomDiscountInput] = useState("");
  const [customDiscountScope, setCustomDiscountScope] = useState<CustomDiscountScope>("order");
  const [customDiscountProductKey, setCustomDiscountProductKey] = useState("");
  const [customDiscountSubmitting, setCustomDiscountSubmitting] = useState(false);
  const [customDiscountRequests, setCustomDiscountRequests] = useState<CustomDiscountRequest[]>([]);
  const [reorderRequest, setReorderRequest] = useState<NormalizedCustomDiscountRequest | null>(null);
  const [perProductDiscountInputs, setPerProductDiscountInputs] = useState<Record<string, number>>({});
  const [editingProductDiscountKey, setEditingProductDiscountKey] = useState<string | null>(null);
  const [perProductSubmitting, setPerProductSubmitting] = useState<string | null>(null);
  const [openRowMenuKey, setOpenRowMenuKey] = useState<number | null>(null);
  const [noteEditorRowKey, setNoteEditorRowKey] = useState<number | null>(null);

  const [arr1, setArr] = useState<ProductRow[]>([emptyRow()]);

  const ensureDealerIsActive = async () => {
    if (!user?.Dealer_Id) {
      throw new Error("Dealer account is missing.");
    }

    const dealerStatus = await fetchDealerStatus(String(user.Dealer_Id));
    if (dealerStatus === "inactive") {
      throw new Error("This dealer account is inactive. Please contact the administrator.");
    }
  };

  const syncDraftUrl = (draftId?: string | null) => {
    const nextUrl = draftId
      ? `/dashboard/dealer/AddOrderForm?draft=${encodeURIComponent(draftId)}`
      : "/dashboard/dealer/AddOrderForm";
    window.history.replaceState({}, "", nextUrl);
  };

  const mergeCustomDiscountRequest = (request: CustomDiscountRequest | null | undefined) => {
    if (!request?.id) return;
    setCustomDiscountRequests((prev) => [request, ...prev.filter((row) => row.id !== request.id)]);
  };

  const buildCurrentDraftRows = (): DraftProductRow[] => arr1.map((row) => ({ ...row }));

  const buildRequestedProductDiscountMap = () => {
    const globalPercent = approvedCustomDiscountPercent ?? baseDiscountPayload.baseDiscountPercent;
    const requested: Record<string, number> = {};

    productRows.forEach((row) => {
      const rawKey = getProductKey(row);
      const normalizedKey = normalizeApprovalProductKey(rawKey);
      const requestedPercent = Number(perProductDiscountInputs[rawKey] ?? perProductDiscountInputs[normalizedKey] ?? 0);
      if (requestedPercent > globalPercent) {
        requested[normalizedKey] = Math.min(100, Math.max(globalPercent, requestedPercent));
      }
    });

    if (customDiscountScope === "product" && selectedCustomDiscountProduct && requestedCustomDiscountPercent > globalPercent) {
      requested[normalizeApprovalProductKey(getProductKey(selectedCustomDiscountProduct))] = requestedCustomDiscountPercent;
    }

    return requested;
  };

  const addSelectedCustomProductDiscount = () => {
    if (!selectedCustomDiscountProduct) {
      toast("Select a product first.");
      return;
    }

    const globalPercent = approvedCustomDiscountPercent ?? baseDiscountPayload.baseDiscountPercent;
    if (requestedCustomDiscountPercent <= globalPercent) {
      toast(`Enter a product discount above the current ${globalPercent}%.`);
      return;
    }

    const productKey = getProductKey(selectedCustomDiscountProduct);
    setPerProductDiscountInputs((prev) => ({
      ...prev,
      [productKey]: requestedCustomDiscountPercent,
      [normalizeApprovalProductKey(productKey)]: requestedCustomDiscountPercent,
    }));
  };

  const removeCustomProductDiscount = (productKey: string) => {
    setPerProductDiscountInputs((prev) => {
      const next = { ...prev };
      delete next[productKey];
      delete next[normalizeApprovalProductKey(productKey)];
      return next;
    });
  };

  const buildCurrentApprovalState = (overrides?: Partial<DraftApprovalState>) => {
    const requestedProductDiscounts = buildRequestedProductDiscountMap();
    const requestedOrderDiscountPercent = customDiscountScope === "order" && requestedCustomDiscountPercent > baseDiscountPayload.baseDiscountPercent
      ? requestedCustomDiscountPercent
      : null;

    return buildDraftApprovalState({
      approvalRequestId: draftApprovalState?.approvalRequestId ?? null,
      status: draftApprovalState?.status ?? null,
      requestedOrderDiscountPercent,
      requestedProductDiscounts,
      updatedAt: new Date().toISOString(),
      ...overrides,
    });
  };

  const buildCurrentOrderSnapshot = (options?: {
    requestedOrderDiscountPercent?: number | null;
    requestedProductDiscounts?: Record<string, number>;
  }) => {
    const snapshotProducts = productRows.map((row) => {
      const variantKey = row.variantCode || row.productname;
      const meta = variantLookup[variantKey] ?? variantLookup[row.productname];
      return {
        rowKey: row.key,
        productKey: getProductKey(row),
        sku: row.variantCode || row.productname,
        catalogueNumber: row.variantCode || row.productname,
        productName: row.displayName || meta?.productName || row.productname,
        image: meta?.image ?? null,
        quantity: safePositiveNumber(row.producQuanity) || 1,
        packSize: safePositiveNumber(row.packSize) || 1,
        unitPrice: safePositiveNumber(row.price),
        isPriority: !!row.isPriority,
        productNote: row.productNote ?? "",
      };
    });

    return buildOrderApprovalSnapshot({
      products: snapshotProducts,
      orderNote: orderNote.trim(),
      baseDiscountPercent: baseDiscountPayload.baseDiscountPercent,
      requestedOrderDiscountPercent: options?.requestedOrderDiscountPercent ?? null,
      requestedProductDiscounts: options?.requestedProductDiscounts,
    });
  };

  const persistCurrentDraft = async (nameToUse: string, approvalState: DraftApprovalState | null) => {
    const payload = {
      dealer_id: user.Dealer_Id,
      name: nameToUse,
      shipto,
      refno,
      order_note: orderNote.trim() || null,
      coupon_code: appliedCoupon?.code ?? null,
      coupon_pct: appliedCoupon?.pct ?? null,
      approval_state: approvalState,
      rows: buildCurrentDraftRows(),
    };

    if (activeDraftId) {
      try {
        await updateDraft(activeDraftId, user.Dealer_Id, payload);
        setDraftName(nameToUse);
        if (approvalState) setDraftApprovalState(approvalState);
        return activeDraftId;
      } catch (error) {
        // The draft this form is pinned to can disappear underneath it (deleted
        // in another tab, or converted to an order), and updateDraft then 404s.
        // Falling back to a create keeps the dealer's edits instead of dropping
        // them; anything else (403, network) is a real failure worth surfacing.
        const missing = error instanceof Error && /not found/i.test(error.message);
        if (!missing) throw error;
      }
    }

    const created = await saveDraft(payload);
    setActiveDraftId(created.id);
    setDraftName(nameToUse);
    setDraftApprovalState(created.approval_state ?? approvalState);
    syncDraftUrl(created.id);
    return created.id;
  };

  useEffect(() => {
    const stored = localStorage.getItem("UserData");
    const loggedIn = localStorage.getItem("status");
    if (!stored || JSON.parse(loggedIn ?? "false") !== true) { router.push("/login"); return; }
    const u = JSON.parse(stored);
    setUser(u);
    setShipto(u.Dealer_Address[0].toUpperCase() + u.Dealer_Address.slice(1).toLowerCase());
  }, [router]);

  // useEffect(() => {
  //   if (!user) return;
  //   Promise.all([
  //     fetch(`${BACKEND_URL}/productname`).then(r => r.json()),
  //     loadCatalogueProducts(),
  //   ]).then(([apiData, localData]) => {
  //     setProducts(apiData.data ?? []);
  //     setCatalogueIndex(buildCatalogueIndex(localData ?? []));
  //     setVariantLookup(buildVariantLookup(localData));
  //   }).catch(() => {
  //     fetch(`${BACKEND_URL}/productname`)
  //       .then(r => r.json()).then(d => setProducts(d.data ?? []));
  //   });
  // }, [user]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const loadProducts = async () => {
      try {
        const [apiResult, localProducts] = await Promise.all([
          fetchWithSessionRefresh("/api/products", { cache: "no-store" })
            .then(async (response) => {
              if (!response.ok) throw new Error("PRODUCTS_UNAVAILABLE");
              const apiData = await response.json();
              return Array.isArray(apiData.data) ? apiData.data as CatalogueProduct[] : [];
            })
            .catch((error) => {
              console.error("[AddOrderForm] failed to load PostgreSQL products", error);
              return [] as CatalogueProduct[];
            }),
          loadCatalogueProducts().catch((error) => {
            console.error("[AddOrderForm] failed to load local catalogue products", error);
            return [] as CatalogueProduct[];
          }),
        ]);

        if (cancelled) return;

        const catalogueProducts = mergeCatalogueSources(apiResult, localProducts);
        const rows = catalogueProducts.flatMap((product: any) =>
          (product.variants ?? []).map((variant: any) => ({
            product_id: product.id,
            variant_id: variant.id,
            product_name: product.name,
            product_cat: variant.catalogueNumber || variant.sku,
            product_price: variant.price,
            product_quantity: variant.packSize || variant.pack || 1,
            product_unit: variant.unitName || "",
            active: product.active !== false && variant.active !== false,
          }))
        );

        setProducts(rows);
        setCatalogueIndex(buildCatalogueIndex(catalogueProducts));
        setVariantLookup(buildVariantLookup(catalogueProducts));
      } catch (error) {
        if (cancelled) return;
        console.error("[AddOrderForm] failed to prepare products", error);
        setProducts([]);
        setCatalogueIndex(null);
        setVariantLookup({});
      }
    };

    void loadProducts();

    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (!user?.Dealer_Id) return;
    fetch(`/api/custom-discount-requests?dealer_id=${encodeURIComponent(user.Dealer_Id)}&limit=200`)
      .then((r) => r.json())
      .then((json) => {
        if (json.success) setCustomDiscountRequests(json.data ?? []);
      })
      .catch(() => { });
  }, [user?.Dealer_Id]);

  // ── Load draft from ?draft=<id> (via React Query cache) ────────────────────
  const { data: cachedDraft, isError: draftError } = useDraft(
    user?.Dealer_Id,
    draftIdParam
  );

  useEffect(() => {
    if (!reorderIdParam || !user || products.length === 0) return;
    if (seededRef.current) return;

    setReorderLoading(true);
    fetch(`/api/custom-discount-requests/${encodeURIComponent(reorderIdParam)}`, {
      headers: {
        "x-omsons-actor-role": "dealer",
        "x-omsons-actor-id": String(user.Dealer_Id),
      },
    })
      .then((r) => {
        if (r.status === 404) throw new Error("NOT_FOUND");
        if (!r.ok) throw new Error("NETWORK");
        return r.json();
      })
      .then((json) => {
        if (!json.success) throw new Error("API_FAIL");
        const req = normalizeCustomDiscountRequestRecord(json.data as CustomDiscountRequest);

        if (String(req.dealerId) !== String(user.Dealer_Id)) throw new Error("WRONG_DEALER");
        if (!req.allowReorder) throw new Error("REVOKED");
        if (req.normalizedStatus !== "approved") throw new Error("NOT_APPROVED");

        const rows: ProductRow[] = (req.orderSnapshot.products || []).map((p, i) => {
          const match = products.find(
            (prod: any) => String(prod.product_cat).trim() === String(p.sku || p.catalogueNumber).trim()
          );
          return {
            key: i + 1,
            productname: p.sku || p.catalogueNumber || match?.product_cat || "",
            displayName: p.productName || match?.product_name || p.sku || p.catalogueNumber || "",
            variantCode: p.catalogueNumber || p.sku || match?.product_cat || "",
            producQuanity: safePositiveNumber(p.quantity) || 1,
            price: safePositiveNumber(p.unitPrice) || safePositiveNumber(match?.product_price),
            packSize: safePositiveNumber(p.packSize) || 1,
            isPriority: !!p.isPriority,
            productNote: String(p.productNote ?? ""),
          };
        });

        seededRef.current = true;
        setReorderRequest(req);
        setActiveDraftId(req.orderDraftId || null);
        setDraftApprovalState(buildDraftApprovalState({
          approvalRequestId: req.id,
          status: req.normalizedStatus === "approved" ? "approved" : null,
          requestedOrderDiscountPercent: req.requestedOrderDiscountPercent,
          requestedProductDiscounts: req.requestedProductDiscounts,
          updatedAt: req.reviewedAt || req.createdAt,
        }));
        setCustomDiscountScope(req.discountScope);
        setCustomDiscountInput(String(req.requestedOrderDiscountPercent ?? ""));
        setPerProductDiscountInputs(req.requestedProductDiscounts);
        setArr(rows.length > 0 ? rows : [emptyRow()]);
        if (req.shipto) setShipto(req.shipto);
        if (req.refno) setRefno(req.refno);
        if (req.orderSnapshot.orderNote) setOrderNote(req.orderSnapshot.orderNote);
        setDraftBanner(null);
      })
      .catch((err) => {
        seededRef.current = true;
        const messages: Record<string, string> = {
          NOT_FOUND: "This discount request no longer exists.",
          WRONG_DEALER: "This discount request does not belong to your account.",
          REVOKED: "Reorder permission has been revoked by admin.",
          NOT_APPROVED: "This discount request is not approved.",
          NETWORK: "Could not load reorder data. Please try again.",
          API_FAIL: "Could not load reorder data.",
        };
        toast.error(messages[err?.message] || messages.NETWORK);
        window.history.replaceState({}, "", "/dashboard/dealer/AddOrderForm");
      })
      .finally(() => setReorderLoading(false));
  }, [reorderIdParam, user, products]);

  useEffect(() => {
    if (!draftIdParam || !user || products.length === 0) return;
    if (seededRef.current) return;
    if (!cachedDraft && !draftError) return;        // still loading

    seededRef.current = true;

    if (draftError || !cachedDraft) {
      toast.error("Draft not found or does not belong to your account.");
      return;
    }

    setActiveDraftId(cachedDraft.id);
    setDraftName(cachedDraft.name);
    setDraftApprovalState(cachedDraft.approval_state ?? null);
    if (cachedDraft.shipto) setShipto(cachedDraft.shipto);
    if (cachedDraft.refno) setRefno(cachedDraft.refno);
    if (cachedDraft.order_note) setOrderNote(cachedDraft.order_note);
    if (cachedDraft.coupon_code && cachedDraft.coupon_pct) {
      setAppliedCoupon({ code: cachedDraft.coupon_code, pct: cachedDraft.coupon_pct });
    }
    setPerProductDiscountInputs(cachedDraft.approval_state?.requestedProductDiscounts ?? {});
    setCustomDiscountInput(cachedDraft.approval_state?.requestedOrderDiscountPercent ? String(cachedDraft.approval_state.requestedOrderDiscountPercent) : "");
    setCustomDiscountScope(cachedDraft.approval_state?.requestedOrderDiscountPercent ? "order" : "product");
    setArr(cachedDraft.rows.length > 0 ? cachedDraft.rows : [emptyRow()]);
    setDraftBanner(`Loaded: "${cachedDraft.name}"`);
  }, [draftIdParam, user, products, cachedDraft, draftError]);

  useEffect(() => {
    if (!user?.Dealer_Id) return;
    const linkedDraftId = activeDraftId || draftIdParam;
    const approvalRequestId = draftApprovalState?.approvalRequestId ?? null;
    if (!linkedDraftId && !approvalRequestId) return;

    let cancelled = false;

    const syncApprovalRequest = async () => {
      try {
        let request: CustomDiscountRequest | null = null;

        if (approvalRequestId) {
          const res = await fetch(`/api/custom-discount-requests/${encodeURIComponent(approvalRequestId)}`, {
            headers: {
              "x-omsons-actor-role": "dealer",
              "x-omsons-actor-id": String(user.Dealer_Id),
            },
          });
          if (res.ok) {
            const json = await res.json();
            if (json.success) request = json.data as CustomDiscountRequest;
          }
        }

        if (!request && linkedDraftId) {
          const res = await fetch(`/api/custom-discount-requests?dealer_id=${encodeURIComponent(user.Dealer_Id)}&order_draft_id=${encodeURIComponent(linkedDraftId)}&limit=20`);
          if (res.ok) {
            const json = await res.json();
            if (json.success && Array.isArray(json.data) && json.data.length > 0) {
              request = json.data[0] as CustomDiscountRequest;
            }
          }
        }

        if (cancelled || !request) return;
        mergeCustomDiscountRequest(request);
        const normalized = normalizeCustomDiscountRequestRecord(request);
        setDraftApprovalState(buildDraftApprovalState({
          approvalRequestId: normalized.id,
          status: ["pending", "approved", "rejected"].includes(normalized.normalizedStatus)
            ? normalized.normalizedStatus as DraftApprovalState["status"]
            : null,
          requestedOrderDiscountPercent: normalized.requestedOrderDiscountPercent,
          requestedProductDiscounts: normalized.requestedProductDiscounts,
          updatedAt: normalized.reviewedAt || normalized.createdAt,
        }));
      } catch (error) {
        console.error("[custom-discount] sync draft-linked request failed", error);
      }
    };

    void syncApprovalRequest();

    return () => {
      cancelled = true;
    };
  }, [user?.Dealer_Id, activeDraftId, draftIdParam, draftApprovalState?.approvalRequestId]);

  // ── Seed rows from DraftCart (when navigated from Cart page) ─────────────
  useEffect(() => {
    if (!fromCart || !user || products.length === 0) return;
    if (reorderIdParam) return;
    if (seededRef.current) return;

    fetchWithSessionRefresh(`/api/draft-cart?dealer_id=${encodeURIComponent(user.Dealer_Id)}`, { cache: "no-store" })
      .then(r => { if (!r.ok) throw new Error("DRAFT_CART_UNAVAILABLE"); return r.json(); })
      .then(json => {
        if (json.success && Array.isArray(json.data?.items) && json.data.items.length > 0) {
          const rows: ProductRow[] = json.data.items.map((item: any, i: number) => {
            const match = products.find(
              (p: any) =>
                String(p.product_cat).trim() === String(item.variantCode).trim() ||
                String(p.product_id).trim() === String(item.variantCode).trim()
            );
            const catalogueMatch = catalogueIndex ? findCatalogueEntry(catalogueIndex, String(item.variantCode).trim()) : null;
            const catalogueProduct = catalogueMatch?.product ?? null;
            const catalogueVariant = catalogueMatch?.variant ?? null;
            const packSize = catalogueVariant?.pack ?? item.packSize ?? 1;
            const cartUnitPrice = cartPriceToRupees(item.unitPrice, match?.product_price);
            const pricing = catalogueProduct && catalogueVariant
              ? cataloguePricing.getVariantOrderPricing(catalogueVariant.price, packSize, catalogueProduct)
              : { unitPrice: cartUnitPrice, baseListPrice: cartUnitPrice * packSize };
            return {
              key: i + 1,
              productname: catalogueVariant?.sku ?? (match ? String(match.product_cat) : item.variantCode),
              displayName: catalogueProduct ? getCatalogueProductLabel(catalogueProduct) : (match ? (match.product_name ?? item.productName) : item.productName),
              variantCode: catalogueVariant?.sku ?? item.variantCode,
              producQuanity: item.quantity,
              price: pricing.unitPrice,
              baseListPrice: pricing.baseListPrice,
              packSize,
              isPriority: item.isPriority ?? item.priority ?? false,
              productNote: "",
              catalogueSection: catalogueProduct ? getCatalogueSection(catalogueProduct) : "",
              catalogueProductSku: catalogueProduct?.sku ?? "",
              catalogueVariantSku: catalogueVariant?.sku ?? "",
            };
          });
          seededRef.current = true;
          setArr(rows);
          setDraftBanner(`${rows.length} item${rows.length !== 1 ? "s" : ""} imported from your cart`);
        } else if (cartItems.length > 0) {
          seededRef.current = false;
        } else {
          seededRef.current = true;
          setArr([emptyRow()]);
        }
      })
      .catch(() => {
        if (cartItems.length > 0) return;
        seededRef.current = true;
        toast.error("Could not load cart draft.");
      });
  }, [fromCart, user, products, catalogueIndex, reorderIdParam]);

  // ── Seed rows from cart ───────────────────────────────────────────────────
  useEffect(() => {
    if (seededRef.current) return;
    if (products.length === 0) return;
    if (draftIdParam) return;
    if (reorderIdParam) return;
    // Allow the in-memory cart to seed rows for ?from=cart; DraftCart can still overwrite it when present.
    seededRef.current = true;

    if (cartItems.length === 0) { setArr([emptyRow()]); return; }

    const cartRows: ProductRow[] = cartItems.map((item, i) => {
      const match = products.find(
        (p) =>
          String(p.product_cat).trim() === String(item.id).trim() ||
          String(p.product_id).trim() === String(item.id).trim()
      );
      const catalogueMatch = catalogueIndex ? findCatalogueEntry(catalogueIndex, String(item.id).trim()) : null;
      const catalogueProduct = catalogueMatch?.product ?? null;
      const catalogueVariant = catalogueMatch?.variant ?? null;
      const nameParts = item.name.split(" - ");
      const productName = nameParts[0] ?? item.name;
      const variantCode = catalogueVariant?.sku ?? (nameParts.length > 1 ? nameParts[nameParts.length - 1] : item.id);
      const localMeta = variantLookup[item.id];
      const packSize = catalogueVariant?.pack ?? localMeta?.packSize ?? (item as any).packSize ?? 1;
      const cartPrice = Number(item.price);
      const apiPrice = match ? Number(match.product_price) : 0;
      const price = cartPriceToRupees(cartPrice, apiPrice);
      const pricing = catalogueProduct && catalogueVariant
        ? cataloguePricing.getVariantOrderPricing(catalogueVariant.price, packSize, catalogueProduct)
        : { unitPrice: price, baseListPrice: price * packSize };

      return {
        key: i + 1,
        productname: variantCode,
        displayName: catalogueProduct ? getCatalogueProductLabel(catalogueProduct) : (match ? (match.product_name ?? productName) : productName),
        variantCode,
        producQuanity: item.quantity,
        price: pricing.unitPrice,
        baseListPrice: pricing.baseListPrice,
        packSize,
        isPriority: item.isPriority ?? false,
        productNote: "",
        catalogueSection: catalogueProduct ? getCatalogueSection(catalogueProduct) : "",
        catalogueProductSku: catalogueProduct?.sku ?? "",
        catalogueVariantSku: catalogueVariant?.sku ?? "",
      };
    });

    setArr(cartRows);
  }, [products, cartItems, variantLookup, catalogueIndex, draftIdParam, reorderIdParam, fromCart]);

  // ── Discount ──────────────────────────────────────────────────────────────
  const subtotalPaise = arr1.reduce((acc, row) => acc + rowSubtotalPaise(row), 0);
  const subtotal = subtotalPaise / 100;
  const dealerDiscount = safePositiveNumber(user?.discount);
  const couponDiscount = appliedCoupon?.pct ?? 0;
  const normalizedCustomDiscountRequests = useMemo(
    () => customDiscountRequests.map((request) => normalizeCustomDiscountRequestRecord(request)),
    [customDiscountRequests],
  );

  // ── Custom / reorder discount resolution ─────────────────────────────
  const currentOrderSignature = buildOrderSignature(arr1, subtotal);
  const productRows = arr1.filter((r) => r.productname);
  const draftLinkedRequest = activeDraftId
    ? findLatestRequestForDraft(
      customDiscountRequests,
      activeDraftId,
      draftApprovalState?.approvalRequestId ?? null,
    )
    : null;
  const selectedCustomDiscountProduct = productRows.find((r) => getProductKey(r) === customDiscountProductKey) ?? productRows[0] ?? null;
  const selectedCustomDiscountSignature = selectedCustomDiscountProduct ? buildProductSignature(selectedCustomDiscountProduct) : "";
  const customDiscountBaseSubtotal = customDiscountScope === "product" && selectedCustomDiscountProduct
    ? rowSubtotalPaise(selectedCustomDiscountProduct) / 100
    : subtotal;
  const matchingCustomRequests = normalizedCustomDiscountRequests.filter(
    (r) => r.orderDraftId === "" && r.discountScope !== "product" && String((r.source as CustomDiscountRequest).orderSignature || "") === currentOrderSignature
  );
  const legacyApprovedCustomRequest = matchingCustomRequests.find((r) => r.normalizedStatus === "approved");
  const legacyPendingCustomRequest = matchingCustomRequests.find((r) => r.normalizedStatus === "pending");
  const legacyRejectedCustomRequest = matchingCustomRequests.find((r) => r.normalizedStatus === "rejected");
  const matchingProductCustomRequests = selectedCustomDiscountSignature
    ? normalizedCustomDiscountRequests.filter(
      (r) => r.orderDraftId === "" && r.discountScope === "product" && String((r.source as CustomDiscountRequest).orderSignature || "") === selectedCustomDiscountSignature
    )
    : [];
  const activeApprovalRequest = reorderRequest ?? draftLinkedRequest ?? null;
  const activeOrderApprovalRequest = activeApprovalRequest?.discountScope === "order" ? activeApprovalRequest : null;
  const activeProductApprovalRequest = activeApprovalRequest?.discountScope === "product" ? activeApprovalRequest : null;
  const approvedCustomRequest = activeOrderApprovalRequest?.normalizedStatus === "approved"
    ? activeOrderApprovalRequest
    : legacyApprovedCustomRequest ?? null;
  const pendingCustomRequest = activeOrderApprovalRequest?.normalizedStatus === "pending"
    ? activeOrderApprovalRequest
    : legacyPendingCustomRequest ?? null;
  const rejectedCustomRequest = activeOrderApprovalRequest?.normalizedStatus === "rejected"
    ? activeOrderApprovalRequest
    : legacyRejectedCustomRequest ?? null;
  const approvedProductCustomRequest = activeProductApprovalRequest?.normalizedStatus === "approved"
    ? activeProductApprovalRequest
    : matchingProductCustomRequests.find((r) => r.normalizedStatus === "approved") ?? null;
  const pendingProductCustomRequest = activeProductApprovalRequest?.normalizedStatus === "pending"
    ? activeProductApprovalRequest
    : matchingProductCustomRequests.find((r) => r.normalizedStatus === "pending") ?? null;
  const rejectedProductCustomRequest = activeProductApprovalRequest?.normalizedStatus === "rejected"
    ? activeProductApprovalRequest
    : matchingProductCustomRequests.find((r) => r.normalizedStatus === "rejected") ?? null;
  const visibleCustomRequest = activeApprovalRequest ?? (
    customDiscountScope === "product"
      ? approvedProductCustomRequest ?? pendingProductCustomRequest ?? rejectedProductCustomRequest ?? null
      : approvedCustomRequest ?? pendingCustomRequest ?? rejectedCustomRequest ?? null
  );
  const approvedCustomDiscountPercent = approvedCustomRequest
    ? Math.min(100, Math.max(0, Number(approvedCustomRequest.requestedOrderDiscountPercent ?? approvedCustomRequest.requestedDiscountPercent) || 0))
    : null;
  const getApprovedProductCustomRequest = (row: ProductRow) => {
    const productKey = normalizeApprovalProductKey(getProductKey(row));
    if (activeProductApprovalRequest?.normalizedStatus === "approved" && activeProductApprovalRequest.requestedProductDiscounts[productKey]) {
      return activeProductApprovalRequest;
    }
    const rowSignature = buildProductSignature(row);
    return normalizedCustomDiscountRequests.find(
      (r) => (
        r.orderDraftId === "" &&
        r.normalizedStatus === "approved" &&
        r.discountScope === "product" &&
        r.requestedProductDiscounts[productKey] &&
        String((r.source as CustomDiscountRequest).orderSignature || "") === rowSignature
      )
    );
  };
  const getProductPendingRequest = (row: ProductRow) => {
    const productKey = normalizeApprovalProductKey(getProductKey(row));
    if (activeProductApprovalRequest?.normalizedStatus === "pending" && activeProductApprovalRequest.requestedProductDiscounts[productKey]) {
      return activeProductApprovalRequest;
    }
    const rowSignature = buildProductSignature(row);
    return normalizedCustomDiscountRequests.find(
      (r) => (
        r.orderDraftId === "" &&
        r.normalizedStatus === "pending" &&
        r.discountScope === "product" &&
        r.requestedProductDiscounts[productKey] &&
        String((r.source as CustomDiscountRequest).orderSignature || "") === rowSignature
      )
    );
  };
  // Only a genuinely pending request may lock the form. Any other terminal
  // state (rejected, cancelled, or an unrecognised one) must leave the draft
  // editable, otherwise the dealer is stranded with a draft they cannot save.
  const isWaitingForApproval = !reorderRequest && activeApprovalRequest?.normalizedStatus === "pending";
  const orderLockedByPendingApproval = isWaitingForApproval;
  const isApprovedDraftRequest = !reorderRequest && activeApprovalRequest?.normalizedStatus === "approved";
  const isRejectedDraftRequest = !reorderRequest && activeApprovalRequest?.normalizedStatus === "rejected";

  // ── Sequential discount calculation ──────────────────────────────────
  // Base discount payload — uses the new sequential slab logic.
  // Slab is determined from amountBeforeSlab, NOT from gross subtotal.
  const baseDiscountPayload = calculateStackedDiscount(subtotal, {
    allocatedDiscountPercent: dealerDiscount,
    couponDiscountPercent: couponDiscount,
  });

  const getRowDiscountPercent = (row: ProductRow) => {
    const globalPercent = approvedCustomDiscountPercent ?? baseDiscountPayload.baseDiscountPercent;
    const productRequest = getApprovedProductCustomRequest(row);
    if (productRequest) {
      return Math.min(100, Math.max(globalPercent, Number(productRequest.requestedDiscountPercent) || 0));
    }
    return globalPercent;
  };
  const hasApprovedCustomCandidate = approvedCustomDiscountPercent !== null || productRows.some((row) => !!getApprovedProductCustomRequest(row));

  // Per-row base-discount amounts (additional slab/custom is handled separately)
  const baseDiscountAmountFromRows = productRows.reduce((acc, row) => (
    acc + (rowSubtotalPaise(row) / 100) * (baseDiscountPayload.baseDiscountPercent / 100)
  ), 0);

  const postBaseAmountFromRows = roundRupees(Math.max(0, subtotal - baseDiscountAmountFromRows));
  const customDiscountAmountFromRows = hasApprovedCustomCandidate
    ? roundRupees(productRows.reduce((acc, row) => {
      const rowSubtotal = rowSubtotalPaise(row) / 100;
      const additionalPercent = Math.max(0, getRowDiscountPercent(row) - baseDiscountPayload.baseDiscountPercent);
      return acc + (rowSubtotal * (additionalPercent / 100));
    }, 0))
    : 0;
  const activeAdditionalDiscountType = hasApprovedCustomCandidate ? "custom" : null;

  const slabPercentFromRows = activeAdditionalDiscountType === "custom"
    ? 0
    : postBaseAmountFromRows >= 500000 ? 5
      : postBaseAmountFromRows >= 250000 ? 2 : 0;
  const slabAmountFromRows = roundRupees(postBaseAmountFromRows * (slabPercentFromRows / 100));
  const additionalDiscountAmountFromRows = activeAdditionalDiscountType === "custom"
    ? customDiscountAmountFromRows
    : slabAmountFromRows;

  // Final payable after sequential application
  const finalPayableFromRows = roundRupees(Math.max(0, postBaseAmountFromRows - additionalDiscountAmountFromRows));
  const totalDiscountAmountFromRows = roundRupees(baseDiscountAmountFromRows + additionalDiscountAmountFromRows);
  const effectiveDiscountPercent = subtotal > 0
    ? Number(payloadAmount((totalDiscountAmountFromRows / subtotal) * 100))
    : 0;

  const discountPayload = {
    ...baseDiscountPayload,
    baseDiscountAmount: Number(payloadAmount(baseDiscountAmountFromRows)),
    postBaseAmount: Number(payloadAmount(postBaseAmountFromRows)),
    amountBeforeSlab: Number(payloadAmount(postBaseAmountFromRows)),
    additionalDiscountType: activeAdditionalDiscountType ?? (slabPercentFromRows > 0 ? "slab" : null),
    additionalDiscountAmount: Number(payloadAmount(additionalDiscountAmountFromRows)),
    customDiscountAmount: Number(payloadAmount(customDiscountAmountFromRows)),
    slabDiscountPercent: slabPercentFromRows,
    slabDiscountAmount: Number(payloadAmount(slabAmountFromRows)),
    discountPercent: effectiveDiscountPercent,
    discountAmount: Number(payloadAmount(totalDiscountAmountFromRows)),
    effectiveTotalDiscountPercent: effectiveDiscountPercent,
    effectiveTotalDiscountAmount: Number(payloadAmount(totalDiscountAmountFromRows)),
    finalPayableAmount: Number(payloadAmount(finalPayableFromRows)),
  };

  const activeDiscount: number = discountPayload.discountPercent;
  const discountAmountPaise = toPaise(discountPayload.discountAmount);
  const finalPayablePaise = toPaise(discountPayload.finalPayableAmount);
  const discountStatusMessage = getDiscountStatusMessage(discountPayload.slabDiscountPercent);
  const hasSlabDiscount = discountPayload.additionalDiscountType === "slab" && discountPayload.slabDiscountPercent > 0;
  const hasAnyDiscount = discountPayload.discountPercent > 0;
  const approvedProductCustomRequests = productRows
    .map((row) => getApprovedProductCustomRequest(row))
    .filter((r): r is NormalizedCustomDiscountRequest => !!r);
  const hasApprovedCustomDiscount = hasApprovedCustomCandidate || approvedProductCustomRequests.length > 0;
  const discountRejectionDraftRequest = isRejectedDraftRequest
    ? activeApprovalRequest
    : activeDraftId
      ? normalizedCustomDiscountRequests.find((r) => (
        r.normalizedStatus === "rejected" &&
        (
          String(r.rejectionDraftId ?? "") === String(activeDraftId) ||
          (
            cachedDraft?.source === "custom_discount_rejection" &&
            String(cachedDraft?.source_request_id ?? "") === String(r.id)
          )
        )
      ))
      : null;
  const requestedCustomDiscountPercent = Math.min(100, Math.max(0, Number(customDiscountInput) || 0));
  const requestedProductDiscountRows = productRows
    .map((row) => {
      const productKey = getProductKey(row);
      const normalizedKey = normalizeApprovalProductKey(productKey);
      const percent = Number(perProductDiscountInputs[productKey] ?? perProductDiscountInputs[normalizedKey] ?? 0);
      return { row, productKey, normalizedKey, percent };
    })
    .filter(({ percent }) => percent > (approvedCustomDiscountPercent ?? baseDiscountPayload.baseDiscountPercent));
  const hasRequestedProductDiscounts = requestedProductDiscountRows.length > 0;
  const requestedCustomDiscountAmount = customDiscountBaseSubtotal * (requestedCustomDiscountPercent / 100);
  const requestedCustomFinalPayable = Math.max(0, customDiscountBaseSubtotal - requestedCustomDiscountAmount);

  // ── Coupon handlers ───────────────────────────────────────────────────────
  const handleApplyCoupon = () => {
    if (orderLockedByPendingApproval) {
      toast("This approval request is pending, so the submitted order is locked.");
      return;
    }
    setCouponError(""); setCouponSuccess("");
    const trimmed = couponInput.trim().toUpperCase();
    if (!trimmed) { setCouponError("Please enter a coupon code."); return; }
    const pct = COUPONS[trimmed];
    if (pct === undefined) { setCouponError("Invalid coupon code."); return; }
    setAppliedCoupon({ code: trimmed, pct });
    setCouponSuccess(`"${trimmed}" applied — ${pct}% coupon discount added`);
    setCouponInput("");
  };

  const handleRemoveCoupon = () => {
    if (orderLockedByPendingApproval) {
      toast("This approval request is pending, so the submitted order is locked.");
      return;
    }
    setAppliedCoupon(null); setCouponError(""); setCouponSuccess(""); setCouponInput("");
  };

  const refreshCustomDiscountRequests = async () => {
    if (!user?.Dealer_Id) return [];
    const res = await fetch(`/api/custom-discount-requests?dealer_id=${encodeURIComponent(user.Dealer_Id)}&limit=200`);
    const json = await res.json();
    if (!json.success) throw new Error(json.message ?? "Could not load discount requests");
    setCustomDiscountRequests(json.data ?? []);
    return json.data ?? [];
  };

  const linkCustomDiscountRequestsToOrder = async (
    requests: Array<CustomDiscountRequest | NormalizedCustomDiscountRequest>,
    orderId: string,
  ) => {
    const normalizedOrderId = String(orderId || "").trim();
    if (!normalizedOrderId) return;

    const orderNumber = formatDisplayOrderNumber(normalizedOrderId);
    const uniqueIds = Array.from(new Set(
      requests.map((request) => String(request.id || "").trim()).filter(Boolean)
    ));

    await Promise.all(uniqueIds.map((requestId) =>
      fetch(`/api/custom-discount-requests/${encodeURIComponent(requestId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: normalizedOrderId,
          orderNumber,
        }),
      }).catch(() => {})
    ));
  };

  const submitCustomDiscountApproval = async (options: {
    scope: CustomDiscountScope;
    requestedOrderDiscountPercent?: number | null;
    requestedProductDiscounts?: Record<string, number>;
    targetProduct?: ProductRow | null;
  }) => {
    if (!user?.Dealer_Id) {
      throw new Error("Dealer account is missing.");
    }

    const requestedProductDiscounts = options.requestedProductDiscounts ?? {};
    const requestedOrderDiscountPercent = options.scope === "order"
      ? options.requestedOrderDiscountPercent ?? null
      : null;
    const nextApprovalState = buildDraftApprovalState({
      approvalRequestId: draftApprovalState?.approvalRequestId ?? null,
      status: "pending",
      requestedOrderDiscountPercent,
      requestedProductDiscounts,
      updatedAt: new Date().toISOString(),
    });
    const nextDraftName = activeDraftId ? draftName : `Approval Draft ${moment().format("MMM D, h:mm a")}`;
    const orderDraftId = await persistCurrentDraft(nextDraftName, nextApprovalState);
    const orderSnapshot = buildCurrentOrderSnapshot({
      requestedOrderDiscountPercent,
      requestedProductDiscounts,
    });

    const response = await fetch("/api/custom-discount-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dealerId: user.Dealer_Id,
        staffId: String(user.assignedstaff ?? ""),
        assignedStaffId: String(user.assignedstaff ?? ""),
        dealerName: user.Dealer_Name,
        dealerCode: user.Dealer_Dealercode,
        dealerEmail: user.Dealer_Email,
        dealerPhone: user.Dealer_Number,
        orderDraftId,
        requestedDiscountPercent: requestedOrderDiscountPercent ?? Math.max(
          baseDiscountPayload.baseDiscountPercent,
          ...Object.values(requestedProductDiscounts),
          0,
        ),
        currentDiscountPercent: baseDiscountPayload.baseDiscountPercent,
        requestedOrderDiscountPercent,
        requestedProductDiscounts,
        subtotal: orderSnapshot.grossAmount,
        currentDiscountAmount: orderSnapshot.baseDiscountAmount,
        requestedDiscountAmount: orderSnapshot.requestedAdditionalDiscountAmount,
        currentFinalPayable: Math.max(0, orderSnapshot.grossAmount - orderSnapshot.baseDiscountAmount),
        requestedFinalPayable: orderSnapshot.requestedNetPayableAmount,
        discountScope: options.scope,
        targetProduct: options.targetProduct ? {
          productKey: getProductKey(options.targetProduct),
          productname: options.targetProduct.productname,
          displayName: options.targetProduct.displayName,
          variantCode: options.targetProduct.variantCode,
        } : null,
        shipto,
        refno,
        orderNote: orderNote.trim(),
        orderSignature: currentOrderSignature,
        discountBreakdown: {
          allocatedDiscountPercent: baseDiscountPayload.allocatedDiscountPercent,
          baseDiscountPercent: baseDiscountPayload.baseDiscountPercent,
          slabDiscountPercent: discountPayload.slabDiscountPercent,
          couponDiscountPercent: baseDiscountPayload.couponDiscountPercent,
          couponCode: appliedCoupon?.code ?? "",
        },
        orderSnapshot,
        products: orderSnapshot.products,
        draftProducts: buildCurrentDraftRows(),
      }),
    });

    const json = await response.json();
    if (!json.success) throw new Error(json.message ?? "Request failed");

    mergeCustomDiscountRequest(json.data as CustomDiscountRequest);

    const normalized = normalizeCustomDiscountRequestRecord(json.data as CustomDiscountRequest);
    const savedApprovalState = buildDraftApprovalState({
      approvalRequestId: normalized.id,
      status: "pending",
      requestedOrderDiscountPercent: normalized.requestedOrderDiscountPercent,
      requestedProductDiscounts: normalized.requestedProductDiscounts,
      updatedAt: normalized.createdAt,
    });
    setDraftApprovalState(savedApprovalState);
    if (orderDraftId) {
      await updateDraft(orderDraftId, user.Dealer_Id, {
        approval_state: savedApprovalState,
      }).catch((error) => {
        console.error("[custom-discount] approval state draft sync failed", error);
      });
      syncDraftUrl(orderDraftId);
    }

    return normalized;
  };

  const handleRequestCustomDiscount = async () => {
    if (arr1.every(r => !r.productname)) { toast("Please select at least one product before requesting approval."); return; }
    if (isWaitingForApproval) {
      toast("This order is already waiting for approval.");
      return;
    }
    if (customDiscountScope === "order" && requestedCustomDiscountPercent <= baseDiscountPayload.baseDiscountPercent) {
      toast(`Enter a custom discount above the current ${baseDiscountPayload.baseDiscountPercent}%.`);
      return;
    }
    const requestedProductDiscounts = buildRequestedProductDiscountMap();
    if (customDiscountScope === "product" && Object.keys(requestedProductDiscounts).length === 0) {
      toast("Select at least one product discount above the current approved/base discount.");
      return;
    }

    setCustomDiscountSubmitting(true);
    try {
      await submitCustomDiscountApproval({
        scope: customDiscountScope,
        requestedOrderDiscountPercent: customDiscountScope === "order" ? requestedCustomDiscountPercent : null,
        requestedProductDiscounts,
        targetProduct: customDiscountScope === "product" ? selectedCustomDiscountProduct : null,
      });
      toast.success("Custom discount request sent to admin.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not request custom discount.");
    } finally {
      setCustomDiscountSubmitting(false);
    }
  };

  const handleRequestProductDiscount = async (row: ProductRow) => {
    const key = getProductKey(row);
    const globalPercent = approvedCustomDiscountPercent ?? baseDiscountPayload.baseDiscountPercent;
    const productPercent = perProductDiscountInputs[key] ?? globalPercent;
    if (isWaitingForApproval) {
      toast("This order is already waiting for approval.");
      return;
    }
    if (productPercent <= globalPercent) {
      toast(`Enter a product discount above the current ${globalPercent}%.`);
      return;
    }
    setPerProductSubmitting(key);
    try {
      const requestedProductDiscounts = {
        ...buildRequestedProductDiscountMap(),
        [normalizeApprovalProductKey(key)]: productPercent,
      };
      await submitCustomDiscountApproval({
        scope: "product",
        requestedProductDiscounts,
        targetProduct: row,
      });
      setEditingProductDiscountKey(null);
      toast.success(`Product discount request sent for ${row.displayName || row.variantCode}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not request product discount.");
    } finally {
      setPerProductSubmitting(null);
    }
  };

  // ── Catalogue hierarchy helpers ───────────────────────────────────────────
  const optionList = useMemo<CatalogueNumberOption[]>(() => {
    if (!catalogueIndex) return [];

    return catalogueIndex.products.flatMap((product) =>
      (product.variants ?? []).map((variant) => {
        const descriptor = getCatalogueProductDescriptor(product);
        const specSummary = getVariantLabel(product, variant)
          .replace(`${variant.sku} - `, "")
          .replace(/ - Pack of \d+$/, "")
          .trim();

        return {
          value: variant.sku,
          label: variant.sku,
          searchSku: variant.sku.toLowerCase(),
          searchText: [variant.sku, variant.name, product.name, descriptor, specSummary, product.category, ...(product.categories ?? [])]
            .filter(Boolean)
            .join(" ")
            .toLowerCase(),
          productName: product.name,
          descriptor,
          specSummary,
        };
      })
    );
  }, [catalogueIndex]);

  const catalogueFilter = (option: FilterOptionOption<CatalogueNumberOption>, inputValue: string) => {
    const needle = inputValue.trim().toLowerCase();
    if (!needle) return true;
    return option.data.searchText.includes(needle);
  };

  const catalogueSelectStyles: StylesConfig<CatalogueNumberOption, false> = {
    control: (base, state) => ({
      ...base,
      minHeight: 36,
      borderRadius: 10,
      borderColor: state.isFocused ? "#818cf8" : "#e5e7eb",
      boxShadow: state.isFocused ? "0 0 0 2px #e0e7ff" : "none",
      "&:hover": { borderColor: state.isFocused ? "#818cf8" : "#d1d5db" },
    }),
    valueContainer: (base) => ({
      ...base,
      padding: "1px 10px",
    }),
    input: (base) => ({
      ...base,
      margin: 0,
      padding: 0,
      color: "#111827",
      fontSize: 12,
    }),
    placeholder: (base) => ({
      ...base,
      color: "#9ca3af",
      fontSize: 12,
    }),
    singleValue: (base) => ({
      ...base,
      color: "#111827",
      fontSize: 12,
      fontWeight: 600,
    }),
    menu: (base) => ({
      ...base,
      borderRadius: 14,
      overflow: "hidden",
      boxShadow: "0 16px 40px rgba(15, 23, 42, 0.14)",
      zIndex: 9999,
    }),
    menuPortal: (base) => ({
      ...base,
      zIndex: 9999,
    }),
    menuList: (base) => ({
      ...base,
      padding: 6,
      maxHeight: 260,
    }),
    option: (base) => ({
      ...base,
      backgroundColor: "transparent",
      color: "#111827",
      padding: 0,
      cursor: "pointer",
    }),
  };

  const resolveRowSelection = (row: ProductRow) => {
    const lookupCandidates = [row.catalogueVariantSku, row.variantCode, row.productname]
      .map((value) => String(value ?? "").trim())
      .filter(Boolean);
    const entry = catalogueIndex
      ? lookupCandidates
          .map((candidate) => findCatalogueEntry(catalogueIndex, candidate))
          .find((candidate) => candidate?.variant) ?? null
      : null;
    const product = entry?.product ?? null;
    const variant = entry?.variant ?? null;
    const section = row.catalogueSection || (product ? getCatalogueSection(product) : "");
    const productSku = row.catalogueProductSku || product?.sku || product?.id || "";
    const variantSku = row.catalogueVariantSku || variant?.sku || (variant ? variant.sku : "");

    return { section, productSku, variantSku, product, variant };
  };

  const resetRowSelection = (idx: number) => {
    setArr((prev) => {
      const next = [...prev];
      next[idx] = {
        ...next[idx],
        productname: "",
        displayName: "",
        variantCode: "",
        price: 0,
        baseListPrice: 0,
        packSize: 1,
        productNote: "",
        catalogueSection: "",
        catalogueProductSku: "",
        catalogueVariantSku: "",
      };
      return next;
    });
  };

  const handleChangeSelect = (idx: number, variantSku: string) => {
    if (orderLockedByPendingApproval) return;
    if (!variantSku) {
      resetRowSelection(idx);
      return;
    }

    const entry = catalogueIndex ? findCatalogueEntry(catalogueIndex, variantSku) : null;
    const product = entry?.product;
    const variant = entry?.variant;
    if (!product || !variant) return;

    const displayName = getCatalogueProductLabel(product);
    const packSize = safePositiveNumber(variant.pack) || 1;
    const pricing = cataloguePricing.getVariantOrderPricing(variant.price, packSize, product);
    setArr((prev) => {
      const next = [...prev];
      next[idx] = {
        ...next[idx],
        catalogueSection: getCatalogueSection(product),
        catalogueProductSku: product.sku,
        catalogueVariantSku: variant.sku,
        productname: variant.sku,
        displayName,
        variantCode: variant.sku,
        baseListPrice: pricing.baseListPrice,
        price: pricing.unitPrice,
        packSize,
      };
      return next;
    });
  };

  const updateQuantity = (i: number, val: number) => {
    if (orderLockedByPendingApproval) return;
    const v = Math.max(1, val || 1);
    setArr((prev) => { const n = [...prev]; n[i] = { ...n[i], producQuanity: v }; return n; });
  };

  const findCatalogueOption = (row: ProductRow, resolvedVariantSku: string) => {
    const candidates = [resolvedVariantSku, row.catalogueVariantSku, row.variantCode, row.productname]
      .map((value) => String(value ?? "").trim())
      .filter(Boolean);

    for (const candidate of candidates) {
      const exact = optionList.find((option) => option.value === candidate);
      if (exact) return exact;

      const normalizedCandidate = candidate.toLowerCase();
      const normalized = optionList.find(
        (option) => option.value.trim().toLowerCase() === normalizedCandidate,
      );
      if (normalized) return normalized;
    }

    return null;
  };

  const getSelectedVariantSpecs = (variant: CatalogueVariant | null) => {
    const structuredSpecs = Object.entries(variant?.specs ?? {})
      .map(([key, value]) => [key.trim(), String(value ?? "").trim()] as const)
      .filter(([key, value]) => key && value);

    if (structuredSpecs.length > 0) return structuredSpecs.slice(0, 3);

    return String(variant?.specsText ?? "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .slice(0, 3)
      .map((part) => {
        const separatorIndex = part.indexOf(":");
        return separatorIndex > 0
          ? [part.slice(0, separatorIndex).trim(), part.slice(separatorIndex + 1).trim()] as const
          : ["Specification", part] as const;
      });
  };

  const updateProductNote = (i: number, note: string) => {
    if (orderLockedByPendingApproval) return;
    const normalizedNote = note.slice(0, 500);
    setArr((prev) => {
      const n = [...prev];
      n[i] = { ...n[i], productNote: normalizedNote };
      return n;
    });
  };

  const togglePriority = (i: number) => {
    if (orderLockedByPendingApproval) return;
    setArr((prev) => {
      const n = [...prev];
      n[i] = { ...n[i], isPriority: !n[i].isPriority };
      return n;
    });
  };

  const addRow = () => {
    if (orderLockedByPendingApproval) return;
    setArr((prev) => [...prev, emptyRow()]);
  };
  const removeRow = (key: number) => {
    if (orderLockedByPendingApproval) return;
    setArr((prev) => prev.filter((r) => r.key !== key));
  };

  // ── Save Draft ────────────────────────────────────────────────────────────
  const commitSaveDraft = async (nameToUse: string) => {
    if (!user) return;
    setShowNameModal(false);
    setDraftSaving(true);
    try {
      const previousDraftId = activeDraftId;
      await persistCurrentDraft(nameToUse, buildCurrentApprovalState());
      toast.success(previousDraftId ? "Draft updated ✓" : "Draft saved ✓");
    } catch (error) {
      // A bare catch here hid the real reason a save failed (404 on a stale
      // draft id, 403 on scope), so the edit looked silently discarded.
      const message = error instanceof Error ? error.message : "";
      toast.error(message ? `Could not save draft: ${message}` : "Could not save draft.");
      console.error("[commitSaveDraft]", error);
    } finally {
      setDraftSaving(false);
    }
  };

  const handleSaveDraft = () => {
    if (orderLockedByPendingApproval) {
      toast("This approval request is pending, so the submitted order is locked.");
      return;
    }
    if (arr1.every(r => !r.productname)) { toast("Add at least one product before saving a draft."); return; }
    if (activeDraftId) {
      commitSaveDraft(draftName);
    } else {
      setPendingDraftName(`Draft ${moment().format("MMM D, h:mm a")}`);
      setShowNameModal(true);
    }
  };

  const getLatestOrderIdForDealer = async () => {
    if (!user?.Dealer_Id) return "";
    try {
      const res = await fetch(`/api/orders-data?source=orderhispegination&role=dealer&page=1&limit=1000&search=&id=${encodeURIComponent(user.Dealer_Id)}`);
      const json = await res.json();
      return String(json?.data?.[0]?.order_id ?? "").trim();
    } catch {
      return "";
    }
  };

  useEffect(() => {
    if (!user?.Dealer_Id) return;
    let active = true;

    setExpectedOrderLoading(true);
    const loadLatestOrderId = async () => {
      try {
        const res = await fetch(`/api/orders-data?source=orderhispegination&role=dealer&page=1&limit=1000&search=&id=${encodeURIComponent(user.Dealer_Id)}`);
        const json = await res.json();
        return String(json?.data?.[0]?.order_id ?? "").trim();
      } catch {
        return "";
      }
    };

    loadLatestOrderId()
      .then((latestId: string) => {
        if (active) setExpectedOrderNumber(buildExpectedOrderNumber(latestId));
      })
      .finally(() => {
        if (active) setExpectedOrderLoading(false);
      });

    return () => {
      active = false;
    };
  }, [user?.Dealer_Id]);

  useEffect(() => {
    if (!user?.Dealer_Id) return;
    setWalletLoading(true);
    fetch(`/api/wallet/${encodeURIComponent(user.Dealer_Id)}?limit=5`, {
      cache: "no-store",
      headers: { "x-omsons-actor-role": "dealer", "x-omsons-actor-id": String(user.Dealer_Id) },
    })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("wallet unavailable")))
      .then((json) => { if (json.success) setWallet(json); })
      .catch(() => setWallet(null))
      .finally(() => setWalletLoading(false));
  }, [user?.Dealer_Id]);

  const saveOrderNoteForHistory = async (orderId: string) => {
    const note = orderNote.trim();
    if (!orderId || !note || !user?.Dealer_Id) return;
    await fetch("/api/order-notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderId,
        dealerId: user.Dealer_Id,
        dealerName: user.Dealer_Name,
        note,
      }),
    }).catch(() => { });
  };

  const saveOrderSummaryOverride = async (orderId: string, items: Array<Record<string, unknown>>) => {
    if (!orderId || !user?.Dealer_Id) return;

    const approvedDiscountPercent = hasApprovedCustomDiscount
      ? Number(payloadAmount(Math.max(0, approvedCustomDiscountPercent ?? 0)))
      : 0;
    const readableReason = discountPayload.additionalDiscountType === "custom"
      ? `Approved custom discount applied: Rs. ${discountPayload.customDiscountAmount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : discountPayload.additionalDiscountType === "slab" && discountPayload.slabDiscountAmount > 0
        ? `slab discount applied: ${discountPayload.slabDiscountPercent}% (Rs. ${discountPayload.slabDiscountAmount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`
        : "frontend_discount_override";
    const shouldSaveOverride =
      discountPayload.discountAmount > 0 &&
      (
        discountPayload.additionalDiscountType !== null ||
        discountPayload.couponDiscountPercent > 0 ||
        approvedDiscountPercent > 0 ||
        hasApprovedCustomDiscount ||
        discountPayload.discountPercent > discountPayload.allocatedDiscountPercent
      );

    if (!shouldSaveOverride) return;

    await fetch("/api/order-summary-overrides", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderId,
        order_id: orderId,
        dealerId: user.Dealer_Id,
        order_dealer: user.Dealer_Id,
        dealerName: user.Dealer_Name,
        grossAmount: payloadAmount(discountPayload.subtotal),
        order_amount: payloadAmount(discountPayload.subtotal),
        discountAmount: payloadAmount(discountPayload.discountAmount),
        discount_amount: payloadAmount(discountPayload.discountAmount),
        netPayableAmount: payloadAmount(discountPayload.finalPayableAmount),
        order_discount: payloadAmount(discountPayload.finalPayableAmount),
        discountPercent: discountPayload.discountPercent,
        allocatedDiscountPercent: discountPayload.allocatedDiscountPercent,
        baseDiscountPercent: discountPayload.baseDiscountPercent,
        baseDiscountAmount: payloadAmount(discountPayload.baseDiscountAmount),
        postBaseAmount: payloadAmount(discountPayload.postBaseAmount),
        additionalDiscountType: discountPayload.additionalDiscountType,
        additionalDiscountAmount: payloadAmount(discountPayload.additionalDiscountAmount),
        customDiscountAmount: payloadAmount(discountPayload.customDiscountAmount),
        slabDiscountPercent: discountPayload.slabDiscountPercent,
        slabDiscountAmount: payloadAmount(discountPayload.slabDiscountAmount),
        couponDiscountPercent: discountPayload.couponDiscountPercent,
        approvedDiscountPercent,
        items,
        reason: readableReason,
      }),
    }).catch((err) => {
      console.error("[order-summary-overrides] save failed:", err);
    });
  };

  // ── Submit Order ──────────────────────────────────────────────────────────
const verifySubmittedProductNotes = async (orderId: string) => {
  if (!orderId || !user?.Dealer_Id) return;

  const rowsWithNotes = arr1
    .filter(
      (row) =>
        row.productname &&
        String(row.productNote ?? "").trim()
    )
    .map((row) => ({
      productname: String(row.productname ?? "").trim(),
      variantCode: String(row.variantCode ?? "").trim(),
      productNote: String(row.productNote ?? "").trim(),
    }));

  if (rowsWithNotes.length === 0) return;

  try {
    const response = await fetchWithSessionRefresh(
      `/api/order-product-notes?orderId=${encodeURIComponent(orderId)}`,
      {
        cache: "no-store",
      }
    );

    if (!response.ok) {
      throw new Error(
        `Product note verification failed with ${response.status}`
      );
    }

    const json = await response.json();

    const savedNotes = Array.isArray(json?.data)
      ? json.data
      : Array.isArray(json?.data?.items)
        ? json.data.items
        : [];

    const normalize = (value: unknown) =>
      String(value ?? "").trim().toLowerCase();

    const failedRows = rowsWithNotes.filter((submitted) => {
      const submittedSku = normalize(
        submitted.variantCode || submitted.productname
      );

      const submittedNote = normalize(
        submitted.productNote
      );

      return !savedNotes.some((saved: any) => {
        const savedSku = normalize(
          saved.normalizedSku ??
          saved.sku ??
          saved.variantCode ??
          saved.productname ??
          saved.productName
        );

        const savedNote = normalize(
          saved.note ??
          saved.productNote ??
          saved.product_note
        );

        return (
          savedSku === submittedSku &&
          savedNote === submittedNote
        );
      });
    });

    if (failedRows.length > 0) {
      console.warn(
        "[order-product-notes] some notes could not be verified",
        {
          orderId,
          submitted: rowsWithNotes.length,
          failed: failedRows.length,
        }
      );

      toast.warn(
        "Order placed, but some product notes could not be verified.",
        { autoClose: 5000 }
      );
    }
  } catch (error) {
    console.warn(
      "[order-product-notes] verification failed",
      {
        orderId,
        error,
      }
    );

    // Order itself has already been placed.
    // Verification failure must not convert it into an order failure.
    toast.warn(
      "Order placed, but product note verification is still pending.",
      { autoClose: 5000 }
    );
  }
};
  const handleSubmitProductArray = async () => {
    if (isWaitingForApproval) {
      toast("This order is waiting for discount approval.");
      return;
    }
    if (arr1.every(r => !r.productname)) { toast("Please select at least one product"); return; }
    const payload = arr1.filter(r => r.productname).map(r => {
      const rowDiscountPercent = getRowDiscountPercent(r);
      const quantityPacks = safePositiveNumber(r.producQuanity);
      const packSize = safePositiveNumber(r.packSize) || 1;
      const totalPieces = quantityPacks * packSize;
      const rowSubtotal = rowSubtotalPaise(r) / 100;
      const rowDiscountAmount = rowSubtotal * (rowDiscountPercent / 100);
      return {
        productname: r.productname,
        productName: r.displayName || r.productname,
        catNo: r.variantCode || r.productname,
        // PHP calculates amount as producQuanity * price, so send pieces here.
        producQuanity: String(totalPieces),
        quantityPacks: String(quantityPacks),
        packSize: String(packSize),
        totalPieces: String(totalPieces),
        price: String(r.price),
        unitPrice: String(r.price),
        listPriceTotal: payloadAmount(rowSubtotal),
        discount: payloadAmount(rowDiscountAmount),
        discountPercent: String(rowDiscountPercent),
        totalDiscountPercent: String(rowDiscountPercent),
        afterDiscountPrice: payloadAmount(Math.max(0, rowSubtotal - rowDiscountAmount)),
        remarks: buildOrderRemarks(r.variantCode, r.isPriority, orderNote),
        priority: r.isPriority ? "1" : "0",
        isPriority: !!r.isPriority,
      };
    });

    const fd = new FormData();
    fd.append("productorder", JSON.stringify(payload));
    fd.append("Dealer_shipto", shipto);
    fd.append("id", user.Dealer_Id);
    fd.append("staffid", user.assignedstaff);
    fd.append("discount", String(activeDiscount));
    fd.append("subtotal", payloadAmount(discountPayload.subtotal));
    fd.append("discountPercent", String(discountPayload.discountPercent));
    fd.append("discountAmount", payloadAmount(discountPayload.discountAmount));
    fd.append("finalPayableAmount", payloadAmount(discountPayload.finalPayableAmount));
    fd.append("allocatedDiscountPercent", String(discountPayload.allocatedDiscountPercent));
    fd.append("couponDiscountPercent", String(discountPayload.couponDiscountPercent));
    // Normalized discount fields
    fd.append("baseDiscountPercent", String(discountPayload.baseDiscountPercent));
    fd.append("baseDiscountAmount", payloadAmount(discountPayload.baseDiscountAmount));
    fd.append("postBaseAmount", payloadAmount(discountPayload.postBaseAmount));
    fd.append("amountBeforeSlab", payloadAmount(discountPayload.amountBeforeSlab));
    fd.append("additionalDiscountType", String(discountPayload.additionalDiscountType ?? ""));
    fd.append("additionalDiscountAmount", payloadAmount(discountPayload.additionalDiscountAmount));
    fd.append("customDiscountAmount", payloadAmount(discountPayload.customDiscountAmount));
    fd.append("slabDiscountPercent", String(discountPayload.slabDiscountPercent));
    fd.append("slabDiscountAmount", payloadAmount(discountPayload.slabDiscountAmount));
    if (orderNote.trim()) {
      fd.append("note", orderNote.trim());
      fd.append("order_note", orderNote.trim());
      fd.append("Dealer_note", orderNote.trim());
    }
    const customDiscountSources = [
      ...(activeApprovalRequest?.normalizedStatus === "approved"
        ? [activeApprovalRequest]
        : approvedCustomRequest
          ? [approvedCustomRequest]
          : []),
      ...approvedProductCustomRequests,
    ].filter((request, idx, arr) => arr.findIndex((r) => r.id === request.id) === idx);
    if (customDiscountSources.length > 0) {
      fd.append("customDiscountRequestId", customDiscountSources.map((r) => r.id).join(","));
      fd.append("customDiscountStatus", customDiscountSources.every((r) => r.status === "approved") ? "approved" : customDiscountSources[0].status);
      fd.append("customDiscountPercent", String(discountPayload.discountPercent));
      fd.append("customDiscountRequests", JSON.stringify(customDiscountSources.map((r) => ({
        id: r.id,
        scope: r.discountScope ?? "order",
        percent: r.requestedDiscountPercent,
        product: r.targetProduct ?? null,
      }))));
    }
    if (refno) fd.append("refno", refno);
    if (appliedCoupon) fd.append("coupon_code", appliedCoupon.code);

    const targetApiUrl = `/api/dealer-order`;
    const phpPayload = readFormData(fd);

    try {
      await ensureDealerIsActive();
      setLoading(true);
      orderIdempotencyKey.current ||= createIdempotencyKey("dealer-order");
      const { data } = await axios.post(targetApiUrl, fd, { headers: {
        "x-omsons-actor-role": "dealer",
        "x-omsons-actor-id": String(user.Dealer_Id),
        "x-omsons-actor-name": String(user.Dealer_Name ?? ""),
        "idempotency-key": orderIdempotencyKey.current,
      } });
      logPhpExchange("PlaceOrderarray", {
        method: "POST",
        url: targetApiUrl,
        request: phpPayload,
        response: data,
      });
      const placedOrderId = extractOrderIdFromResponse(data) || await getLatestOrderIdForDealer();
      const rowsUsedForOrder = arr1.filter((row) => row.productname);
      saveLocalOrderDetailsFallback(placedOrderId, {
        dealerId: user.Dealer_Id,
        dealerName: user.Dealer_Name,
        order_dealer: user.Dealer_Id,
        Dealer_Name: user.Dealer_Name,
        Dealer_Id: user.Dealer_Id,
        Dealer_Email: user.Dealer_Email,
        Dealer_Number: user.Dealer_Number,
        Dealer_Address: user.Dealer_Address,
        Dealer_shipto: user.Dealer_shipto,
        Dealer_City: user.Dealer_City,
        Dealer_Pincode: user.Dealer_Pincode,
        Dealer_Dealercode: user.Dealer_Dealercode,
        Dealer_Notes: user.Dealer_Notes,
        gst: user.gst,
        creditdays: user.creditdays,
        discount: user.discount,
        staffname: user.staffname,
        note: orderNote.trim() || "",
        order_note: orderNote.trim() || "",
        grossAmount: payloadAmount(discountPayload.subtotal),
        order_amount: payloadAmount(discountPayload.subtotal),
        discountAmount: payloadAmount(discountPayload.discountAmount),
        order_discount_amount: payloadAmount(discountPayload.discountAmount),
        netPayableAmount: payloadAmount(discountPayload.finalPayableAmount),
        order_net_amount: payloadAmount(discountPayload.finalPayableAmount),
        discountPercent: discountPayload.discountPercent,
        allocatedDiscountPercent: discountPayload.allocatedDiscountPercent,
        baseDiscountPercent: discountPayload.baseDiscountPercent,
        baseDiscountAmount: payloadAmount(discountPayload.baseDiscountAmount),
        postBaseAmount: payloadAmount(discountPayload.postBaseAmount),
        additionalDiscountType: discountPayload.additionalDiscountType,
        additionalDiscountAmount: payloadAmount(discountPayload.additionalDiscountAmount),
        customDiscountAmount: payloadAmount(discountPayload.customDiscountAmount),
        slabDiscountPercent: discountPayload.slabDiscountPercent,
        slabDiscountAmount: payloadAmount(discountPayload.slabDiscountAmount),
        couponDiscountPercent: discountPayload.couponDiscountPercent,
        accept_order: "0",
        del_status: "0",
        staffid: user.assignedstaff,
        assignedstaff: user.assignedstaff,
        items: payload.map((item, index) => ({
          ...item,
          productId: item.catNo,
          productName: item.productName,
          productNote: rowsUsedForOrder[index]?.productNote ?? "",
          discountAmount: item.discount,
          finalPrice: item.afterDiscountPrice,
        })),
      });
      await Promise.allSettled([
        saveOrderNoteForHistory(placedOrderId),
        saveOrderSummaryOverride(placedOrderId, payload),
        linkCustomDiscountRequestsToOrder(customDiscountSources, placedOrderId),
        verifySubmittedProductNotes(placedOrderId),
      ]);
      if (placedOrderId) setExpectedOrderNumber(buildExpectedOrderNumber(placedOrderId));
      if (reorderRequest) {
        fetch(`/api/custom-discount-requests/${reorderRequest.id}/reorder-log`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderId: placedOrderId,
            dealerId: user.Dealer_Id,
          }),
        }).catch((err) => console.error("[reorder-log] failed:", err));
      }
      toast.success(data.msg, { autoClose: 5000 });
      if (data.wallet?.used) {
        setWallet((current) => current ? { ...current, availableBalance: Number(data.wallet.balanceAfter) } : current);
      }
      orderIdempotencyKey.current = null;
      clearCart();
      seededRef.current = false;
      setArr([emptyRow()]);
      setOrderNote("");
      handleRemoveCoupon();
      setActiveDraftId(null);
      setDraftBanner(null);
      setReorderRequest(null);
      setDraftApprovalState(null);
      setPerProductDiscountInputs({});
      setCustomDiscountInput("");
      setShowCustomDiscountEditor(false);
      setEditingProductDiscountKey(null);
      setDraftName("Untitled Draft");
      syncDraftUrl(null);
      // Clear the DraftCart from MongoDB if this order originated from the cart page
      if (fromCart && user?.Dealer_Id) {
        fetch(`/api/draft-cart?dealer_id=${encodeURIComponent(user.Dealer_Id)}`, { method: "DELETE" }).catch(() => { });
      }
    } catch (error) {
      logPhpExchange("PlaceOrderarray", {
        method: "POST",
        url: targetApiUrl,
        request: phpPayload,
        error: getAxiosDebugError(error),
      });
      const message = axios.isAxiosError(error)
        ? String((error.response?.data as { message?: string; msg?: string } | undefined)?.message
          ?? (error.response?.data as { message?: string; msg?: string } | undefined)?.msg
          ?? error.message)
        : error instanceof Error
          ? error.message
          : "Order failed, please try again.";
      toast.error(message, { autoClose: 5000 });
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (orderLockedByPendingApproval) {
      toast("This approval request is pending, so the submitted order is locked.");
      return;
    }
    if (!file) return;
    const fd = new FormData();
    fd.append("staffid", user.assignedstaff);
    fd.append("order_dealer", user.Dealer_Id);
    fd.append("exelefile", file);
    const targetApiUrl = `/api/dealer-order`;
    const phpPayload = readFormData(fd);
    try {
      await ensureDealerIsActive();
      setLoading(true);
      orderIdempotencyKey.current ||= createIdempotencyKey("dealer-order");
      const { data } = await axios.post(targetApiUrl, fd, { headers: {
        "x-omsons-actor-role": "dealer",
        "x-omsons-actor-id": String(user.Dealer_Id),
        "x-omsons-actor-name": String(user.Dealer_Name ?? ""),
        "idempotency-key": orderIdempotencyKey.current,
      } });
      logPhpExchange("importdata", {
        method: "POST",
        url: targetApiUrl,
        request: phpPayload,
        response: data,
      });
      toast.success(data.msg);
    } catch (error) {
      logPhpExchange("importdata", {
        method: "POST",
        url: targetApiUrl,
        request: phpPayload,
        error: getAxiosDebugError(error),
      });
      const message = axios.isAxiosError(error)
        ? String((error.response?.data as { message?: string; msg?: string } | undefined)?.message
          ?? (error.response?.data as { message?: string; msg?: string } | undefined)?.msg
          ?? error.message)
        : error instanceof Error
          ? error.message
          : "Upload failed.";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  if (!user) return (
    <div className="flex items-center justify-center h-[60vh] text-gray-400 text-sm">Loading…</div>
  );

  const docDate = moment().format("MMMM Do YYYY");

  return (
    <>
      <ToastContainer position="top-right" autoClose={5000} />

      {/* ── Draft Name Modal ──────────────────────────────────────────────── */}
      {showNameModal && (
        <div className="fixed inset-0 z-[1000] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <h3 className="text-[15px] font-bold text-gray-900 mb-1">Save as Draft</h3>
            <p className="text-[12.5px] text-gray-400 mb-4">Give this draft a name so you can find it easily.</p>
            <input
              autoFocus
              type="text"
              value={pendingDraftName}
              onChange={(e) => setPendingDraftName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && pendingDraftName.trim()) commitSaveDraft(pendingDraftName.trim());
                if (e.key === "Escape") setShowNameModal(false);
              }}
              placeholder="e.g. Q2 Restock Order"
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-[13.5px] text-gray-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all"
            />
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => pendingDraftName.trim() && commitSaveDraft(pendingDraftName.trim())}
                disabled={!pendingDraftName.trim()}
                className="flex-1 py-2.5 bg-gray-900 hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl text-[13px] font-semibold transition-colors cursor-pointer border-none"
              >
                Save Draft
              </button>
              <button
                onClick={() => setShowNameModal(false)}
                className="px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-xl text-[13px] font-medium transition-colors cursor-pointer border-none"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Product Note Popup ──────────────────────────────────────────────── */}
      {noteEditorRowKey !== null && (() => {
        const noteRowIdx = arr1.findIndex((r) => r.key === noteEditorRowKey);
        const noteRow = noteRowIdx >= 0 ? arr1[noteRowIdx] : null;
        if (!noteRow) return null;
        const noteLabel = noteRow.displayName || noteRow.productname || "this product";

        return (
          <div
            className="fixed inset-0 z-[1000] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setNoteEditorRowKey(null)}
          >
            <div
              className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3 mb-1">
                <div className="min-w-0">
                  <h3 className="text-[15px] font-bold text-gray-900">Product Note</h3>
                  <p className="text-[12px] text-gray-400 truncate mt-0.5">{noteLabel}</p>
                </div>
                <button
                  onClick={() => setNoteEditorRowKey(null)}
                  className="flex-shrink-0 text-gray-400 hover:text-gray-600 cursor-pointer bg-transparent border-none"
                  title="Close"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
              <textarea
                autoFocus
                value={noteRow.productNote ?? ""}
                onChange={(e) => updateProductNote(noteRowIdx, e.target.value)}
                disabled={orderLockedByPendingApproval}
                maxLength={500}
                placeholder="Add instructions for this product..."
                className="mt-3 min-h-[120px] w-full resize-y rounded-xl border border-gray-200 px-3 py-2.5 text-[13px] text-gray-700 outline-none transition-colors placeholder:text-gray-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:bg-gray-100 disabled:text-gray-500"
              />
              <div className="flex items-center justify-between mt-2">
                <span className="text-[11px] text-gray-400">{(noteRow.productNote ?? "").length}/500</span>
                <button
                  onClick={() => setNoteEditorRowKey(null)}
                  className="px-4 py-2 bg-gray-900 hover:bg-gray-800 text-white rounded-xl text-[13px] font-semibold transition-colors cursor-pointer border-none"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Busy overlay ──────────────────────────────────────────────────── */}
      {(loading || draftSaving || reorderLoading) && (
        <div className="fixed inset-0 z-[999] bg-black/35 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-white rounded-2xl px-10 py-7 flex flex-col items-center gap-3 shadow-2xl">
            <div className="w-9 h-9 border-[3px] border-gray-200 border-t-indigo-500 rounded-full animate-spin" />
            <span className="text-sm font-medium text-gray-600">
              {reorderLoading ? "Loading reorder data..." : draftSaving ? "Saving draft…" : "Processing…"}
            </span>
          </div>
        </div>
      )}

      <div className="p-7 max-w-[1840px] mx-auto font-[family-name:var(--font-dm-sans)]">

        {/* Draft loaded banner */}
        {draftBanner && (
          <div className="flex items-center justify-between bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-2.5 mb-5 text-[12.5px] text-indigo-700 font-medium">
            <div className="flex items-center gap-2">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              {draftBanner}
            </div>
            <div className="flex items-center gap-3">
              <button onClick={() => router.push("/drafts")}
                className="text-indigo-500 hover:text-indigo-700 text-[11.5px] underline underline-offset-2 cursor-pointer">
                All Drafts
              </button>
              <button onClick={() => setDraftBanner(null)} className="text-indigo-400 hover:text-indigo-600 cursor-pointer">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {discountRejectionDraftRequest && (
          <div className="flex flex-col gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-5 text-[12.5px] text-red-700 font-medium lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-2">
              <svg className="mt-0.5 flex-shrink-0 text-red-500" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <div>
                <p>
                  A custom discount request was disapproved. An order draft has been saved so you can edit and resubmit it.
                </p>
                {discountRejectionDraftRequest.adminNote && (
                  <p className="mt-1 text-[11.5px] text-red-600">
                    Admin note: {discountRejectionDraftRequest.adminNote}
                  </p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => router.push("/drafts")}
              className="w-fit rounded-lg border border-red-200 bg-white px-3 py-1.5 text-[11.5px] font-bold text-red-600 hover:bg-red-100"
            >
              View Drafts
            </button>
          </div>
        )}

        {reorderRequest && (
          <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2.5 mb-5 text-[12.5px] text-emerald-700 font-medium">
            <div className="flex items-center gap-2">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12a9 9 0 0 1-15.4 6.4L3 16" />
                <path d="M3 21v-5h5" />
                <path d="M3 12a9 9 0 0 1 15.4-6.4L21 8" />
                <path d="M21 3v5h-5" />
              </svg>
              Reorder from approved discount - {reorderRequest.requestedDiscountPercent}% discount locked
            </div>
            <button
              onClick={() => {
                setReorderRequest(null);
                seededRef.current = false;
                window.history.replaceState({}, "", "/dashboard/dealer/AddOrderForm");
              }}
              className="text-emerald-500 hover:text-emerald-700 cursor-pointer"
              title="Clear reorder"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        )}

        {/* Wallet balance stays visible before the order details and product form. */}
        {/* <div className={`mb-5 rounded-2xl border px-5 py-4 shadow-sm ${wallet?.status === "active" ? (wallet.availableBalance > 0 ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50") : "border-gray-200 bg-white"}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[10.5px] font-bold uppercase tracking-wider text-gray-500">Dealer Wallet Balance</p>
              <p className={`mt-1 font-mono text-2xl font-bold ${wallet?.status === "active" ? (wallet.availableBalance > 0 ? "text-emerald-700" : "text-red-700") : "text-gray-700"}`}>
                {walletLoading ? "Loading…" : fmt(toPaise(wallet?.availableBalance ?? 0))}
              </p>
              <p className="mt-1 text-xs text-gray-500">Running balance—each successful order deducts its final Net Payable.</p>
            </div>
            <span className={`rounded-full px-3 py-1.5 text-xs font-bold ${wallet?.status === "active" ? (wallet.availableBalance > 0 ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700") : "bg-gray-100 text-gray-600"}`}>
              {walletLoading ? "Loading" : wallet?.status === "active" ? (wallet.availableBalance > 0 ? "Active" : "Exhausted") : "Inactive"}
            </span>
          </div>
        </div> */}

        {
          wallet?.status === "active" && wallet.availableBalance > 0 && (
            <div className={`mb-5 rounded-2xl border px-5 py-4 shadow-sm ${wallet?.status === "active" ? (wallet.availableBalance > 0 ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50") : "border-gray-200 bg-white"}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[10.5px] font-bold uppercase tracking-wider text-gray-500">Wallet Balance</p>
              <p className={`mt-1 font-mono text-2xl font-bold ${wallet?.status === "active" ? (wallet.availableBalance > 0 ? "text-emerald-700" : "text-red-700") : "text-gray-700"}`}>
                {walletLoading ? "Loading…" : fmt(toPaise(wallet?.availableBalance ?? 0))}
              </p>
              <p className="mt-1 text-xs text-gray-500">Running balance—each successful order deducts its final Net Payable.</p>
            </div>
            <span className={`rounded-full px-3 py-1.5 text-xs font-bold ${wallet?.status === "active" ? (wallet.availableBalance > 0 ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700") : "bg-gray-100 text-gray-600"}`}>
              {walletLoading ? "Loading" : wallet?.status === "active" ? (wallet.availableBalance > 0 ? "Active" : "Exhausted") : "Inactive"}
            </span>
          </div>
        </div>
          )
         }

        {/* Page heading */}
        <div className="mb-6 flex items-start justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Place Order</h1>
              {activeApprovalRequest && !reorderRequest ? (
                <span className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 font-mono text-[12px] font-bold text-amber-700">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-amber-500">Request Ref.</span>
                  {activeApprovalRequest.requestReference || activeApprovalRequest.id}
                </span>
              ) : (
                <span className="inline-flex items-center gap-2 rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-1.5 font-mono text-[12px] font-bold text-indigo-700">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-400">Order No.</span>
                  {expectedOrderLoading ? "Loading..." : expectedOrderNumber || "OM/..."}
                </span>
              )}
            </div>
            <p className="text-sm text-gray-500 mt-1">{docDate} · {user.Dealer_Name}</p>
          </div>
          <button onClick={() => router.push("/drafts")}
            className="inline-flex items-center gap-1.5 text-[12.5px] text-gray-400 hover:text-indigo-600 border border-gray-200 hover:border-indigo-200 hover:bg-indigo-50 px-3 py-2 rounded-xl transition-all cursor-pointer bg-white">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            My Drafts
          </button>
        </div>

        {/* Dealer info card */}
        <div className="bg-white border border-gray-200 rounded-2xl p-6 mb-5">
          <h2 className="text-lg font-bold text-gray-900 tracking-tight">{user.Dealer_Name}</h2>
          <p className="text-xs text-gray-400 mb-5">Dealer code: {user.Dealer_Dealercode ?? "—"}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10.5px] font-bold text-gray-400 uppercase tracking-wider">Bill To</label>
              <div className="text-[13.5px] text-gray-800 font-medium bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 min-h-[72px] whitespace-pre-wrap">
{(() => {
  const address = String(user?.Dealer_Address ?? "").trim();

  return address
    ? address[0].toUpperCase() + address.slice(1).toLowerCase()
    : "—";
})()}              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10.5px] font-bold text-gray-400 uppercase tracking-wider">GST Number</label>
              <div className="text-[13.5px] text-gray-800 font-medium bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 font-mono">{user.gst}</div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10.5px] font-bold text-gray-400 uppercase tracking-wider">Ship To</label>
              <textarea
                className="text-[13.5px] text-gray-800 bg-white border border-gray-200 rounded-xl px-3 py-2.5 outline-none resize-none min-h-[72px] focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all disabled:bg-gray-100 disabled:text-gray-500"
                value={shipto} onChange={(e) => setShipto(e.target.value)}
                disabled={orderLockedByPendingApproval}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10.5px] font-bold text-gray-400 uppercase tracking-wider">Document Date</label>
              <div className="text-[13.5px] text-gray-800 font-medium bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5">{docDate}</div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10.5px] font-bold text-gray-400 uppercase tracking-wider">Phone</label>
              <div className="text-[13.5px] text-gray-800 font-medium bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 font-mono">{user.Dealer_Number}</div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10.5px] font-bold text-gray-400 uppercase tracking-wider">Email</label>
              <div className="text-[13.5px] text-gray-800 font-medium bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 truncate">{user.Dealer_Email}</div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10.5px] font-bold text-gray-400 uppercase tracking-wider">Customer Ref No.</label>
              <input type="text" placeholder="Enter reference number" value={refno} onChange={(e) => setRefno(e.target.value)}
                disabled={orderLockedByPendingApproval}
                className="text-[13.5px] text-gray-800 bg-white border border-gray-200 rounded-xl px-3 py-2.5 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all placeholder:text-gray-300 disabled:bg-gray-100 disabled:text-gray-500" />
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <label className="text-[10.5px] font-bold text-gray-400 uppercase tracking-wider">Discount Rate</label>
                <button
                  type="button"
                  onClick={() => {
                    setCustomDiscountInput(String(visibleCustomRequest?.requestedDiscountPercent ?? activeDiscount));
                    setShowCustomDiscountEditor(true);
                  }}
                  disabled={orderLockedByPendingApproval}
                  className="text-[11px] font-bold text-indigo-600 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-100 rounded-lg px-2 py-1 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                >
                  ✏️ Edit
                </button>
              </div>
              <div className={`text-[13.5px] font-semibold rounded-xl px-3 py-2.5 border flex items-center justify-between ${hasAnyDiscount ? "text-emerald-700 bg-emerald-50 border-emerald-200" : "text-slate-600 bg-slate-50 border-slate-200"
                }`}>
                <span>{discountPayload.discountPercent}% effective discount</span>
                <span className="text-[11px] font-medium">
                  {discountPayload.additionalDiscountType === "custom"
                    ? "approved custom selected"
                    : `${discountPayload.baseDiscountPercent}% base${hasSlabDiscount ? ` + ${discountPayload.slabDiscountPercent}% slab` : ""}`}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Discount Stack — Sequential Breakdown */}
        <div className={`border rounded-2xl p-5 mb-5 ${hasAnyDiscount ? "bg-emerald-50/70 border-emerald-200" : "bg-white border-gray-200"
          }`}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center border ${hasAnyDiscount ? "bg-emerald-600 border-emerald-600 text-white" : "bg-slate-50 border-slate-200 text-slate-500"
                }`}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><circle cx="7" cy="7" r="1" />
                </svg>
              </div>
              <div>
                <p className="text-[13px] font-semibold text-gray-900">Discount Breakdown</p>
                <p className={`text-[12px] mt-0.5 ${hasAnyDiscount ? "text-emerald-700" : "text-gray-500"}`}>
                  Base discount applies first, then either slab discount or approved custom discount
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
              <button
                type="button"
                onClick={() => {
                  setCustomDiscountInput(String(visibleCustomRequest?.requestedDiscountPercent ?? activeDiscount));
                  setShowCustomDiscountEditor((v) => !v);
                }}
                disabled={orderLockedByPendingApproval}
                className="col-span-2 inline-flex items-center justify-center gap-1.5 rounded-xl border border-indigo-200 bg-white px-3 py-2 text-[12px] font-bold text-indigo-700 hover:bg-indigo-50 transition-colors disabled:cursor-not-allowed disabled:opacity-40 sm:col-span-1"
              >
                <span>✏️</span>
                Custom Discount
              </button>
            </div>
          </div>

          {/* Step-by-step discount breakdown */}
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {/* 1. Gross Subtotal */}
            <div className="rounded-xl border border-gray-200 bg-white px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Gross Subtotal</p>
              <p className="mt-1 font-mono text-[13px] font-semibold text-gray-900">{fmt(subtotalPaise)}</p>
            </div>

            {/* 2. Base Discount */}
            <div className={`rounded-xl border px-3 py-2 ${discountPayload.baseDiscountPercent > 0 ? "border-amber-200 bg-amber-50/50" : "border-gray-200 bg-white"}`}>
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Base Discount</p>
              <p className={`mt-1 font-mono text-[13px] font-semibold ${discountPayload.baseDiscountPercent > 0 ? "text-amber-700" : "text-gray-500"}`}>
                {discountPayload.baseDiscountPercent}%
              </p>
              <p className="mt-0.5 text-[10px] text-gray-400 font-mono">
                {discountPayload.baseDiscountAmount > 0 ? `−${fmt(toPaise(discountPayload.baseDiscountAmount))}` : "—"}
              </p>
              <div className="mt-1 space-y-0.5 text-[9px] text-gray-400">
                {discountPayload.allocatedDiscountPercent > 0 && <p>Allocated: {discountPayload.allocatedDiscountPercent}%</p>}
                {discountPayload.couponDiscountPercent > 0 && <p>Coupon: {discountPayload.couponDiscountPercent}% {appliedCoupon?.code ? `(${appliedCoupon.code})` : ""}</p>}
                {(approvedCustomDiscountPercent ?? 0) > 0 && <p>Approved custom target: {approvedCustomDiscountPercent}%</p>}
              </div>
            </div>

            {/* 3. Post Base Amount */}
            <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-500">Post Base Amount</p>
              <p className="mt-1 font-mono text-[13px] font-bold text-indigo-700">
                {fmt(toPaise(discountPayload.postBaseAmount))}
              </p>
              <p className="mt-0.5 text-[9px] text-indigo-400">
                {discountPayload.additionalDiscountType === "custom" ? "Custom discount applies from here" : "Slab discount is determined from this"}
              </p>
            </div>

            {/* 4. Additional Discount */}
            <div className={`rounded-xl border px-3 py-2 ${(discountPayload.additionalDiscountAmount > 0) ? "border-emerald-200 bg-emerald-50/50" : "border-gray-200 bg-white"}`}>
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                {discountPayload.additionalDiscountType === "custom" ? "Approved Custom Discount" : "slab discount"}
              </p>
              <p className={`mt-1 font-mono text-[13px] font-semibold ${(discountPayload.additionalDiscountAmount > 0) ? "text-emerald-700" : "text-gray-500"}`}>
                {discountPayload.additionalDiscountType === "custom"
                  ? "Approved"
                  : `${discountPayload.slabDiscountPercent}%`}
              </p>
              <p className="mt-0.5 text-[10px] text-gray-400 font-mono">
                {discountPayload.additionalDiscountAmount > 0 ? `−${fmt(toPaise(discountPayload.additionalDiscountAmount))}` : "—"}
              </p>
              <p className="mt-0.5 text-[10px] text-gray-400">
                {discountPayload.additionalDiscountType === "custom"
                  ? "slab discount is disabled while custom is active"
                  : discountStatusMessage}
              </p>
            </div>

            {/* 5. Effective Total Discount */}
            <div className={`rounded-xl border px-3 py-2 ${hasAnyDiscount ? "border-emerald-200 bg-white" : "border-gray-200 bg-white"}`}>
              <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">Total Savings</p>
              <p className="mt-1 font-mono text-[13px] font-bold text-emerald-700">
                {discountPayload.discountPercent}%
              </p>
              <p className="mt-0.5 text-[10px] text-emerald-600 font-mono">
                {discountPayload.discountAmount > 0 ? `−${fmt(discountAmountPaise)}` : "—"}
              </p>
            </div>

            {/* 6. Final Payable */}
            <div className="rounded-xl border border-gray-900 bg-gray-900 px-3 py-2 text-white">
              <p className="text-[10px] font-bold uppercase tracking-wider text-white/60">Final Payable</p>
              <p className="mt-1 font-mono text-[14px] font-bold">{fmt(finalPayablePaise)}</p>
            </div>
          </div>
        </div>

        {(showCustomDiscountEditor || visibleCustomRequest) && (
          <div className="bg-white border border-indigo-200 rounded-2xl p-5 mb-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-[14px] font-bold text-gray-900">Custom Discount Approval</h3>
                  {visibleCustomRequest && (
                    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${visibleCustomRequest.normalizedStatus === "approved"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : visibleCustomRequest.normalizedStatus === "rejected"
                          ? "border-red-200 bg-red-50 text-red-700"
                          : "border-amber-200 bg-amber-50 text-amber-700"
                      }`}>
                      {visibleCustomRequest.normalizedStatus === "rejected"
                        ? "Disapproved"
                        : `${String(visibleCustomRequest.normalizedStatus).charAt(0).toUpperCase()}${String(visibleCustomRequest.normalizedStatus).slice(1)}`}
                    </span>
                  )}
                </div>
                <p className="text-[12px] text-gray-500 mt-1">
                  Request a one-time discount for this order or one selected product. Approved requests are applied automatically while the matching items stay unchanged.
                </p>
                {isWaitingForApproval && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-amber-700">
                    <span>Your order has been submitted for discount approval. You can place it after the request is approved.</span>
                    <button
                      type="button"
                      onClick={() => router.push("/dashboard/dealer/approved-discounts")}
                      className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700 hover:bg-amber-100"
                    >
                      View Approval Status
                    </button>
                  </div>
                )}
                {isApprovedDraftRequest && (
                  <p className="mt-2 text-[12px] font-semibold text-emerald-700">
                    Discount approved. Review the order and place it.
                  </p>
                )}
                {visibleCustomRequest?.discountScope === "product" && (
                  <p className="mt-2 text-[12px] font-semibold text-indigo-700">
                    Product: {visibleCustomRequest.targetProduct?.displayName || visibleCustomRequest.targetProduct?.variantCode || "Selected product"}
                  </p>
                )}
                {visibleCustomRequest?.adminNote && (
                  <p className="mt-2 text-[12px] text-gray-700 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
                    Admin note: {visibleCustomRequest.adminNote}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px] min-w-[260px]">
                <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
                  <p className="font-bold uppercase tracking-wider text-gray-400">Current</p>
                  <p className="mt-1 font-mono text-[13px] font-bold text-gray-900">{baseDiscountPayload.baseDiscountPercent}%</p>
                </div>
                <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2">
                  <p className="font-bold uppercase tracking-wider text-indigo-500">Requested</p>
                  <p className="mt-1 font-mono text-[13px] font-bold text-indigo-700">
                    {visibleCustomRequest?.requestedOrderDiscountPercent ?? visibleCustomRequest?.requestedDiscountPercent ?? requestedCustomDiscountPercent}%
                  </p>
                </div>
              </div>
            </div>

            {showCustomDiscountEditor && !orderLockedByPendingApproval && (
              <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-[220px_260px_1fr_auto] lg:items-end">
                <div>
                  <label className="text-[10.5px] font-bold text-gray-400 uppercase tracking-wider">Applies To</label>
                  <select
                    value={customDiscountScope}
                    onChange={(e) => setCustomDiscountScope(e.target.value as CustomDiscountScope)}
                    className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-[13.5px] font-semibold text-gray-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                  >
                    <option value="order">Entire order</option>
                    <option value="product">Individual product</option>
                  </select>
                </div>
                {customDiscountScope === "product" && (
                  <div>
                    <label className="text-[10.5px] font-bold text-gray-400 uppercase tracking-wider">Product</label>
                    <select
                      value={selectedCustomDiscountProduct ? getProductKey(selectedCustomDiscountProduct) : ""}
                      onChange={(e) => setCustomDiscountProductKey(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-[13.5px] font-semibold text-gray-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                    >
                      {productRows.map((row) => (
                        <option key={`${row.key}-${getProductKey(row)}`} value={getProductKey(row)}>
                          {row.variantCode || row.productname} - {row.displayName || "Product"}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label className="text-[10.5px] font-bold text-gray-400 uppercase tracking-wider">Custom Discount %</label>
                  <div className="mt-1 flex gap-2">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={0.5}
                      value={customDiscountInput}
                      onChange={(e) => setCustomDiscountInput(e.target.value)}
                      className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-[13.5px] font-mono font-semibold text-gray-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                      placeholder="e.g. 18"
                    />

                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-gray-200 px-3 py-2">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Requested Savings</p>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={requestedCustomDiscountAmount ? Number(requestedCustomDiscountAmount.toFixed(2)) : ""}
                      onChange={(e) => {
                        const amount = Math.max(0, Number(e.target.value) || 0);
                        if (!customDiscountBaseSubtotal) return;
                        const percent = Math.min(100, (amount / customDiscountBaseSubtotal) * 100);
                        setCustomDiscountInput(percent ? String(Number(percent.toFixed(4))) : "");
                      }}
                      className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1 font-mono text-[13px] font-bold text-indigo-700 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                      placeholder="e.g. 100"
                    />
                  </div>
                  <div className="rounded-xl border border-gray-900 bg-gray-900 px-3 py-2 text-white">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-white/60">Requested Payable</p>
                    <p className="mt-1 font-mono text-[13px] font-bold">{fmt(toPaise(requestedCustomFinalPayable))}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleRequestCustomDiscount}
                    disabled={customDiscountSubmitting || (customDiscountScope === "order" ? requestedCustomDiscountPercent <= baseDiscountPayload.baseDiscountPercent : !hasRequestedProductDiscounts)}
                    className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-4 py-2.5 text-[13px] font-bold text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {customDiscountSubmitting ? "Sending..." : "Request Approval"}
                  </button>
                  <button
                    type="button"
                    onClick={() => refreshCustomDiscountRequests()
                      .then(() => toast.success("Approval status refreshed."))
                      .catch(() => toast.error("Could not refresh approval status."))}
                    className="inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-[12px] font-semibold text-gray-600 hover:bg-gray-50"
                  >
                    Refresh
                  </button>
                  {customDiscountScope === "product" && (
                      <button
                        type="button"
                        onClick={addSelectedCustomProductDiscount}
                        disabled={customDiscountSubmitting || !selectedCustomDiscountProduct || requestedCustomDiscountPercent <= (approvedCustomDiscountPercent ?? baseDiscountPayload.baseDiscountPercent)}
                        className="h-full w-auto py-2 px-2 my-auto shrink-0 rounded-xl border border-indigo-200 bg-indigo-50 text-[14px] text-indigo-700 transition-colors hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label="Add product custom discount"
                        title="Add product custom discount"
                      >
                        + Add product
                      </button>
                    )}
                </div>
                {customDiscountScope === "product" && requestedProductDiscountRows.length > 0 && (
                  <div className="lg:col-span-4 rounded-xl border border-indigo-100 bg-indigo-50/40 p-3">
                    <p className="text-[10.5px] font-bold uppercase tracking-wider text-indigo-500">Selected Product Discounts</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {requestedProductDiscountRows.map(({ row, productKey, normalizedKey, percent }) => (
                        <div key={`${row.key}-${normalizedKey}`} className="inline-flex items-center gap-2 rounded-lg border border-indigo-200 bg-white px-2.5 py-1.5 text-[12px] font-semibold text-gray-800">
                          <span className="max-w-[260px] truncate">{row.variantCode || row.productname} - {row.displayName || "Product"}</span>
                          <span className="font-mono font-bold text-indigo-700">{percent}%</span>
                          <button
                            type="button"
                            onClick={() => removeCustomProductDiscount(productKey)}
                            className="flex h-5 w-5 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
                            aria-label="Remove product custom discount"
                            title="Remove"
                          >
                            x
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Coupon */}
        <div className="bg-white border border-gray-200 rounded-2xl p-5 mb-5">
          <div className="flex items-center gap-2 mb-3">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-violet-500">
              <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><circle cx="7" cy="7" r="1" />
            </svg>
            <span className="text-[13px] font-semibold text-gray-800">Discount Code</span>
            {appliedCoupon && (
              <span className="ml-auto text-[11px] font-bold px-2.5 py-0.5 bg-violet-100 text-violet-700 rounded-full border border-violet-200">
                {appliedCoupon.code} · +{appliedCoupon.pct}%
              </span>
            )}
          </div>
          {!appliedCoupon ? (
            <div className="flex flex-col gap-2 sm:flex-row">
              <input type="text" placeholder="Enter discount code" value={couponInput}
                onChange={e => { setCouponInput(e.target.value.toUpperCase()); setCouponError(""); setCouponSuccess(""); }}
                onKeyDown={e => { if (e.key === "Enter") handleApplyCoupon(); }}
                disabled={orderLockedByPendingApproval}
                className={`flex-1 text-[13px] text-gray-900 border rounded-xl px-4 py-2.5 outline-none transition-all font-mono tracking-wider placeholder:text-gray-300 placeholder:font-normal ${couponError ? "border-red-300 bg-red-50/30 focus:ring-2 focus:ring-red-100" : "border-gray-200 focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                  } disabled:bg-gray-100 disabled:text-gray-500`}
              />
              <button onClick={handleApplyCoupon} disabled={orderLockedByPendingApproval || !couponInput.trim()}
                className="px-5 py-2.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[13px] font-semibold rounded-xl transition-colors">
                Apply
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-3 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-full bg-violet-600 flex items-center justify-center flex-shrink-0">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"><path d="M20 6 9 17l-5-5" /></svg>
                </div>
                <div>
                  <p className="text-[13px] font-bold text-violet-800 font-mono tracking-wider">{appliedCoupon.code}</p>
                  <p className="text-[11px] text-violet-600 mt-0.5">Coupon adds {appliedCoupon.pct}% to the allocated and slab discounts</p>
                </div>
              </div>
              <button onClick={handleRemoveCoupon} disabled={orderLockedByPendingApproval}
                className="text-[12px] font-semibold text-violet-600 hover:text-red-600 px-3 py-1.5 rounded-lg hover:bg-red-50 transition-all border border-violet-200 hover:border-red-200">
                Remove
              </button>
            </div>
          )}
          {couponError && (
            <p className="text-[12px] text-red-600 mt-2 flex items-center gap-1.5">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><path d="M12 8v4m0 4h.01" /></svg>
              {couponError}
            </p>
          )}
          {couponSuccess && appliedCoupon && <p className="text-[12px] text-emerald-600 mt-2">{couponSuccess}</p>}
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-5">
          {(["manual", "excel"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} disabled={orderLockedByPendingApproval}
              className={`px-5 py-2 rounded-xl text-[13px] font-medium border transition-all duration-150 cursor-pointer ${tab === t ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50 hover:text-gray-700"
                } disabled:cursor-not-allowed disabled:opacity-40`}>
              {t === "manual" ? "Manual Entry" : "Upload Excel"}
            </button>
          ))}
        </div>

        {/* ── MANUAL TAB ───────────────────────────────────────────────────── */}
        {tab === "manual" && (
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">

            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div>
                <h3 className="text-[15px] font-semibold text-gray-900">Product List</h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  {arr1.filter(r => r.productname).length} product{arr1.filter(r => r.productname).length !== 1 ? "s" : ""} selected
                  {activeDraftId && <span className="ml-2 text-indigo-500 font-medium">· {draftName}</span>}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {hasAnyDiscount && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full text-[11px] font-semibold">
                    {discountPayload.discountPercent}% total discount
                  </span>
                )}
                {cartItems.length > 0 && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full text-[11px] font-semibold">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M20 6 9 17l-5-5" /></svg>
                    {cartItems.length} from cart
                  </span>
                )}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="pl-6 pr-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-gray-400 w-10">#</th>
                    <th className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-gray-400 min-w-[320px]">Product / Priority</th>
                    <th className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-gray-400 w-32">Quantity</th>
                    <th className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-gray-400 w-28">Pack Size</th>
                    <th className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-gray-400 w-24">Pieces</th>
                    <th className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-gray-400 w-28">Unit Price</th>
                    <th className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-gray-400 w-28">Gross amount</th>
                    <th className={`px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider w-44 ${hasAnyDiscount ? "text-emerald-600" : "text-gray-400"}`}>
                      Discount
                    </th>
                    <th className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-gray-400 w-28">Final Price</th>
                    <th className="pl-3 pr-6 py-2.5 w-16"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {arr1.map((row, idx) => {
                    const listPrice = rowSubtotalPaise(row);
                    const baseListPrice = rowBaseListPrice(row);
                    const rowDiscountPercent = getRowDiscountPercent(row);
                    const discAmt = Math.round(listPrice * (rowDiscountPercent / 100));
                    const rowTotal = Math.max(0, listPrice - discAmt);
                    const totalUnits = safePositiveNumber(row.producQuanity) * (safePositiveNumber(row.packSize) || 1);
                    const rowSelection = resolveRowSelection(row);
                    const selectedCatalogueOption = findCatalogueOption(row, rowSelection.variantSku);
                    const selectedVariantSpecs = getSelectedVariantSpecs(rowSelection.variant);
                    const selectedProduct = rowSelection.product ?? catalogueIndex?.productsBySku[String(rowSelection.productSku)] ?? null;
                    const metaKey = rowSelection.variantSku || row.productname || row.variantCode;
                    const meta = variantLookup[metaKey] ?? variantLookup[row.productname];
                    const productKey = getProductKey(row);
                    const globalPercent = approvedCustomDiscountPercent ?? baseDiscountPayload.baseDiscountPercent;
                    const approvedProductReq = getApprovedProductCustomRequest(row);
                    const approvedProductTotal = approvedProductReq ? Math.min(100, Math.max(0, Number(approvedProductReq.requestedDiscountPercent) || 0)) : 0;
                    const productExtraPercent = approvedProductReq ? Math.max(0, approvedProductTotal - globalPercent) : 0;
                    const pendingProductReq = getProductPendingRequest(row);
                    const isEditingThisRow = editingProductDiscountKey === productKey;
                    const currentProductInput = perProductDiscountInputs[productKey] ?? globalPercent;
                    const rowDisplayName = row.displayName || selectedProduct?.name || meta?.productName || row.productname;

                    return (
                      <tr key={row.key} className={`hover:bg-gray-50/50 transition-colors${pendingProductReq ? " border-l-2 border-amber-400" : ""}`}>
                        <td className="pl-6 pr-3 py-2.5">
                          <span className="text-[11px] text-gray-300 font-mono">{String(idx + 1).padStart(2, "0")}</span>
                        </td>
                        <td className="px-3 py-2.5">
                            {(row.displayName || selectedProduct || row.productname) && (
                            <div className="flex items-center gap-2 mb-1.5">
                              {meta?.image || selectedProduct?.images?.[0] ? (
                                <Image
                                  src={meta?.image || selectedProduct?.images?.[0] || ""}
                                  alt={rowDisplayName}
                                  width={28}
                                  height={28}
                                  unoptimized
                                  className="w-7 h-7 object-contain rounded border border-gray-100 bg-gray-50 flex-shrink-0"
                                />
                              ) : (
                                <div className="w-7 h-7 rounded border border-gray-100 bg-gray-50 flex-shrink-0 flex items-center justify-center">
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.5">
                                    <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" />
                                  </svg>
                                </div>
                              )}
                              <div className="min-w-0">
                                <p className="text-[12px] font-semibold text-gray-800 truncate leading-tight">
                                  {rowDisplayName}
                                  {row.variantCode && (
                                    <span className="ml-1.5 font-mono text-[10px] font-semibold text-amber-600">
                                      {row.variantCode}
                                    </span>
                                  )}
                                </p>
                                {selectedVariantSpecs.length > 0 && (
                                  <div className="mt-1 flex flex-wrap gap-1">
                                    {selectedVariantSpecs.map(([label, value]) => (
                                      <span
                                        key={`${label}-${value}`}
                                        className="inline-flex max-w-[180px] items-center gap-0.5 truncate rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[9px] font-medium text-slate-600"
                                        title={`${label}: ${value}`}
                                      >
                                        <span className="font-semibold text-slate-400">{label}:</span>
                                        <span className="truncate">{value}</span>
                                      </span>
                                    ))}
                                  </div>
                                )}
                                <div className="mt-1 flex flex-wrap items-center gap-1">
                                  {row.isPriority && (
                                    <span className="inline-flex px-2 py-0.5 bg-red-50 border border-red-200 text-red-700 rounded-full text-[10px] font-bold">
                                      Priority delivery
                                    </span>
                                  )}
                                  {!!(row.productNote ?? "").trim() && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-50 border border-indigo-200 text-indigo-700 rounded-full text-[10px] font-bold">
                                      <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                                        <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                                      </svg>
                                      Note added
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          )}
                          <div className="flex flex-col gap-1.5">
                            <Select<CatalogueNumberOption, false>
                              options={optionList}
                              value={selectedCatalogueOption}
                              onChange={(option) => handleChangeSelect(idx, option?.value ?? "")}
                              isDisabled={orderLockedByPendingApproval}
                              filterOption={catalogueFilter}
                              isClearable
                              placeholder="Search Catalogue No."
                              noOptionsMessage={() => "No catalogue number found"}
                              styles={catalogueSelectStyles}
                              menuPortalTarget={typeof window !== "undefined" ? document.body : null}
                              menuPosition="fixed"
                              menuPlacement="auto"
                              maxMenuHeight={260}
                              menuShouldScrollIntoView={false}
                              components={{
                                IndicatorSeparator: () => null,
                                Option: (props) => (
                                  <components.Option {...props}>
                                    <div
                                      className={`mx-1 my-1 rounded-xl border px-3 py-2.5 transition-all ${
                                        props.isFocused
                                          ? "border-indigo-200 bg-indigo-50 shadow-sm"
                                          : props.isSelected
                                            ? "border-emerald-200 bg-emerald-50"
                                            : "border-transparent bg-white"
                                      }`}
                                    >
                                      <div className="text-[12px] font-bold font-mono text-gray-900">
                                        {props.data.value}
                                      </div>
                                      <div className="mt-0.5 text-[11px] text-gray-600 leading-tight">
                                        {props.data.productName}
                                      </div>
                                      {(props.data.specSummary || props.data.descriptor) && (
                                        <div className="mt-0.5 text-[10px] text-gray-400 leading-tight">
                                          {props.data.specSummary || props.data.descriptor}
                                        </div>
                                      )}
                                    </div>
                                  </components.Option>
                                ),
                                SingleValue: (props) => (
                                  <components.SingleValue {...props}>
                                    <div className="flex flex-col">
                                      <span className="text-[12px] font-bold font-mono text-gray-900">
                                        {props.data.value}
                                      </span>
                                    </div>
                                  </components.SingleValue>
                                ),
                              }}
                            />
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center border border-gray-200 rounded-xl overflow-hidden w-fit">
                            <button onClick={() => updateQuantity(idx, row.producQuanity - 1)} disabled={orderLockedByPendingApproval}
                              className="w-8 h-[34px] flex items-center justify-center bg-gray-50 hover:bg-gray-100 text-gray-600 text-base transition-colors border-none cursor-pointer">−</button>
                            <input type="number" value={row.producQuanity} onChange={(e) => updateQuantity(idx, parseInt(e.target.value) || 1)} min={1} disabled={orderLockedByPendingApproval}
                              className="w-12 h-[34px] text-center text-[13px] font-semibold text-gray-900 font-mono border-l border-gray-200 outline-none bg-white" />
                            <span className="h-[34px] flex items-center pr-2 text-[11px] font-semibold text-gray-400 bg-white border-r border-gray-200 select-none">Packs</span>
                            <button onClick={() => updateQuantity(idx, row.producQuanity + 1)} disabled={orderLockedByPendingApproval}
                              className="w-8 h-[34px] flex items-center justify-center bg-gray-50 hover:bg-gray-100 text-gray-600 text-base transition-colors border-none cursor-pointer">+</button>
                          </div>
                          <p className="text-[11px] text-gray-400 mt-1 font-mono">pack of {row.producQuanity !== 1 ? "" : ""}  {totalUnits} pc{totalUnits !== 1 ? "s" : ""} </p>
                        </td>
                        <td className="px-3 py-2.5">
                          {row.packSize > 1 ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 border border-amber-200 text-amber-700 rounded text-[11px] font-semibold font-mono">
                              {row.producQuanity} × {row.packSize}
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 bg-gray-50 border border-gray-200 text-gray-500 rounded text-[11px] font-mono">
                              1
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="inline-flex items-center px-2.5 py-1 bg-indigo-50 border border-indigo-200 text-indigo-700 rounded-lg text-[12px] font-bold font-mono">
                            {totalUnits}
                          </span>
                          <p className="text-[10px] text-gray-400 mt-0.5">pc{totalUnits !== 1 ? "s" : ""}</p>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="font-mono text-[13px] font-semibold text-slate-700">
                            {row.price > 0 ? fmt(toPaise(row.price)) : "—"}
                          </span>
                          {row.price > 0 && (
                            <p className="text-[10px] text-gray-400 mt-0.5">per pc.</p>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="font-mono text-[13px] text-gray-600 font-semibold">
                            {listPrice > 0 ? fmt(listPrice) : "—"}
                          </span>
                          {listPrice > 0 && (
                            <p className="text-[10px] text-gray-400 mt-0.5">
                              {row.producQuanity} pack{row.producQuanity !== 1 ? "s" : ""} × ₹{baseListPrice.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </p>
                          )}
                        </td>
                        <td className="px-3 py-2.5 min-w-[160px]">
                          <div className="space-y-0.5">
                            <p className="text-[10px] text-gray-400 font-mono leading-tight">
                              Base Discount: {globalPercent}%
                            </p>
                            <div className="flex items-center gap-1">
                              <span className={`text-[10px] font-mono leading-tight ${productExtraPercent > 0 ? "text-indigo-600 font-semibold" : "text-gray-400"}`}>
                                Product: {productExtraPercent > 0 ? `+${productExtraPercent}` : "0"}%
                              </span>
                              {row.productname && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (isEditingThisRow) {
                                      setEditingProductDiscountKey(null);
                                    } else {
                                      setEditingProductDiscountKey(productKey);
                                      setPerProductDiscountInputs((prev) => ({
                                        ...prev,
                                        [productKey]: prev[productKey] ?? (approvedProductTotal || globalPercent),
                                      }));
                                    }
                                  }}
                                  disabled={orderLockedByPendingApproval}
                                  className={`w-[18px] h-[18px] flex items-center justify-center rounded transition-colors ${isEditingThisRow ? "bg-indigo-100 text-indigo-700" : "text-indigo-400 hover:bg-indigo-50 hover:text-indigo-600"}`}
                                  title="Edit product discount"
                                >
                                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                                    <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                                  </svg>
                                </button>
                              )}
                            </div>
                            <div className="border-t border-dashed border-gray-200 pt-0.5">
                              <span className={`font-mono text-[11px] font-bold ${rowDiscountPercent > 0 ? "text-emerald-600" : "text-gray-400"}`}>
                                {rowDiscountPercent}% off
                              </span>
                            </div>
                            {discAmt > 0 && (
                              <span className="block font-mono text-[11px] font-semibold text-emerald-600">
                                −{fmt(discAmt)}
                              </span>
                            )}
                            {isEditingThisRow && (
                              <div className="pt-1.5 space-y-1.5">
                                <div className="flex items-center border border-indigo-200 rounded-lg overflow-hidden w-fit bg-white shadow-sm">
                                  <button
                                    type="button"
                                    onClick={() => setPerProductDiscountInputs((prev) => ({
                                      ...prev,
                                      [productKey]: Math.max(globalPercent, (prev[productKey] ?? globalPercent) - 0.5),
                                    }))} disabled={orderLockedByPendingApproval}
                                    className="w-7 h-[26px] flex items-center justify-center bg-indigo-50 hover:bg-indigo-100 text-indigo-600 text-xs font-bold transition-colors border-none cursor-pointer"
                                  >−</button>
                                  <span className="w-10 h-[26px] flex items-center justify-center text-[11px] font-mono font-bold text-indigo-700 border-x border-indigo-200 bg-white">
                                    {currentProductInput}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => setPerProductDiscountInputs((prev) => ({
                                      ...prev,
                                      [productKey]: Math.min(100, (prev[productKey] ?? globalPercent) + 0.5),
                                    }))} disabled={orderLockedByPendingApproval}
                                    className="w-7 h-[26px] flex items-center justify-center bg-indigo-50 hover:bg-indigo-100 text-indigo-600 text-xs font-bold transition-colors border-none cursor-pointer"
                                  >+</button>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleRequestProductDiscount(row)}
                                  disabled={orderLockedByPendingApproval || currentProductInput <= globalPercent || perProductSubmitting === productKey}
                                  className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1 text-[10px] font-bold text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors border-none cursor-pointer"
                                >
                                  {perProductSubmitting === productKey ? "Sending…" : "Request ▸"}
                                </button>
                              </div>
                            )}
                            {pendingProductReq && !isEditingThisRow && (
                              <span className="inline-flex items-center gap-1 mt-0.5 text-[9px] font-bold text-amber-600">
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                                pending
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          {listPrice > 0 && discAmt > 0 && (
                            <span className="block font-mono text-[11px] text-gray-400 line-through">{fmt(listPrice)}</span>
                          )}
                          <span className="font-mono text-[13px] font-semibold text-emerald-700">
                            {rowTotal > 0 ? fmt(rowTotal) : "—"}
                          </span>
                        </td>
                        <td className="pl-3 pr-6 py-2.5 align-top">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => togglePriority(idx)}
                              title={row.isPriority ? "Priority delivery on" : "Mark this product as priority"}
                              disabled={orderLockedByPendingApproval}
                              className={`w-[30px] h-[30px] flex items-center justify-center rounded-lg border transition-colors cursor-pointer ${row.isPriority
                                  ? "bg-red-600 border-red-600 text-white shadow-sm"
                                  : "bg-white border-red-200 text-red-500 hover:bg-red-50"
                                } disabled:cursor-not-allowed disabled:opacity-40`}
                            >
                              <svg width="13" height="13" viewBox="0 0 24 24" fill={row.isPriority ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
                                <line x1="4" y1="22" x2="4" y2="15" />
                              </svg>
                            </button>

                            <div className="relative">
                              <button
                                type="button"
                                onClick={() => setOpenRowMenuKey((k) => (k === row.key ? null : row.key))}
                                title="More options"
                                disabled={orderLockedByPendingApproval}
                                className="w-[30px] h-[30px] flex items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 hover:border-gray-300 transition-colors cursor-pointer bg-white disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                  <circle cx="12" cy="5" r="1.75" />
                                  <circle cx="12" cy="12" r="1.75" />
                                  <circle cx="12" cy="19" r="1.75" />
                                </svg>
                              </button>

                              {openRowMenuKey === row.key && (
                                <>
                                  <div className="fixed inset-0 z-40" onClick={() => setOpenRowMenuKey(null)} />
                                  <div className="absolute right-0 top-[34px] z-50 w-40 rounded-xl border border-gray-200 bg-white shadow-lg py-1 overflow-hidden">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setNoteEditorRowKey(row.key);
                                        setOpenRowMenuKey(null);
                                      }}
                                      className="flex w-full items-center gap-2 px-3 py-2 text-[12px] font-medium text-gray-700 hover:bg-gray-50 transition-colors cursor-pointer bg-transparent border-none text-left"
                                    >
                                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                                      </svg>
                                      Add Note
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setOpenRowMenuKey(null);
                                        removeRow(row.key);
                                      }}
                                      disabled={orderLockedByPendingApproval}
                                      className="flex w-full items-center gap-2 px-3 py-2 text-[12px] font-medium text-red-600 hover:bg-red-50 transition-colors cursor-pointer bg-transparent border-none text-left disabled:cursor-not-allowed disabled:opacity-40"
                                    >
                                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                        <polyline points="3 6 5 6 21 6" />
                                        <path d="M19 6l-1 14H6L5 6m5 0V4h4v2" />
                                      </svg>
                                      Delete
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="border-t border-dashed border-gray-100">
                    <td colSpan={10} className="px-6 py-3">
                      <button onClick={addRow} disabled={orderLockedByPendingApproval}
                        className="inline-flex items-center gap-2 text-[12px] text-gray-400 hover:text-indigo-600 transition-colors cursor-pointer">
                        <span className="w-5 h-5 rounded-md border border-gray-200 flex items-center justify-center text-sm hover:border-indigo-300 hover:bg-indigo-50 transition-colors">+</span>
                        Add another product
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Order note */}
            <div className="px-6 py-4 border-t border-gray-100 bg-white">
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Order Note</label>
                  <span className="text-[11px] text-gray-400">{orderNote.trim().length}/1200</span>
                </div>
                <textarea
                  value={orderNote}
                  maxLength={1200}
                  onChange={(e) => setOrderNote(e.target.value)}
                  disabled={orderLockedByPendingApproval}
                  placeholder="Add packing, dispatch, or billing instructions for this order..."
                  className="min-h-[82px] w-full resize-none rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-[13px] text-gray-900 outline-none transition-all placeholder:text-gray-400 focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-100 disabled:bg-gray-100 disabled:text-gray-500"
                />
              </div>
            </div>

            {/* Order summary — sequential discount breakdown */}
            <div className={`px-6 py-5 border-t border-gray-100 ${hasAnyDiscount ? "bg-emerald-50/60" : "bg-gray-50"
              }`}>
              <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-[13px] font-semibold text-gray-900">Order Summary</p>
                  <p className="text-[11px] text-gray-400 mt-0.5 font-mono">
                    {arr1.reduce((a, r) => a + safePositiveNumber(r.producQuanity) * (safePositiveNumber(r.packSize) || 1), 0)} pcs. ·{" "}
                    {arr1.filter(r => r.productname).length} product{arr1.filter(r => r.productname).length !== 1 ? "s" : ""}
                  </p>
                  <p className={`text-[12px] font-semibold mt-2 ${hasAnyDiscount ? "text-emerald-700" : "text-gray-500"
                    }`}>
                    Base: {discountPayload.baseDiscountPercent}%
                    {discountPayload.additionalDiscountType === "custom"
                      ? " · Approved custom selected"
                      : hasSlabDiscount ? ` → slab: ${discountPayload.slabDiscountPercent}%` : ""}
                    {" · "}{discountPayload.additionalDiscountType === "custom" ? "Slab discount disabled" : discountStatusMessage}
                  </p>
                </div>

                <div className="w-full lg:max-w-xl">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Gross Subtotal</p>
                      <p className="mt-1 font-mono text-[14px] font-semibold text-gray-900">{fmt(subtotalPaise)}</p>
                    </div>
                    <div className={`rounded-xl border px-4 py-3 ${discountPayload.baseDiscountPercent > 0 ? "border-amber-200 bg-amber-50/60 text-amber-700" : "border-gray-200 bg-white text-gray-600"}`}>
                      <p className="text-[10px] font-bold uppercase tracking-wider opacity-70">Base Discount</p>
                      <p className="mt-1 font-mono text-[14px] font-semibold">
                        {discountPayload.baseDiscountPercent}%
                        {discountPayload.baseDiscountAmount > 0 ? ` · −${fmt(toPaise(discountPayload.baseDiscountAmount))}` : ""}
                      </p>
                    </div>
                    <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 px-4 py-3">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-500">Post Base Amount</p>
                      <p className="mt-1 font-mono text-[14px] font-bold text-indigo-700">{fmt(toPaise(discountPayload.postBaseAmount))}</p>
                    </div>
                    <div className={`rounded-xl border px-4 py-3 ${discountPayload.additionalDiscountAmount > 0 ? "border-emerald-200 bg-emerald-50/60 text-emerald-700" : "border-gray-200 bg-white text-gray-500"}`}>
                      <p className="text-[10px] font-bold uppercase tracking-wider opacity-70">
                        {discountPayload.additionalDiscountType === "custom" ? "Approved Custom Discount" : "slab discount"}
                      </p>
                      <p className="mt-1 font-mono text-[14px] font-semibold">
                        {discountPayload.additionalDiscountType === "custom" ? "Approved" : `${discountPayload.slabDiscountPercent}%`}
                        {discountPayload.additionalDiscountAmount > 0 ? ` · −${fmt(toPaise(discountPayload.additionalDiscountAmount))}` : ""}
                      </p>
                    </div>
                    <div className={`rounded-xl border px-4 py-3 ${hasAnyDiscount ? "border-emerald-200 bg-white text-emerald-700" : "border-gray-200 bg-white text-gray-500"}`}>
                      <p className="text-[10px] font-bold uppercase tracking-wider opacity-70">Effective Total</p>
                      <p className="mt-1 font-mono text-[15px] font-bold">
                        {discountPayload.discountPercent}%
                        {hasAnyDiscount ? ` · −${fmt(discountAmountPaise)}` : ""}
                      </p>
                    </div>
                    <div className="rounded-xl border border-gray-900 bg-gray-900 px-4 py-3 text-white">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-white/60">Final Payable</p>
                      <p className="mt-1 font-mono text-[17px] font-bold">{fmt(finalPayablePaise)}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Action bar */}
            {/* <div className={`mx-6 mt-4 rounded-xl border px-4 py-3 ${wallet?.status === "active" && wallet.availableBalance < discountPayload.finalPayableAmount ? "border-red-200 bg-red-50" : wallet?.status === "active" ? "border-emerald-200 bg-emerald-50" : "border-gray-200 bg-gray-50"}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Dealer Wallet</p>
                  <p className="mt-1 text-sm font-semibold text-gray-900">
                    {walletLoading ? "Loading wallet..." : wallet?.status === "active" ? `Active · Available ${fmt(toPaise(wallet.availableBalance))}` : "Inactive · normal ordering applies"}
                  </p>
                </div>
                {wallet?.status === "active" && (
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${wallet.availableBalance >= discountPayload.finalPayableAmount ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                    {wallet.availableBalance >= discountPayload.finalPayableAmount ? "Balance sufficient" : "Insufficient balance"}
                  </span>
                )}
              </div>
              {wallet?.status === "active" && wallet.availableBalance < discountPayload.finalPayableAmount && (
                <p className="mt-2 text-xs text-red-700">Insufficient wallet balance. Available: {fmt(toPaise(wallet.availableBalance))}. Required: {fmt(finalPayablePaise)}. Contact Admin to add funds.</p>
              )}
            </div> */}

            <div className="flex items-center gap-3 px-6 py-4 border-t border-gray-100 flex-wrap">
              {isWaitingForApproval ? (
                <>
                  <button
                    type="button"
                    disabled
                    className="inline-flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-500 px-5 py-2.5 text-[13.5px] font-semibold text-white cursor-not-allowed shadow-sm"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                      <circle cx="12" cy="12" r="9" />
                      <path d="M12 7v5l3 2" />
                    </svg>
                    Wait for Approval
                  </button>
                  <p className="text-[12.5px] text-amber-700">
                    Your order has been submitted for discount approval. You can place it after the request is approved.
                  </p>
                  <button
                    type="button"
                    onClick={() => router.push("/dashboard/dealer/approved-discounts")}
                    className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-white px-4 py-2.5 text-[13px] font-semibold text-amber-700 hover:bg-amber-50"
                  >
                    View Approval Status
                  </button>
                </>
              ) : (
                <button onClick={handleSubmitProductArray} disabled={wallet?.status === "active" && wallet.availableBalance < discountPayload.finalPayableAmount}
                  className={`inline-flex items-center gap-2 px-5 py-2.5 text-white rounded-xl text-[13.5px] font-semibold transition-all shadow-sm hover:shadow-md hover:-translate-y-px cursor-pointer border-none ${hasAnyDiscount
                      ? "bg-gradient-to-r from-emerald-700 to-emerald-500 hover:from-emerald-800 hover:to-emerald-600"
                      : "bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-700 hover:to-emerald-600"
                    } disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0`}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                  Place Order
                </button>
              )}

              <button onClick={handleSaveDraft} disabled={draftSaving || orderLockedByPendingApproval}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-200 hover:bg-indigo-50 hover:border-indigo-300 hover:text-indigo-700 text-gray-600 rounded-xl text-[13.5px] font-medium transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                  <polyline points="17 21 17 13 7 13 7 21" />
                  <polyline points="7 3 7 8 15 8" />
                </svg>
                {activeDraftId ? "Update Draft" : "Save as Draft"}
              </button>

              <button onClick={addRow} disabled={orderLockedByPendingApproval}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-200 hover:bg-gray-50 hover:border-gray-300 text-gray-600 rounded-xl text-[13.5px] font-medium transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Add Row
              </button>
            </div>
          </div>
        )}

        {/* ── EXCEL TAB ────────────────────────────────────────────────────── */}
        {tab === "excel" && (
          <div className="bg-white border border-gray-200 rounded-2xl p-7">
            <h3 className="text-[15px] font-semibold text-gray-900 mb-1">Upload Excel File</h3>
            <p className="text-[13px] text-gray-400 mb-6">Place orders in bulk using a formatted Excel spreadsheet.</p>
            <form onSubmit={handleSubmitFile}>
              <label className={`block border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all duration-200 ${file ? "border-emerald-300 bg-emerald-50" : "border-gray-200 hover:border-indigo-300 hover:bg-indigo-50/30"
                }`}>
                <input required type="file" accept=".xlsx,.xls,.csv" className="hidden" disabled={orderLockedByPendingApproval}
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                {file ? (
                  <><div className="text-4xl mb-3">📄</div>
                    <p className="text-[14px] font-semibold text-emerald-700 mb-1">{file.name}</p>
                    <p className="text-[12px] text-gray-400">{(file.size / 1024).toFixed(1)} KB · Click to change</p></>
                ) : (
                  <><div className="text-4xl mb-3">📂</div>
                    <p className="text-[14px] font-semibold text-gray-700 mb-1">Click to upload Excel file</p>
                    <p className="text-[12px] text-gray-400">.xlsx, .xls, .csv accepted</p></>
                )}
              </label>
              <div className="mt-5">
                <button type="submit" disabled={orderLockedByPendingApproval || !file}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-gray-900 hover:bg-gray-800 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed text-white rounded-xl text-[13.5px] font-semibold transition-all cursor-pointer border-none">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
                  </svg>
                  Submit via Excel
                </button>
              </div>
            </form>
          </div>
        )}

      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Default export — wraps inner component in Suspense so useSearchParams()
// does not break static prerendering in Next.js.
// ─────────────────────────────────────────────────────────────────────────────
export default function AddOrderPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-[60vh] text-gray-400 text-sm">
        Loading…
      </div>
    }>
      <AddOrderPageInner />
    </Suspense>
  );
}