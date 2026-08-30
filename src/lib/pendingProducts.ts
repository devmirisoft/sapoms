import { mergeOrderItemsWithDispatchRecords, type OrderDispatchRecord } from "./orderDispatch";
import { getSearchQueryInfo, normalizeCatalogueNumber } from "./productSearch.js";

export type PendingProductsRole = "admin" | "staff" | "dealer";

const pendingProductsGlobal = globalThis as typeof globalThis & {
  __pendingProductsCacheVersion?: number;
};

export function getPendingProductsCacheVersion() {
  return pendingProductsGlobal.__pendingProductsCacheVersion ?? 0;
}

export function invalidatePendingProductsCache() {
  pendingProductsGlobal.__pendingProductsCacheVersion = getPendingProductsCacheVersion() + 1;
  return pendingProductsGlobal.__pendingProductsCacheVersion;
}

export type PendingProductsOrderRow = {
  order_id?: string | number;
  orderId?: string | number;
  order_date?: string;
  orderDate?: string;
  order_dealer?: string | number;
  orderdata_dealerid?: string | number;
  Dealer_Id?: string | number;
  Dealer_Name?: string;
  accept_order?: string | number;
  del_status?: string | number;
  order_status?: string | number;
  mtstatus?: string;
  reason?: string;
  assignedstaff?: string;
  staffid?: string;
  staffname?: string;
};

export type PendingProductsItemRow = {
  orderdata_id?: string | number;
  orderdata_orderid?: string | number;
  orderdata_cat_no?: string;
  product_name?: string;
  product_discription?: string;
  product_unit?: string;
  orderdata_item_quantity?: string | number;
  readyquantity?: string | number;
  orderdata_status?: string | number;
  remark?: string;
  remarks?: string;
  packSize?: string | number;
  pack_size?: string | number;
  totalPieces?: string | number;
  total_pieces?: string | number;
  quantityPacks?: string | number;
  quantity_packs?: string | number;
  category?: string;
  item_category?: string;
  product_category?: string;
  productCategory?: string;
};

export type PendingDealerDirectoryRow = {
  Dealer_Id?: string | number;
  Dealer_Name?: string;
  assignedstaff?: string;
  staffname?: string;
};

export type PendingProductLine = {
  productKey: string;
  catalogueNumber: string;
  normalizedCatalogueNumber: string;
  productName: string;
  specification: string;
  category: string;
  image: string;
  orderId: string;
  orderDate: string;
  orderDateMs: number | null;
  dealerId: string;
  dealerName: string;
  assignedStaffIds: string[];
  assignedStaffNames: string[];
  orderItemId: string | null;
  dispatchStatus: string;
  latestDispatchUpdateAt: string;
  latestDispatchUpdateMs: number | null;
  orderedQuantity: number;
  dispatchedQuantity: number;
  pendingQuantity: number;
  packSize: number;
  totalPieces: number;
  productUnit: string;
  acceptOrder: string;
  delStatus: string;
  orderStatus: string;
  mtstatus: string;
  reason: string;
  malformedIdentity: boolean;
};

export type PendingProductAggregate = {
  productKey: string;
  catalogueNumber: string;
  normalizedCatalogueNumber: string;
  productName: string;
  specification: string;
  category: string;
  image: string;
  productUnit: string;
  orderedQuantity: number;
  dispatchedQuantity: number;
  pendingQuantity: number;
  fulfillmentPercent: number;
  pendingOrders: number;
  dealersAffected: number;
  oldestPendingDate: string;
  oldestPendingDateMs: number | null;
  latestDispatchUpdateAt: string;
  latestDispatchUpdateMs: number | null;
  dealerIds: string[];
  assignedStaffIds: string[];
};

export type PendingProductOrderContribution = {
  orderId: string;
  orderDate: string;
  orderDateMs: number | null;
  dealerId: string;
  dealerName: string;
  assignedStaffIds: string[];
  assignedStaffNames: string[];
  orderedQuantity: number;
  dispatchedQuantity: number;
  pendingQuantity: number;
  fulfillmentPercent: number;
  packSummary: string;
  productUnit: string;
  dispatchStatus: string;
  acceptOrder: string;
  delStatus: string;
  orderStatus: string;
  mtstatus: string;
  reason: string;
  latestDispatchUpdateAt: string;
  latestDispatchUpdateMs: number | null;
  lineCount: number;
};

