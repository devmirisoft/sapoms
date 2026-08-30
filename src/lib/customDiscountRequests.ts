export type CustomDiscountScope = "order" | "product";
export type CustomDiscountStatus = "pending" | "approved" | "rejected";

export type DraftApprovalState = {
  approvalRequestId?: string | null;
  status?: CustomDiscountStatus | null;
  requestedOrderDiscountPercent?: number | null;
  requestedProductDiscounts?: Record<string, number>;
  updatedAt?: string | null;
};

export type ApprovalSnapshotProductSource = {
  rowKey?: string | number | null;
  productKey?: string | null;
  sku?: string | null;
  catalogueNumber?: string | null;
  productName?: string | null;
  image?: string | null;
  quantity?: number | string | null;
  packSize?: number | string | null;
  unitPrice?: number | string | null;
  grossAmount?: number | string | null;
  isPriority?: boolean | null;
  productNote?: string | null;
};

export type ApprovalSnapshotProduct = {
  rowKey?: string | number;
  productKey: string;
  sku: string;
  catalogueNumber: string;
  productName: string;
  image?: string | null;
  quantity: number;
  packSize: number;
  totalPieces: number;
  unitPrice: number;
  grossAmount: number;
  baseDiscountPercent: number;
  baseDiscountAmount: number;
  requestedCustomDiscountPercent?: number;
  requestedCustomDiscountAmount?: number;
  usesCustomDiscount: boolean;
  finalAmount: number;
  isPriority?: boolean;
  productNote?: string;
};

export type ApprovalOrderSnapshot = {
  orderNote: string;
  products: ApprovalSnapshotProduct[];
  grossAmount: number;
  baseDiscountAmount: number;
  requestedAdditionalDiscountAmount: number;
  totalDiscountAmount: number;
  requestedNetPayableAmount: number;
};

export type CustomDiscountRequestRecord = Record<string, unknown> & {
  id?: string | null;
  dealerId?: string | null;
  staffId?: string | null;
  assignedStaffId?: string | null;
  dealerName?: string | null;
  orderDraftId?: string | null;
  order_draft_id?: string | null;
  status?: string | null;
  discountScope?: CustomDiscountScope | string | null;
  requestedDiscountPercent?: number | string | null;
  currentDiscountPercent?: number | string | null;
  orderSnapshot?: Partial<ApprovalOrderSnapshot> | null;
  products?: unknown[];
  draftProducts?: unknown[];
  targetProduct?: Record<string, unknown> | null;
  allowReorder?: boolean | null;
  createdAt?: string | null;
  reviewedAt?: string | null;
  rsmNote?: string | null;
  adminNote?: string | null;
  refno?: string | null;
  shipto?: string | null;
  orderNote?: string | null;
  rejectionDraftId?: string | null;
  lineStatuses?: unknown[];
};

export type NormalizedCustomDiscountRequest = {
  id: string;
  dealerId: string;
  staffId: string;
  assignedStaffId: string;
  dealerName: string;
  orderDraftId: string;
  status: string;
  normalizedStatus: CustomDiscountStatus | string;
  rsmApprovalStatus: string;
  rsmReviewedBy: string;
  rsmReviewedAt: string | null;
  discountScope: CustomDiscountScope;
  targetProduct: {
    productKey?: string;
    productname?: string;
    displayName?: string;
    variantCode?: string;
  } | null;
  requestedDiscountPercent: number;
  currentDiscountPercent: number;
  requestedOrderDiscountPercent: number | null;
  requestedProductDiscounts: Record<string, number>;
  orderSnapshot: ApprovalOrderSnapshot;
  isLegacySnapshot: boolean;
  allowReorder: boolean;
  createdAt: string;
  reviewedAt: string | null;
  rsmNote: string;
  adminNote: string;
  refno: string;
  shipto: string;
  rejectionDraftId: string;
  requestReference: string;
  source: CustomDiscountRequestRecord;
};

