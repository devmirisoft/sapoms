const DEFAULT_SOURCES = ["orderpegination", "orderhispegination", "staffOrderrPagination", "Orderstspegination"];
const DEFAULT_LIMIT = 50;
const DEFAULT_PAGE_SIZE = 200;
const REQUEST_TIMEOUT_MS = 30_000;

function text(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function firstText(...values) {
  for (const value of values) {
    const candidate = text(value);
    if (candidate) return candidate;
  }
  return "";
}

function numberValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const raw = text(value).replace(/,/g, "");
  if (!raw) return 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function integerValue(value) {
  return Math.max(0, Math.trunc(numberValue(value)));
}

function paise(value) {
  return BigInt(Math.round(numberValue(value) * 100));
}

function decimalString(value) {
  return numberValue(value).toFixed(4);
}

function parseDate(value) {
  const raw = text(value);
  if (!raw) return new Date();
  const parsed = new Date(raw.replace(" ", "T"));
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function normalizeLegacyId(value) {
  const raw = text(value, 120);
  const displayIdMatch = raw.match(/(?:^|\/)(\d+)$/);
  return displayIdMatch?.[1] ?? raw;
}

function splitIds(value) {
  return text(value, 500)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function uniqueRows(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const id = normalizeLegacyId(row?.order_id ?? row?.orderId ?? row?.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(row);
  }
  return out;
}

function rowsFromPayload(payload) {
  const rows = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
  return rows.filter((row) => row && typeof row === "object");
}

function parsePossiblyNoisyJson(textBody) {
  const raw = textBody.trim();
  if (!raw) return {};
  const firstObject = raw.indexOf("{");
  const firstArray = raw.indexOf("[");
  const startCandidates = [firstObject, firstArray].filter((index) => index >= 0);
  const start = startCandidates.length ? Math.min(...startCandidates) : -1;
  if (start < 0) throw new Error("Legacy PHP returned no JSON payload");
  return JSON.parse(raw.slice(start));
}

function priorityValue(...values) {
  return values.some((value) => ["1", "true", "yes", "priority", "high"].includes(text(value).toLowerCase()));
}

function mapAcceptanceStatus(row) {
  const raw = text(row.acceptanceStatus ?? row.acceptance_status ?? row.accept_order).toLowerCase();
  if (["1", "accepted", "approve", "approved"].includes(raw)) return "ACCEPTED";
  if (["2", "declined", "rejected", "reject"].includes(raw)) return "DECLINED";
  return "AWAITING";
}

function mapOrderStatus(row) {
  const deleted = text(row.del_status ?? row.deleted).toLowerCase();
  if (["1", "true", "cancelled", "canceled"].includes(deleted)) return "CANCELLED";
  const raw = text(row.status ?? row.order_status ?? row.orderStatus).toLowerCase().replace(/[\s_-]/g, "");
  if (["cancelled", "canceled"].includes(raw)) return "CANCELLED";
  if (["completed", "complete"].includes(raw)) return "COMPLETED";
  if (["dispatched", "dispatch"].includes(raw)) return "DISPATCHED";
  if (["ready"].includes(raw)) return "READY";
  if (["partiallyready"].includes(raw)) return "PARTIALLY_READY";
  if (["processing", "approved", "accepted"].includes(raw)) return "ACCEPTED";
  if (["declined", "rejected"].includes(raw)) return "DECLINED";
  return "AWAITING_ACCEPTANCE";
}

function mapFulfilmentStatus(row) {
  const raw = text(row.fulfilmentStatus ?? row.fulfilment_status ?? row.mtstatus ?? row.dispatch_status).toLowerCase().replace(/[\s_-]/g, "");
  if (["completed", "complete"].includes(raw)) return "COMPLETED";
  if (["dispatched", "dispatch"].includes(raw)) return "DISPATCHED";
  if (["ready"].includes(raw)) return "READY";
  if (["partiallyready"].includes(raw)) return "PARTIALLY_READY";
  if (["inprocess", "processing", "packing"].includes(raw)) return "IN_PROCESS";
  return "PENDING";
}

function orderNumberFor(row, legacyPhpId) {
  return firstText(row.order_number, row.orderNumber, row.formattedOrderNumber, row.invoice, `PHP-${legacyPhpId}`);
}

function legacyDealerIdFrom(row) {
  return firstText(row.order_dealer, row.orderdata_dealerid, row.Dealer_Id, row.dealerId);
}

function legacyStaffIdsFrom(row) {
  return splitIds(firstText(row.assignedstaff, row.staffid, row.staff_id, row.assignedStaffId));
}

function buildOrderData(row, dealerId, assignedStaffId) {
  const status = mapOrderStatus(row);
  const acceptanceStatus = mapAcceptanceStatus(row);
  const fulfilmentStatus = mapFulfilmentStatus(row);
  const grossAmountPaise = paise(firstText(row.grossAmount, row.order_amount, row.totalAmount, row.amount));
  const totalDiscountAmountPaise = paise(firstText(row.discountAmount, row.order_discount, row.totalDiscount, row.discount_amount));
  const finalPayableAmountPaise = paise(firstText(row.finalPayableAmount, row.final_amount, row.netAmount, row.payableAmount)) || (grossAmountPaise - totalDiscountAmountPaise);
  const orderDate = parseDate(firstText(row.order_date, row.orderdata_datetime, row.created_at, row.createdAt));
  const acceptedAt = acceptanceStatus === "ACCEPTED" ? parseDate(firstText(row.accepted_at, row.acceptedAt, row.updated_at, row.updatedAt, row.order_date, row.orderdata_datetime)) : null;
  const cancelledAt = status === "CANCELLED" ? parseDate(firstText(row.cancelled_at, row.cancelledAt, row.updated_at, row.updatedAt, row.order_date, row.orderdata_datetime)) : null;
  const dispatchedAt = ["DISPATCHED", "COMPLETED"].includes(status) ? parseDate(firstText(row.dispatched_at, row.dispatchedAt, row.updated_at, row.updatedAt, row.order_date, row.orderdata_datetime)) : null;
  const completedAt = status === "COMPLETED" ? parseDate(firstText(row.completed_at, row.completedAt, row.updated_at, row.updatedAt, row.order_date, row.orderdata_datetime)) : null;
  return {
    legacyPhpId: normalizeLegacyId(row.order_id ?? row.orderId ?? row.id),
    orderNumber: orderNumberFor(row, normalizeLegacyId(row.order_id ?? row.orderId ?? row.id)),
    dealerId,
    assignedStaffId,
    idempotencyKey: `legacy-php-order:${normalizeLegacyId(row.order_id ?? row.orderId ?? row.id)}`,
    orderDate,
    shipTo: firstText(row.shipTo, row.ship_to, row.Dealer_shipto, row.shippingAddress, row.ship_to_address) || null,
    refNo: firstText(row.refNo, row.ref_no, row.reference, row.referenceNo) || null,
    note: firstText(row.note, row.order_note, row.notes, row.remark, row.remarks) || null,
    grossAmountPaise,
    allocatedDiscountPercent: decimalString(row.allocatedDiscountPercent),
    couponDiscountPercent: decimalString(row.couponDiscountPercent),
    couponDiscountAmountPaise: paise(row.couponDiscountAmount),
    couponCode: firstText(row.couponCode, row.coupon_code) || null,
    baseDiscountPercent: decimalString(row.baseDiscountPercent ?? row.discountPercent),
    baseDiscountAmountPaise: paise(row.baseDiscountAmount),
    postBaseAmountPaise: grossAmountPaise - paise(row.baseDiscountAmount),
    additionalDiscountType: "NONE",
    additionalDiscountAmountPaise: paise(row.additionalDiscountAmount),
    customDiscountAmountPaise: paise(row.customDiscountAmount),
    slabDiscountPercent: decimalString(row.slabDiscountPercent),
    slabDiscountAmountPaise: paise(row.slabDiscountAmount),
    totalDiscountPercent: decimalString(row.totalDiscountPercent ?? row.discountPercent),
    totalDiscountAmountPaise,
    finalPayableAmountPaise,
    status,
    acceptanceStatus,
    fulfilmentStatus,
    acceptedAt,
    cancelledAt,
    dispatchedAt,
    completedAt,
    cancellationReason: status === "CANCELLED" ? firstText(row.cancellationReason, row.cancel_reason, row.reason, row.remark, row.remarks) || "Cancelled in legacy PHP" : null,
  };
}

function buildItemData(item, orderLegacyId, orderId, itemIndex = 0) {
  const quantityPacks = integerValue(firstText(item.quantityPacks, item.packs, item.qty, item.quantity, item.orderdata_quantity, item.orderdata_item_quantity));
  const packSize = integerValue(firstText(item.packSize, item.pack_size, item.producQuanity, item.product_quantity, item.pcs_per_pack)) || 1;
  const totalPieces = integerValue(firstText(item.totalPieces, item.pieces, item.total_pieces)) || quantityPacks * packSize;
  const unitPricePaise = paise(firstText(item.unitPrice, item.unit_price, item.rate, item.price, item.orderdata_price, item.product_price));
  const packPricePaise = paise(firstText(item.packPrice, item.pack_price, item.orderdata_price, item.order_amount)) || unitPricePaise * BigInt(packSize);
  const listPriceTotalPaise = paise(firstText(item.grossAmount, item.orderdata_totalprice, item.order_amount, item.amount, item.totalAmount)) || packPricePaise * BigInt(quantityPacks);
  const discountAmountPaise = paise(firstText(item.discountAmount, item.discount_amount, item.orderdata_discount));
  const finalAmountPaise = paise(firstText(item.finalAmount, item.finalPayableAmount, item.netAmount, item.payableAmount, item.orderdata_afterDisPrice)) || (listPriceTotalPaise - discountAmountPaise);
  const legacyPhpOrderItemId = firstText(item.orderdata_id, item.id, item.order_item_id) || `${orderLegacyId}:${itemIndex}:${firstText(item.sku, item.product_sku, item.catNo, item.catalogueNumber, item.orderdata_cat_no, item.productname, item.product_name)}`;
  return {
    orderId,
    legacyPhpOrderItemId,
    productId: null,
    productVariantId: null,
    productNameSnapshot: firstText(item.productname, item.productName, item.name, item.product_name, "Legacy item"),
    catalogueNumberSnapshot: firstText(item.catNo, item.catalogueNumber, item.catalogue_no, item.orderdata_cat_no, item.product_code, item.productCode, item.sku),
    skuSnapshot: firstText(item.sku, item.product_sku) || null,
    categorySnapshot: firstText(item.category, item.product_category) || null,
    quantityPacks,
    packSize,
    totalPieces,
    unitPricePaise,
    packPricePaise,
    listPriceTotalPaise,
    discountPercent: decimalString(item.discountPercent ?? item.discount_percent ?? item.discount),
    discountAmountPaise,
    finalAmountPaise,
    isPriority: priorityValue(item.priority, item.isPriority),
    remarks: firstText(item.remarks, item.remark) || null,
    productNote: firstText(item.productNote, item.product_note, item.note) || null,
  };
}

async function fetchJson(baseUrl, endpoint, params = {}) {
  const url = new URL(endpoint.replace(/^\/+/, ""), baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`${endpoint} failed with ${response.status}`);
  return parsePossiblyNoisyJson(await response.text());
}

async function discoverHeaders({ backendUrl, sources, limit, pageSize, orderId = "" }) {
  const rows = [];
  const errors = [];
  for (const source of sources) {
    let page = 1;
    while (rows.length < limit) {
      try {
        const payload = await fetchJson(backendUrl, source, { page, limit: Math.min(pageSize, limit - rows.length), search: orderId || "" });
        const pageRows = rowsFromPayload(payload);
        rows.push(...pageRows);
        const lastPage = Number(payload?.last_page ?? payload?.lastPage ?? 0);
        if (pageRows.length === 0 || (lastPage && page >= lastPage)) break;
      } catch (error) {
        errors.push({ source, page, error: error.message });
        break;
      }
      page += 1;
    }
    if (rows.length >= limit) break;
  }
  const unique = uniqueRows(rows);
  const filtered = orderId ? unique.filter((row) => normalizeLegacyId(row?.order_id ?? row?.orderId ?? row?.id) === normalizeLegacyId(orderId)) : unique;
  return { rows: filtered.slice(0, limit), errors };
}

async function loadDealerMap(prisma) {
  const dealers = await prisma.dealerProfile.findMany({ select: { id: true, legacyPhpId: true, dealerCode: true, businessName: true } });
  const byId = new Map();
  const byLegacyPhpId = new Map();
  const byCode = new Map();
  for (const dealer of dealers) {
    byId.set(dealer.id.toString(), dealer);
    if (dealer.legacyPhpId) byLegacyPhpId.set(text(dealer.legacyPhpId), dealer);
    if (dealer.dealerCode) byCode.set(text(dealer.dealerCode), dealer);
  }
  return { byId, byLegacyPhpId, byCode };
}

async function loadStaffMap(prisma) {
  const staff = await prisma.staffProfile.findMany({ select: { id: true, displayName: true } });
  return new Map(staff.map((profile) => [profile.id.toString(), profile]));
}

function resolveDealer(row, dealerMap) {
  const legacyDealerId = legacyDealerIdFrom(row);
  const dealerCode = firstText(row.Dealer_Dealercode, row.dealerCode);
  return {
    legacyDealerId,
    dealer: dealerMap.byLegacyPhpId.get(legacyDealerId) ?? dealerMap.byId.get(legacyDealerId) ?? dealerMap.byCode.get(dealerCode) ?? null,
  };
}

function resolveStaff(row, staffMap) {
  for (const legacyStaffId of legacyStaffIdsFrom(row)) {
    const staff = staffMap.get(legacyStaffId);
    if (staff) return { legacyStaffId, staff };
  }
  const ids = legacyStaffIdsFrom(row);
  return { legacyStaffId: ids[0] ?? "", staff: null };
}

async function importOrder({ prisma, backendUrl, header, dryRun }) {
  const legacyPhpId = normalizeLegacyId(header.order_id ?? header.orderId ?? header.id);
  const existing = await prisma.order.findFirst({
    where: { OR: [{ legacyPhpId }, { orderNumber: orderNumberFor(header, legacyPhpId) }] },
    include: { items: true },
  });
  if (existing) return { action: "skipped-existing", orderId: existing.id.toString(), itemCount: existing.items.length };

  const dealerMap = await loadDealerMap(prisma);
  const staffMap = await loadStaffMap(prisma);
  const dealerResolution = resolveDealer(header, dealerMap);
  if (!dealerResolution.dealer) {
    return { action: "unresolved-dealer", legacyPhpId, legacyDealerId: dealerResolution.legacyDealerId };
  }
  const staffResolution = resolveStaff(header, staffMap);
  const assignedStaffId = staffResolution.staff?.id ?? null;
  const detailPayload = await fetchJson(backendUrl, "orderdatalist", { id: legacyPhpId });
  const detailRows = rowsFromPayload(detailPayload);
  const itemRows = detailRows.length > 0 ? detailRows : Array.isArray(header.productorder) ? header.productorder : [];
  const orderData = buildOrderData(header, dealerResolution.dealer.id, assignedStaffId);
  const orderItemData = itemRows.map((item, itemIndex) => buildItemData(item, legacyPhpId, 0n, itemIndex));
  const incompleteItems = orderItemData.filter((item) => !item.productNameSnapshot || !item.catalogueNumberSnapshot).length;
  if (dryRun) {
    return {
      action: "dry-run-importable",
      legacyPhpId,
      itemCount: orderItemData.length,
      incompleteItems,
      unresolvedStaff: staffResolution.legacyStaffId && !staffResolution.staff ? staffResolution.legacyStaffId : "",
    };
  }
  const created = await prisma.$transaction(async (tx) => {
    const order = await tx.order.create({ data: orderData });
    for (const item of orderItemData) {
      await tx.orderItem.upsert({
        where: { legacyPhpOrderItemId: item.legacyPhpOrderItemId },
        update: {},
        create: { ...item, orderId: order.id },
      });
    }
    return order;
  });
  return {
    action: "imported",
    orderId: created.id.toString(),
    legacyPhpId,
    itemCount: orderItemData.length,
    incompleteItems,
    unresolvedStaff: staffResolution.legacyStaffId && !staffResolution.staff ? staffResolution.legacyStaffId : "",
  };
}

function summarize(results, discovered, sourceErrors = []) {
  return {
    historicalOrdersDiscovered: discovered,
    imported: results.filter((row) => row.action === "imported").length,
    dryRunImportable: results.filter((row) => row.action === "dry-run-importable").length,
    skippedExisting: results.filter((row) => row.action === "skipped-existing").length,
    unresolvedDealers: results.filter((row) => row.action === "unresolved-dealer"),
    unresolvedStaff: results.filter((row) => row.unresolvedStaff).map((row) => ({ legacyPhpId: row.legacyPhpId, legacyStaffId: row.unresolvedStaff })),
    ordersWithIncompleteItemMapping: results.filter((row) => row.incompleteItems > 0).map((row) => ({ legacyPhpId: row.legacyPhpId, incompleteItems: row.incompleteItems })),
    sourceErrors,
  };
}

export {
  DEFAULT_SOURCES,
  buildItemData,
  buildOrderData,
  parsePossiblyNoisyJson,
  discoverHeaders,
  importOrder,
  mapAcceptanceStatus,
  mapFulfilmentStatus,
  mapOrderStatus,
  normalizeLegacyId,
  resolveDealer,
  resolveStaff,
  summarize,
};

export async function runImport({ prisma, backendUrl, sources = DEFAULT_SOURCES, limit = DEFAULT_LIMIT, pageSize = DEFAULT_PAGE_SIZE, dryRun = true, orderId = "" }) {
  const discovery = await discoverHeaders({ backendUrl, sources, limit, pageSize, orderId });
  const results = [];
  for (const header of discovery.rows) {
    results.push(await importOrder({ prisma, backendUrl, header, dryRun }));
  }
  return summarize(results, discovery.rows.length, discovery.errors);
}