export type PendingProductSummary = {
  productsPending: number;
  totalPendingUnits: number;
  ordersWithPendingItems: number;
  dealersAffected: number;
};

export type PendingProductFilterOptions = {
  categories: string[];
  dealers: Array<{ id: string; name: string }>;
  staff: Array<{ id: string; name: string }>;
};

type CatalogueLookupEntry = {
  catalogueNumber: string;
  normalizedCatalogueNumber: string;
  productName: string;
  specification: string;
  category: string;
  image: string;
};

type CatalogueLookup = {
  byRawCatalogueNumber: Map<string, CatalogueLookupEntry>;
  byNormalizedCatalogueNumber: Map<string, CatalogueLookupEntry>;
};

type PendingDispatchMergeSource = PendingProductsItemRow & {
  orderdata_id?: string;
  orderdata_orderid?: string;
  orderdata_cat_no?: string;
  product_name?: string;
  product_discription?: string;
  product_unit?: string;
  packSize?: string | number;
  pack_size?: string | number;
  totalPieces?: string | number;
  total_pieces?: string | number;
};

const UNCATEGORIZED = "Uncategorized";

export type PendingProductClubBy = "product" | "dealer" | "category";

type PendingProductClubIdentity = Pick<
  PendingProductAggregate,
  "productKey" | "catalogueNumber" | "normalizedCatalogueNumber" | "productName" | "specification" | "category" | "image"
>;

const CLUB_IDENTITY: Record<PendingProductClubBy, (line: PendingProductLine) => PendingProductClubIdentity> = {
  product: (line) => line,
  dealer: (line) => ({
    productKey: `dealer:${line.dealerId}`,
    catalogueNumber: "",
    normalizedCatalogueNumber: "",
    productName: line.dealerName || line.dealerId || "Dealer",
    specification: "",
    category: "",
    image: "",
  }),
  category: (line) => ({
    productKey: `category:${line.category || UNCATEGORIZED}`,
    catalogueNumber: "",
    normalizedCatalogueNumber: "",
    productName: line.category || UNCATEGORIZED,
    specification: "",
    category: line.category || UNCATEGORIZED,
    image: "",
  }),
};

function clubIdentityOf(clubBy: PendingProductClubBy | undefined) {
  return CLUB_IDENTITY[clubBy as PendingProductClubBy] ?? CLUB_IDENTITY.product;
}

function safeText(value: unknown, max = 300): string {
  return typeof value === "string"
    ? value.trim().slice(0, max)
    : String(value ?? "").trim().slice(0, max);
}

function safeInteger(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
}

function normalizeText(value: unknown): string {
  return safeText(value)
    .toLowerCase()
    .replace(/[^\w/+(). -]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstNonEmpty(...values: unknown[]): string {
  for (const value of values) {
    const text = safeText(value);
    if (text) return text;
  }
  return "";
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => safeText(value))
        .filter(Boolean)
    )
  );
}

function splitCsv(value: unknown): string[] {
  return uniqueStrings(
    safeText(value)
      .split(",")
      .map((entry) => entry.trim())
  );
}