type BuildOrderSnapshotOptions = {
  products: ApprovalSnapshotProductSource[];
  orderNote?: string | null;
  baseDiscountPercent?: number | string | null;
  requestedOrderDiscountPercent?: number | string | null;
  requestedProductDiscounts?: Record<string, number>;
};

function cleanText(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function toNumber(value: unknown, fallback = 0) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string" && value.trim() === "") return fallback;
  const numeric = typeof value === "number"
    ? value
    : Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(numeric) ? numeric : fallback;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function clampPercent(value: unknown, fallback = 0) {
  return Math.min(100, Math.max(0, roundMoney(toNumber(value, fallback))));
}

function normalizeCount(value: unknown, fallback = 0) {
  const count = toNumber(value, fallback);
  return Number.isFinite(count) && count > 0 ? count : fallback;
}

function normalizeRowKey(value: unknown, fallback?: string | number) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) return value.trim();
  return fallback;
}

export function normalizeCustomDiscountStatus(value: unknown): CustomDiscountStatus | string {
  const status = cleanText(value).toLowerCase();
  if (status === "approved") return "approved";
  if (status === "rejected" || status === "disapproved") return "rejected";
  if (status === "pending" || status === "under review" || status === "under_review") return "pending";
  // A request is only ever pending, approved or rejected. CANCELLED is a closed
  // request that was never approved, so it reads as rejected -- as "cancelled"
  // it matched none of the branches the order form has, which left the draft
  // permanently locked.
  if (status === "cancelled" || status === "canceled") return "rejected";
  return status;
}

export function normalizeCustomDiscountScope(value: unknown): CustomDiscountScope {
  return cleanText(value).toLowerCase() === "product" ? "product" : "order";
}

export function normalizeApprovalProductKey(value: unknown) {
  return cleanText(value).toLowerCase();
}

export function sanitizeRequestedProductDiscounts(
  requestedProductDiscounts: Record<string, number> | undefined,
  baseDiscountPercent: number,
  validProductKeys?: string[]
) {
  const valid = validProductKeys
    ? new Set(validProductKeys.map((key) => normalizeApprovalProductKey(key)))
    : null;

  const result: Record<string, number> = {};
  Object.entries(requestedProductDiscounts ?? {}).forEach(([key, percent]) => {
    const normalizedKey = normalizeApprovalProductKey(key);
    const normalizedPercent = clampPercent(percent, 0);
    if (!normalizedKey) return;
    if (valid && !valid.has(normalizedKey)) return;
    if (normalizedPercent <= baseDiscountPercent) return;
    result[normalizedKey] = normalizedPercent;
  });
  return result;
}

function buildSnapshotProduct(
  product: ApprovalSnapshotProductSource,
  baseDiscountPercent: number,
  requestedOrderDiscountPercent: number | null,
  requestedProductDiscounts: Record<string, number>
): ApprovalSnapshotProduct {
  const quantity = Math.max(1, normalizeCount(product.quantity, 1));
  const packSize = Math.max(1, normalizeCount(product.packSize, 1));
  const totalPieces = quantity * packSize;
  const unitPrice = Math.max(0, roundMoney(toNumber(product.unitPrice, 0)));
  const grossAmount = Math.max(
    0,
    roundMoney(
      toNumber(product.grossAmount, quantity * packSize * unitPrice)
    )
  );
  const sku = cleanText(product.sku) || cleanText(product.catalogueNumber) || cleanText(product.productName);
  const productKey = normalizeApprovalProductKey(product.productKey ?? sku);
  const targetDiscountPercent = requestedOrderDiscountPercent ?? requestedProductDiscounts[productKey] ?? null;
  const requestedCustomDiscountPercent = targetDiscountPercent === null
    ? 0
    : Math.max(0, roundMoney(targetDiscountPercent - baseDiscountPercent));
  const usesCustomDiscount = requestedCustomDiscountPercent > 0;
  const baseDiscountAmount = roundMoney(grossAmount * (baseDiscountPercent / 100));
  const requestedCustomDiscountAmount = usesCustomDiscount
    ? roundMoney(grossAmount * (requestedCustomDiscountPercent / 100))
    : 0;
  const finalAmount = roundMoney(Math.max(0, grossAmount - baseDiscountAmount - requestedCustomDiscountAmount));
  const rowKey = normalizeRowKey(product.rowKey);

  return {
    ...(rowKey !== undefined ? { rowKey } : {}),
    productKey,
    sku: sku || cleanText(product.productName),
    catalogueNumber: cleanText(product.catalogueNumber) || sku || cleanText(product.productName),
    productName: cleanText(product.productName) || sku || cleanText(product.catalogueNumber),
    image: cleanText(product.image) || null,
    quantity,
    packSize,
    totalPieces,
    unitPrice,
    grossAmount,
    baseDiscountPercent,
    baseDiscountAmount,
    ...(usesCustomDiscount ? {
      requestedCustomDiscountPercent,
      requestedCustomDiscountAmount,
    } : {}),
    usesCustomDiscount,
    finalAmount,
    ...(product.isPriority ? { isPriority: true } : {}),
    ...(cleanText(product.productNote) ? { productNote: cleanText(product.productNote) } : {}),
  };
}

export function buildOrderApprovalSnapshot(options: BuildOrderSnapshotOptions): ApprovalOrderSnapshot {
  const baseDiscountPercent = clampPercent(options.baseDiscountPercent, 0);
  const requestedOrderDiscountPercent = options.requestedOrderDiscountPercent === null || options.requestedOrderDiscountPercent === undefined
    ? null
    : clampPercent(options.requestedOrderDiscountPercent, 0);
  const validProductKeys = options.products.map((product) => String(product.productKey ?? product.sku ?? product.catalogueNumber ?? product.productName ?? ""));
  const requestedProductDiscounts = sanitizeRequestedProductDiscounts(
    options.requestedProductDiscounts,
    baseDiscountPercent,
    validProductKeys,
  );

  const products = options.products.map((product) => (
    buildSnapshotProduct(
      product,
      baseDiscountPercent,
      requestedOrderDiscountPercent,
      requestedProductDiscounts,
    )
  ));

  const grossAmount = roundMoney(products.reduce((sum, product) => sum + product.grossAmount, 0));
  const baseDiscountAmount = roundMoney(products.reduce((sum, product) => sum + product.baseDiscountAmount, 0));
  const requestedAdditionalDiscountAmount = roundMoney(products.reduce((sum, product) => (
    sum + (product.requestedCustomDiscountAmount ?? 0)
  ), 0));
  const totalDiscountAmount = roundMoney(baseDiscountAmount + requestedAdditionalDiscountAmount);
  const requestedNetPayableAmount = roundMoney(Math.max(0, grossAmount - totalDiscountAmount));

  return {
    orderNote: cleanText(options.orderNote),
    products,
    grossAmount,
    baseDiscountAmount,
    requestedAdditionalDiscountAmount,
    totalDiscountAmount,
    requestedNetPayableAmount,
  };
}