function parseDateMs(value: unknown): number | null {
  const text = safeText(value);
  if (!text) return null;
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function isoFromMs(value: number | null): string {
  return value === null ? "" : new Date(value).toISOString();
}

function regexFlag(values: unknown[]): boolean {
  return /(cancel|cancelled|canceled|reject|rejected|declin|deleted)/i.test(
    values.map((value) => safeText(value).toLowerCase()).join(" ")
  );
}

export function isEligibleOrderForPendingProducts(order: PendingProductsOrderRow): boolean {
  if (safeText(order.del_status) === "1") return false;
  if (safeText(order.accept_order) !== "1") return false;
  if (regexFlag([order.order_status, order.mtstatus, order.reason])) return false;
  return true;
}

export function resolvePendingOrderDealerId(order: PendingProductsOrderRow): string {
  return firstNonEmpty(order.order_dealer, order.orderdata_dealerid, order.Dealer_Id);
}

export function filterPendingOrdersByRoleScope(input: {
  role: PendingProductsRole;
  actorId?: string | number;
  orders: PendingProductsOrderRow[];
  assignedDealerIds?: Array<string | number>;
}): PendingProductsOrderRow[] {
  const role = input.role;
  const actorId = safeText(input.actorId);
  const scopedOrders = input.orders ?? [];

  if (role === "admin") return scopedOrders;

  if (role === "dealer") {
    if (!actorId) return [];
    return scopedOrders.filter((order) => resolvePendingOrderDealerId(order) === actorId);
  }

  const allowedDealerIds = new Set(
    (input.assignedDealerIds ?? []).map((dealerId) => safeText(dealerId)).filter(Boolean)
  );
  if (allowedDealerIds.size === 0) return [];

  return scopedOrders.filter((order) => allowedDealerIds.has(resolvePendingOrderDealerId(order)));
}

function normalizeLookupEntry(raw: Record<string, unknown>, category: string, image: string, catalogueNumber: string): CatalogueLookupEntry {
  return {
    catalogueNumber,
    normalizedCatalogueNumber: normalizeCatalogueNumber(catalogueNumber),
    productName: firstNonEmpty(raw.productName, raw.product_name, raw.name, raw.title, catalogueNumber),
    specification: firstNonEmpty(raw.specification, raw.specifications, raw.specs, raw.product_discription, raw.description),
    category: category || UNCATEGORIZED,
    image,
  };
}

export function buildPendingProductsCatalogueLookup(products: unknown[]): CatalogueLookup {
  const byRawCatalogueNumber = new Map<string, CatalogueLookupEntry>();
  const byNormalizedCatalogueNumber = new Map<string, CatalogueLookupEntry>();

  for (const product of Array.isArray(products) ? products : []) {
    if (!product || typeof product !== "object") continue;
    const productRecord = product as Record<string, unknown>;
    const category = firstNonEmpty(
      productRecord.category,
      Array.isArray(productRecord.categories)
        ? String(productRecord.categories[0] ?? "").split(">").pop()
        : ""
    ) || UNCATEGORIZED;
    const image = firstNonEmpty(productRecord.image, productRecord.imagePath, Array.isArray(productRecord.images) ? productRecord.images[0] : "");

    const productCatalogue = firstNonEmpty(
      productRecord.catalogueNumber,
      productRecord.catalogueNo,
      productRecord.catalogue_no,
      productRecord.product_cat,
      productRecord.sku,
      productRecord.id
    );

    if (productCatalogue) {
      const entry = normalizeLookupEntry(productRecord, category, image, productCatalogue);
      byRawCatalogueNumber.set(productCatalogue, entry);
      byNormalizedCatalogueNumber.set(entry.normalizedCatalogueNumber, entry);
    }

    for (const variant of Array.isArray(productRecord.variants) ? productRecord.variants : []) {
      if (!variant || typeof variant !== "object") continue;
      const variantRecord = variant as Record<string, unknown>;
      const variantCatalogue = firstNonEmpty(
        variantRecord.catalogueNumber,
        variantRecord.catalogueNo,
        variantRecord.catalogue_no,
        variantRecord.product_cat,
        variantRecord.sku,
        variantRecord.id
      );
      if (!variantCatalogue) continue;
      const entry = normalizeLookupEntry(
        { ...productRecord, ...variantRecord },
        category,
        firstNonEmpty(variantRecord.image, variantRecord.imagePath, Array.isArray(variantRecord.images) ? variantRecord.images[0] : "", image),
        variantCatalogue
      );
      byRawCatalogueNumber.set(variantCatalogue, entry);
      byNormalizedCatalogueNumber.set(entry.normalizedCatalogueNumber, entry);
    }
  }

  return { byRawCatalogueNumber, byNormalizedCatalogueNumber };
}

function resolveCatalogueEntry(lookup: CatalogueLookup, catalogueNumber: string): CatalogueLookupEntry | null {
  if (!catalogueNumber) return null;
  const direct = lookup.byRawCatalogueNumber.get(catalogueNumber);
  if (direct) return direct;
  const normalizedCatalogue = normalizeCatalogueNumber(catalogueNumber);
  return normalizedCatalogue ? lookup.byNormalizedCatalogueNumber.get(normalizedCatalogue) ?? null : null;
}

function resolveLineIdentity(item: PendingProductsItemRow, lookup: CatalogueLookup) {
  const catalogueNumber = firstNonEmpty(item.orderdata_cat_no);
  const normalizedCatalogue = normalizeCatalogueNumber(catalogueNumber);
  const catalogueEntry = resolveCatalogueEntry(lookup, catalogueNumber);
  const productName = firstNonEmpty(item.product_name, catalogueEntry?.productName, catalogueNumber, "Unnamed product");
  const specification = firstNonEmpty(item.product_discription, catalogueEntry?.specification);
  const category = firstNonEmpty(
    item.category,
    item.item_category,
    item.product_category,
    item.productCategory,
    catalogueEntry?.category
  ) || UNCATEGORIZED;
  const image = firstNonEmpty(catalogueEntry?.image);

  if (normalizedCatalogue) {
    return {
      productKey: `sku:${normalizedCatalogue}`,
      catalogueNumber,
      normalizedCatalogueNumber: normalizedCatalogue,
      productName,
      specification,
      category,
      image,
      malformedIdentity: false,
    };
  }

  const fallbackKey = [
    normalizeText(productName),
    normalizeText(specification),
    safeInteger(item.packSize ?? item.pack_size) || 1,
  ].join("::");

  return {
    productKey: `fallback:${fallbackKey || "unknown"}`,
    catalogueNumber: "",
    normalizedCatalogueNumber: "",
    productName,
    specification,
    category,
    image,
    malformedIdentity: true,
  };
}

function buildPackSummary(packSizes: number[]): string {
  const uniquePackSizes = uniqueStrings(packSizes.map((value) => String(value)));
  if (uniquePackSizes.length === 0) return "";
  if (uniquePackSizes.length === 1) return uniquePackSizes[0];
  return uniquePackSizes.join(", ");
}

export function buildPendingProductLines(input: {
  orders: PendingProductsOrderRow[];
  orderItemsByOrderId: Record<string, PendingProductsItemRow[]>;
  dispatchRecordsByOrderId?: Record<string, Array<Partial<OrderDispatchRecord>>>;
  dealerDirectoryById?: Record<string, PendingDealerDirectoryRow>;
  catalogueProducts?: unknown[];
}): PendingProductLine[] {
  const lookup = buildPendingProductsCatalogueLookup(input.catalogueProducts ?? []);
  const lines: PendingProductLine[] = [];

  for (const order of input.orders ?? []) {
    if (!isEligibleOrderForPendingProducts(order)) continue;

    const orderId = firstNonEmpty(order.order_id, order.orderId);
    if (!orderId) continue;

    const rawItems = input.orderItemsByOrderId[orderId] ?? [];
    if (rawItems.length === 0) continue;

    const mergedItems = mergeOrderItemsWithDispatchRecords<PendingDispatchMergeSource>(
      rawItems.map((item) => ({
        ...item,
        orderdata_id: firstNonEmpty(item.orderdata_id),
        orderdata_orderid: firstNonEmpty(item.orderdata_orderid, orderId),
        orderdata_cat_no: firstNonEmpty(item.orderdata_cat_no),
      })),
      input.dispatchRecordsByOrderId?.[orderId] ?? []
    );

    const dealerId = firstNonEmpty(order.order_dealer, order.orderdata_dealerid, order.Dealer_Id);
    const dealerDirectory = input.dealerDirectoryById?.[dealerId];
    const assignedStaffIds = uniqueStrings([
      ...splitCsv(order.assignedstaff),
      ...splitCsv(order.staffid),
      ...splitCsv(dealerDirectory?.assignedstaff),
    ]);
    const assignedStaffNames = uniqueStrings([
      ...splitCsv(order.staffname),
      ...splitCsv(dealerDirectory?.staffname),
    ]);
    const orderDate = firstNonEmpty(order.orderDate, order.order_date);
    const orderDateMs = parseDateMs(orderDate);

    for (const item of mergedItems) {
      const identity = resolveLineIdentity(item, lookup);
      const orderedQuantity = safeInteger(item.orderedQuantity);
      const dispatchedQuantity = safeInteger(item.dispatchedQuantity);
      const pendingQuantity = Math.max(0, orderedQuantity - dispatchedQuantity);
      if (pendingQuantity <= 0) continue;

      const latestDispatchUpdateMs = Array.isArray(item.dispatchHistory)
        ? item.dispatchHistory.reduce<number | null>((latest, entry) => {
            const entryMs = parseDateMs(entry.createdAt);
            if (entryMs === null) return latest;
            return latest === null || entryMs > latest ? entryMs : latest;
          }, null)
        : null;

      const packSize = safeInteger(item.packSize ?? item.pack_size) || 1;
      const totalPieces = safeInteger(item.totalPieces ?? item.total_pieces) || orderedQuantity * packSize;

      lines.push({
        ...identity,
        orderId,
        orderDate,
        orderDateMs,
        dealerId,
        dealerName: firstNonEmpty(order.Dealer_Name, dealerDirectory?.Dealer_Name, "Dealer"),
        assignedStaffIds,
        assignedStaffNames,
        orderItemId: firstNonEmpty(item.orderItemId, item.orderdata_id) || null,
        dispatchStatus: firstNonEmpty(item.dispatchStatus, item.orderdata_status, "pending"),
        latestDispatchUpdateAt: isoFromMs(latestDispatchUpdateMs),
        latestDispatchUpdateMs,
        orderedQuantity,
        dispatchedQuantity,
        pendingQuantity,
        packSize,
        totalPieces,
        productUnit: firstNonEmpty(item.product_unit, "Units"),
        acceptOrder: safeText(order.accept_order),
        delStatus: safeText(order.del_status),
        orderStatus: safeText(order.order_status),
        mtstatus: safeText(order.mtstatus),
        reason: safeText(order.reason),
        malformedIdentity: identity.malformedIdentity,
      });
    }
  }

  return lines;
}

export function filterPendingProductLines(
  lines: PendingProductLine[],
  filters: {
    dealerId?: string;
    assignedStaffId?: string;
  }
): PendingProductLine[] {
  const dealerId = safeText(filters.dealerId);
  const assignedStaffId = safeText(filters.assignedStaffId);

  return (lines ?? []).filter((line) => {
    if (dealerId && line.dealerId !== dealerId) return false;
    if (assignedStaffId && !line.assignedStaffIds.includes(assignedStaffId)) return false;
    return true;
  });
}

export type PendingReportPeriod = "all" | "day" | "month" | "quarter" | "half_year" | "year";

/** Rolling window lengths, counted back from "now" rather than calendar boundaries. */
const PENDING_REPORT_PERIOD_DAYS: Record<Exclude<PendingReportPeriod, "all">, number> = {
  day: 1,
  month: 30,
  quarter: 90,
  half_year: 180,
  year: 365,
};

export function parsePendingReportPeriod(value: unknown): PendingReportPeriod {
  const text = String(value ?? "").trim().toLowerCase();
  return text in PENDING_REPORT_PERIOD_DAYS ? (text as PendingReportPeriod) : "all";
}

/** Inclusive lower bound for a period, or null when the period is unbounded. */
export function pendingReportPeriodStartMs(period: PendingReportPeriod, nowMs: number): number | null {
  if (period === "all") return null;
  const days = PENDING_REPORT_PERIOD_DAYS[period];
  return nowMs - days * 24 * 60 * 60 * 1000;
}

/** Narrows pending lines to those whose order was placed inside the period. */
export function filterPendingLinesByPeriod(
  lines: PendingProductLine[],
  period: PendingReportPeriod,
  nowMs: number = Date.now()
): PendingProductLine[] {
  const startMs = pendingReportPeriodStartMs(period, nowMs);
  if (startMs === null) return lines ?? [];
  // A line with an unparseable order date cannot be placed in a window at all,
  // and keeping it would silently inflate every period report.
  return (lines ?? []).filter((line) => line.orderDateMs !== null && line.orderDateMs >= startMs);
}

export function aggregatePendingProducts(
  lines: PendingProductLine[],
  clubBy: PendingProductClubBy = "product"
): PendingProductAggregate[] {
  const aggregates = new Map<string, PendingProductAggregate & {
    orderIds: Set<string>;
    dealerIdsSet: Set<string>;
    assignedStaffIdsSet: Set<string>;
  }>();

  const identityOf = clubIdentityOf(clubBy);

  for (const line of lines ?? []) {
    const identity = identityOf(line);
    const existing = aggregates.get(identity.productKey);
    if (existing) {
      existing.orderedQuantity += line.orderedQuantity;
      existing.dispatchedQuantity += line.dispatchedQuantity;
      existing.pendingQuantity += line.pendingQuantity;
      existing.orderIds.add(line.orderId);
      if (!existing.productUnit) existing.productUnit = line.productUnit;
      if (line.dealerId) existing.dealerIdsSet.add(line.dealerId);
      line.assignedStaffIds.forEach((staffId) => existing.assignedStaffIdsSet.add(staffId));

      if (line.orderDateMs !== null && (existing.oldestPendingDateMs === null || line.orderDateMs < existing.oldestPendingDateMs)) {
        existing.oldestPendingDateMs = line.orderDateMs;
        existing.oldestPendingDate = isoFromMs(line.orderDateMs);
      }

      if (
        line.latestDispatchUpdateMs !== null &&
        (existing.latestDispatchUpdateMs === null || line.latestDispatchUpdateMs > existing.latestDispatchUpdateMs)
      ) {
        existing.latestDispatchUpdateMs = line.latestDispatchUpdateMs;
        existing.latestDispatchUpdateAt = isoFromMs(line.latestDispatchUpdateMs);
      }
      continue;
    }

    aggregates.set(identity.productKey, {
      ...identity,
      productUnit: line.productUnit,
      orderedQuantity: line.orderedQuantity,
      dispatchedQuantity: line.dispatchedQuantity,
      pendingQuantity: line.pendingQuantity,
      fulfillmentPercent: 0,
      pendingOrders: 0,
      dealersAffected: 0,
      oldestPendingDate: isoFromMs(line.orderDateMs),
      oldestPendingDateMs: line.orderDateMs,
      latestDispatchUpdateAt: isoFromMs(line.latestDispatchUpdateMs),
      latestDispatchUpdateMs: line.latestDispatchUpdateMs,
      dealerIds: [],
      assignedStaffIds: [],
      orderIds: new Set([line.orderId]),
      dealerIdsSet: new Set(line.dealerId ? [line.dealerId] : []),
      assignedStaffIdsSet: new Set(line.assignedStaffIds),
    });
  }

  return Array.from(aggregates.values()).map((aggregate) => {
    const pendingOrders = aggregate.orderIds.size;
    const dealerIds = Array.from(aggregate.dealerIdsSet).sort();
    const assignedStaffIds = Array.from(aggregate.assignedStaffIdsSet).sort();

    return {
      productKey: aggregate.productKey,
      catalogueNumber: aggregate.catalogueNumber,
      normalizedCatalogueNumber: aggregate.normalizedCatalogueNumber,
      productName: aggregate.productName,
      specification: aggregate.specification,
      category: aggregate.category,
      image: aggregate.image,
      productUnit: aggregate.productUnit,
      orderedQuantity: aggregate.orderedQuantity,
      dispatchedQuantity: aggregate.dispatchedQuantity,
      pendingQuantity: aggregate.pendingQuantity,
      fulfillmentPercent: aggregate.orderedQuantity > 0
        ? Math.round((aggregate.dispatchedQuantity / aggregate.orderedQuantity) * 10000) / 100
        : 0,
      pendingOrders,
      dealersAffected: dealerIds.length,
      oldestPendingDate: aggregate.oldestPendingDate,
      oldestPendingDateMs: aggregate.oldestPendingDateMs,
      latestDispatchUpdateAt: aggregate.latestDispatchUpdateAt,
      latestDispatchUpdateMs: aggregate.latestDispatchUpdateMs,
      dealerIds,
      assignedStaffIds,
    };
  });
}

export function buildPendingProductsSummaryFromLines(lines: PendingProductLine[]): PendingProductSummary {
  const productAggregates = aggregatePendingProducts(lines);
  const orderIds = new Set<string>();
  const dealerIds = new Set<string>();

  let totalPendingUnits = 0;
  for (const line of lines ?? []) {
    totalPendingUnits += line.pendingQuantity;
    orderIds.add(line.orderId);
    if (line.dealerId) dealerIds.add(line.dealerId);
  }

  return {
    productsPending: productAggregates.length,
    totalPendingUnits,
    ordersWithPendingItems: orderIds.size,
    dealersAffected: dealerIds.size,
  };
}

export function buildPendingProductFilterOptions(lines: PendingProductLine[]): PendingProductFilterOptions {
  const categories = uniqueStrings(
    lines.map((line) => line.category)
  ).sort((left, right) => left.localeCompare(right));

  const dealers = Array.from(
    lines.reduce((map, line) => {
      if (line.dealerId && !map.has(line.dealerId)) {
        map.set(line.dealerId, { id: line.dealerId, name: line.dealerName || line.dealerId });
      }
      return map;
    }, new Map<string, { id: string; name: string }>())
  )
    .map((entry) => entry[1])
    .sort((left, right) => left.name.localeCompare(right.name));

  const staff = Array.from(
    lines.reduce((map, line) => {
      line.assignedStaffIds.forEach((staffId, index) => {
        if (!staffId || map.has(staffId)) return;
        map.set(staffId, {
          id: staffId,
          name: line.assignedStaffNames[index] || staffId,
        });
      });
      return map;
    }, new Map<string, { id: string; name: string }>())
  )
    .map((entry) => entry[1])
    .sort((left, right) => left.name.localeCompare(right.name));

  return { categories, dealers, staff };
}

function aggregateMatchesSearch(aggregate: PendingProductAggregate, query: string): boolean {
  const queryInfo = getSearchQueryInfo(query);
  if (!queryInfo.normalizedQuery || queryInfo.keywords.length === 0) return true;

  const fields = [
    normalizeText(aggregate.productName),
    normalizeText(aggregate.catalogueNumber),
    normalizeCatalogueNumber(aggregate.catalogueNumber),
    normalizeText(aggregate.specification),
    normalizeText(aggregate.category),
  ];

  return queryInfo.keywords.every((keyword) => {
    const normalizedKeyword = normalizeText(keyword);
    const normalizedCatalogueKeyword = normalizeCatalogueNumber(keyword);

    return fields.some((field) => {
      if (!field) return false;
      if (normalizedCatalogueKeyword && field.includes(normalizedCatalogueKeyword)) return true;
      return normalizedKeyword ? field.includes(normalizedKeyword) : false;
    });
  });
}

export function filterPendingProducts(
  aggregates: PendingProductAggregate[],
  filters: {
    search?: string;
    category?: string;
  }
): PendingProductAggregate[] {
  const category = safeText(filters.category);
  const search = safeText(filters.search, 240);

  return (aggregates ?? []).filter((aggregate) => {
    if (category && aggregate.category !== category) return false;
    if (search && !aggregateMatchesSearch(aggregate, search)) return false;
    return true;
  });
}

export function sortPendingProducts(
  aggregates: PendingProductAggregate[],
  sort: "pending_desc" | "oldest_pending" | "alphabetical" = "pending_desc"
): PendingProductAggregate[] {
  const sorted = [...(aggregates ?? [])];

  sorted.sort((left, right) => {
    if (sort === "alphabetical") {
      const nameCompare = left.productName.localeCompare(right.productName, undefined, { sensitivity: "base" });
      if (nameCompare !== 0) return nameCompare;
    } else if (sort === "oldest_pending") {
      const leftDate = left.oldestPendingDateMs ?? Number.MAX_SAFE_INTEGER;
      const rightDate = right.oldestPendingDateMs ?? Number.MAX_SAFE_INTEGER;
      if (leftDate !== rightDate) return leftDate - rightDate;
      if (right.pendingQuantity !== left.pendingQuantity) return right.pendingQuantity - left.pendingQuantity;
    } else {
      if (right.pendingQuantity !== left.pendingQuantity) return right.pendingQuantity - left.pendingQuantity;
      const leftDate = left.oldestPendingDateMs ?? Number.MAX_SAFE_INTEGER;
      const rightDate = right.oldestPendingDateMs ?? Number.MAX_SAFE_INTEGER;
      if (leftDate !== rightDate) return leftDate - rightDate;
    }

    const catalogueCompare = left.catalogueNumber.localeCompare(right.catalogueNumber, undefined, { sensitivity: "base" });
    if (catalogueCompare !== 0) return catalogueCompare;
    return left.productKey.localeCompare(right.productKey, undefined, { sensitivity: "base" });
  });

  return sorted;
}

export function paginatePendingProducts<T>(items: T[], page: number, pageSize: number) {
  const resolvedPageSize = Math.max(1, Math.floor(pageSize) || 20);
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / resolvedPageSize));
  const resolvedPage = Math.min(Math.max(1, Math.floor(page) || 1), totalPages);
  const startIndex = (resolvedPage - 1) * resolvedPageSize;

  return {
    page: resolvedPage,
    pageSize: resolvedPageSize,
    total,
    totalPages,
    items: items.slice(startIndex, startIndex + resolvedPageSize),
  };
}