function buildLegacySnapshot(record: CustomDiscountRequestRecord) {
  const discountScope = normalizeCustomDiscountScope(record.discountScope);
  const baseDiscountPercent = clampPercent(record.currentDiscountPercent, 0);
  const requestedDiscountPercent = clampPercent(record.requestedDiscountPercent, baseDiscountPercent);
  const targetProductKey = normalizeApprovalProductKey(
    record.targetProduct && typeof record.targetProduct === "object"
      ? record.targetProduct.productKey ?? record.targetProduct.variantCode ?? record.targetProduct.productname
      : ""
  );

  const legacyProducts = Array.isArray(record.products) && record.products.length > 0
    ? record.products
    : Array.isArray(record.draftProducts)
      ? record.draftProducts
      : [];

  const products = legacyProducts.map((product, index) => {
    const raw = (product ?? {}) as Record<string, unknown>;
    const productKey = cleanText(raw.productKey) || cleanText(raw.variantCode) || cleanText(raw.productname) || `legacy-${index + 1}`;
    const quantity = normalizeCount(raw.quantity ?? raw.producQuanity, 1);
    const packSize = normalizeCount(raw.packSize, 1);
    const unitPrice = roundMoney(toNumber(raw.price, 0));
    const grossAmount = roundMoney(toNumber(raw.grossAmount ?? raw.rowSubtotal, quantity * packSize * unitPrice));
    const usesCustomDiscount = discountScope === "order"
      ? requestedDiscountPercent > baseDiscountPercent
      : targetProductKey
        ? normalizeApprovalProductKey(productKey) === targetProductKey
        : requestedDiscountPercent > baseDiscountPercent;
    const requestedCustomDiscountPercent = usesCustomDiscount
      ? Math.max(0, roundMoney(requestedDiscountPercent - baseDiscountPercent))
      : 0;
    const requestedCustomDiscountAmount = usesCustomDiscount
      ? roundMoney(grossAmount * (requestedCustomDiscountPercent / 100))
      : 0;
    const baseDiscountAmount = roundMoney(grossAmount * (baseDiscountPercent / 100));

    return {
      rowKey: normalizeRowKey(raw.rowKey ?? raw.key, index + 1),
      productKey: normalizeApprovalProductKey(productKey),
      sku: cleanText(raw.variantCode) || cleanText(raw.productname) || productKey,
      catalogueNumber: cleanText(raw.variantCode) || cleanText(raw.productname) || productKey,
      productName: cleanText(raw.displayName) || cleanText(raw.productname) || productKey,
      image: cleanText(raw.image) || null,
      quantity,
      packSize,
      totalPieces: quantity * packSize,
      unitPrice,
      grossAmount,
      baseDiscountPercent,
      baseDiscountAmount,
      ...(usesCustomDiscount ? {
        requestedCustomDiscountPercent,
        requestedCustomDiscountAmount,
      } : {}),
      usesCustomDiscount,
      finalAmount: roundMoney(Math.max(0, grossAmount - baseDiscountAmount - requestedCustomDiscountAmount)),
      ...(raw.priority || raw.isPriority ? { isPriority: true } : {}),
      ...(cleanText(raw.productNote) ? { productNote: cleanText(raw.productNote) } : {}),
    } satisfies ApprovalSnapshotProduct;
  });

  const grossAmount = roundMoney(toNumber(record.orderSnapshot?.grossAmount, toNumber(record.subtotal, products.reduce((sum, product) => sum + product.grossAmount, 0))));
  const baseDiscountAmount = roundMoney(toNumber(record.orderSnapshot?.baseDiscountAmount, toNumber(record.currentDiscountAmount, products.reduce((sum, product) => sum + product.baseDiscountAmount, 0))));
  const requestedAdditionalDiscountAmount = roundMoney(toNumber(record.orderSnapshot?.requestedAdditionalDiscountAmount, toNumber(record.requestedDiscountAmount, products.reduce((sum, product) => sum + (product.requestedCustomDiscountAmount ?? 0), 0))));
  const requestedNetPayableAmount = roundMoney(toNumber(record.orderSnapshot?.requestedNetPayableAmount, toNumber(record.requestedFinalPayable, Math.max(0, grossAmount - baseDiscountAmount - requestedAdditionalDiscountAmount))));
  const totalDiscountAmount = roundMoney(toNumber(record.orderSnapshot?.totalDiscountAmount, Math.max(0, grossAmount - requestedNetPayableAmount)));

  return {
    orderNote: cleanText(record.orderSnapshot?.orderNote) || cleanText(record.orderNote),
    products,
    grossAmount,
    baseDiscountAmount,
    requestedAdditionalDiscountAmount,
    totalDiscountAmount,
    requestedNetPayableAmount,
  } satisfies ApprovalOrderSnapshot;
}

export function extractRequestedProductDiscountsFromSnapshot(snapshot: ApprovalOrderSnapshot) {
  const result: Record<string, number> = {};
  snapshot.products.forEach((product) => {
    if (!product.usesCustomDiscount) return;
    const normalizedKey = normalizeApprovalProductKey(product.productKey || product.sku || product.catalogueNumber);
    result[normalizedKey] = roundMoney(product.baseDiscountPercent + (product.requestedCustomDiscountPercent ?? 0));
  });
  return result;
}

export function buildDraftApprovalState(params: {
  approvalRequestId?: string | null;
  status?: CustomDiscountStatus | null;
  requestedOrderDiscountPercent?: number | null;
  requestedProductDiscounts?: Record<string, number>;
  updatedAt?: string | null;
}): DraftApprovalState {
  return {
    approvalRequestId: cleanText(params.approvalRequestId) || null,
    status: params.status ?? null,
    requestedOrderDiscountPercent: params.requestedOrderDiscountPercent ?? null,
    requestedProductDiscounts: sanitizeRequestedProductDiscounts(
      params.requestedProductDiscounts,
      0,
    ),
    updatedAt: cleanText(params.updatedAt) || null,
  };
}

export function resolveApprovalAggregateStatus(
  input: { status?: unknown; lineStatuses?: unknown[] } | unknown
): CustomDiscountStatus | string {
  const record = typeof input === "object" && input !== null ? input as { status?: unknown; lineStatuses?: unknown[] } : {};
  const lineStatuses = Array.isArray(record.lineStatuses)
    ? record.lineStatuses.map((value) => normalizeCustomDiscountStatus(value)).filter(Boolean)
    : [];

  if (lineStatuses.length === 0) return normalizeCustomDiscountStatus(record.status);
  if (lineStatuses.some((value) => value === "rejected")) return "rejected";
  if (lineStatuses.every((value) => value === "approved")) return "approved";
  return "pending";
}