export function buildPendingProductDrilldown(
  lines: PendingProductLine[],
  productKey: string,
  clubBy: PendingProductClubBy = "product"
): {
  aggregate: PendingProductAggregate | null;
  orders: PendingProductOrderContribution[];
} {
  const identityOf = clubIdentityOf(clubBy);
  const productLines = (lines ?? []).filter((line) => identityOf(line).productKey === productKey);
  if (productLines.length === 0) {
    return { aggregate: null, orders: [] };
  }

  const aggregate = aggregatePendingProducts(productLines, clubBy)[0] ?? null;
  const grouped = new Map<string, PendingProductOrderContribution & { packSizes: number[] }>();

  for (const line of productLines) {
    const existing = grouped.get(line.orderId);
    if (existing) {
      existing.orderedQuantity += line.orderedQuantity;
      existing.dispatchedQuantity += line.dispatchedQuantity;
      existing.pendingQuantity += line.pendingQuantity;
      existing.lineCount += 1;
      existing.packSizes.push(line.packSize);
      if (
        line.latestDispatchUpdateMs !== null &&
        (existing.latestDispatchUpdateMs === null || line.latestDispatchUpdateMs > existing.latestDispatchUpdateMs)
      ) {
        existing.latestDispatchUpdateMs = line.latestDispatchUpdateMs;
        existing.latestDispatchUpdateAt = isoFromMs(line.latestDispatchUpdateMs);
      }
      continue;
    }

    grouped.set(line.orderId, {
      orderId: line.orderId,
      orderDate: line.orderDate,
      orderDateMs: line.orderDateMs,
      dealerId: line.dealerId,
      dealerName: line.dealerName,
      assignedStaffIds: line.assignedStaffIds,
      assignedStaffNames: line.assignedStaffNames,
      orderedQuantity: line.orderedQuantity,
      dispatchedQuantity: line.dispatchedQuantity,
      pendingQuantity: line.pendingQuantity,
      fulfillmentPercent: 0,
      packSummary: "",
      productUnit: line.productUnit,
      dispatchStatus: line.dispatchStatus,
      acceptOrder: line.acceptOrder,
      delStatus: line.delStatus,
      orderStatus: line.orderStatus,
      mtstatus: line.mtstatus,
      reason: line.reason,
      latestDispatchUpdateAt: line.latestDispatchUpdateAt,
      latestDispatchUpdateMs: line.latestDispatchUpdateMs,
      lineCount: 1,
      packSizes: [line.packSize],
    });
  }

  const orders = Array.from(grouped.values())
    .map((order) => ({
      orderId: order.orderId,
      orderDate: order.orderDate,
      orderDateMs: order.orderDateMs,
      dealerId: order.dealerId,
      dealerName: order.dealerName,
      assignedStaffIds: order.assignedStaffIds,
      assignedStaffNames: order.assignedStaffNames,
      orderedQuantity: order.orderedQuantity,
      dispatchedQuantity: order.dispatchedQuantity,
      pendingQuantity: order.pendingQuantity,
      fulfillmentPercent: order.orderedQuantity > 0
        ? Math.round((order.dispatchedQuantity / order.orderedQuantity) * 10000) / 100
        : 0,
      packSummary: buildPackSummary(order.packSizes),
      productUnit: order.productUnit,
      dispatchStatus: order.dispatchStatus,
      acceptOrder: order.acceptOrder,
      delStatus: order.delStatus,
      orderStatus: order.orderStatus,
      mtstatus: order.mtstatus,
      reason: order.reason,
      latestDispatchUpdateAt: order.latestDispatchUpdateAt,
      latestDispatchUpdateMs: order.latestDispatchUpdateMs,
      lineCount: order.lineCount,
    }))
    .sort((left, right) => {
      const leftDate = left.orderDateMs ?? Number.MAX_SAFE_INTEGER;
      const rightDate = right.orderDateMs ?? Number.MAX_SAFE_INTEGER;
      if (leftDate !== rightDate) return leftDate - rightDate;
      return right.pendingQuantity - left.pendingQuantity;
    });

  return { aggregate, orders };
}