export function normalizeCustomDiscountRequestRecord(
  record: CustomDiscountRequestRecord
): NormalizedCustomDiscountRequest {
  const status = cleanText(record.status) || "pending";
  const normalizedStatus = resolveApprovalAggregateStatus(record);
  const discountScope = normalizeCustomDiscountScope(record.discountScope);
  const orderDraftId = cleanText(record.orderDraftId || record.order_draft_id);
  const requestedDiscountPercent = clampPercent(record.requestedDiscountPercent, 0);
  const currentDiscountPercent = clampPercent(record.currentDiscountPercent, 0);
  const hasOrderSnapshot = !!record.orderSnapshot && typeof record.orderSnapshot === "object" && Array.isArray(record.orderSnapshot.products);
  const snapshotProducts = hasOrderSnapshot
    ? ((record.orderSnapshot?.products ?? []) as Array<Record<string, unknown>>)
    : [];
  const snapshotRequestedProductDiscounts = snapshotProducts.reduce<Record<string, number>>((acc, product, index) => {
    const productKey = normalizeApprovalProductKey(
      product.productKey
      ?? product.sku
      ?? product.catalogueNumber
      ?? product.productName
      ?? `snapshot-${index + 1}`
    );
    const usesCustomDiscount = !!product.usesCustomDiscount;
    const requestedCustomDiscountPercent = clampPercent(product.requestedCustomDiscountPercent, 0);
    if (!usesCustomDiscount || requestedCustomDiscountPercent <= 0) return acc;
    acc[productKey] = roundMoney(currentDiscountPercent + requestedCustomDiscountPercent);
    return acc;
  }, {});
  const snapshotRequestedOrderDiscountPercent = hasOrderSnapshot && discountScope === "order"
    ? snapshotProducts.find((product) => !!product.usesCustomDiscount)
      ? roundMoney(
          currentDiscountPercent +
          clampPercent(
            snapshotProducts.find((product) => !!product.usesCustomDiscount)?.requestedCustomDiscountPercent,
            0,
          )
        )
      : null
    : null;
  const orderSnapshot = hasOrderSnapshot
    ? buildOrderApprovalSnapshot({
        products: snapshotProducts as ApprovalSnapshotProductSource[],
        orderNote: record.orderSnapshot?.orderNote ?? record.orderNote,
        baseDiscountPercent: currentDiscountPercent,
        requestedOrderDiscountPercent: snapshotRequestedOrderDiscountPercent,
        requestedProductDiscounts: discountScope === "product" ? snapshotRequestedProductDiscounts : undefined,
      })
    : buildLegacySnapshot(record);

  const requestedProductDiscounts = extractRequestedProductDiscountsFromSnapshot(orderSnapshot);
  const requestedOrderDiscountPercent = discountScope === "order" && orderSnapshot.products.some((product) => product.usesCustomDiscount)
    ? roundMoney(currentDiscountPercent + (orderSnapshot.products[0]?.requestedCustomDiscountPercent ?? 0))
    : null;

  const id = cleanText(record.id) || cleanText(record._id) || "";

  return {
    id,
    dealerId: cleanText(record.dealerId),
    staffId: cleanText(record.staffId),
    assignedStaffId: cleanText(record.assignedStaffId) || cleanText(record.staffId),
    dealerName: cleanText(record.dealerName),
    orderDraftId,
    status,
    normalizedStatus,
    rsmApprovalStatus: cleanText(record.rsmApprovalStatus || record.rsm_approval_status) || "pending",
    rsmReviewedBy: cleanText(record.rsmReviewedBy || record.rsm_reviewed_by),
    rsmReviewedAt: cleanText(record.rsmReviewedAt || record.rsm_reviewed_at) || null,
    discountScope,
    targetProduct: record.targetProduct && typeof record.targetProduct === "object"
      ? {
          productKey: cleanText(record.targetProduct.productKey),
          productname: cleanText(record.targetProduct.productname),
          displayName: cleanText(record.targetProduct.displayName),
          variantCode: cleanText(record.targetProduct.variantCode),
        }
      : null,
    requestedDiscountPercent,
    currentDiscountPercent,
    requestedOrderDiscountPercent,
    requestedProductDiscounts,
    orderSnapshot,
    isLegacySnapshot: !hasOrderSnapshot,
    allowReorder: !!record.allowReorder,
    createdAt: cleanText(record.createdAt),
    reviewedAt: cleanText(record.reviewedAt) || null,
    rsmNote: cleanText(record.rsmNote),
    adminNote: cleanText(record.adminNote),
    refno: cleanText(record.refno),
    shipto: cleanText(record.shipto),
    rejectionDraftId: cleanText(record.rejectionDraftId),
    requestReference: orderDraftId || id,
    source: record,
  };
}

export function findLatestRequestForDraft(
  requests: CustomDiscountRequestRecord[],
  orderDraftId: string,
  requestId?: string | null
) {
  const normalizedDraftId = cleanText(orderDraftId);
  const normalizedRequestId = cleanText(requestId);
  const normalizedRequests = requests.map(normalizeCustomDiscountRequestRecord);

  if (normalizedRequestId) {
    const exact = normalizedRequests.find((request) => request.id === normalizedRequestId);
    if (exact) return exact;
  }

  if (!normalizedDraftId) return null;

  const matches = normalizedRequests
    .filter((request) => request.orderDraftId === normalizedDraftId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  return matches[0] ?? null;
}

export function buildPendingRequestLookup(dealerId: string, orderDraftId: string) {
  return {
    dealerId: cleanText(dealerId),
    orderDraftId: cleanText(orderDraftId),
    status: "pending" as const,
  };
}
