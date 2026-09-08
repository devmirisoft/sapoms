import { mapPostgresOrderItemToLegacy, mapPostgresOrderToLegacy } from "@/lib/postgresOrders";
import type { AdminOrderItemRecord, AdminOrderRecord } from "./orders.types";

function money(value: bigint) {
  return value.toString();
}

function mapOrderItem(item: AdminOrderItemRecord, record?: AdminOrderRecord) {
  const legacy = record ? mapPostgresOrderItemToLegacy(item, record) : {};
  return {
    ...legacy,
    id: item.id.toString(),
    legacyPhpOrderItemId: item.legacyPhpOrderItemId || null,
    productVariantId: item.productVariantId?.toString() ?? null,
    productName: item.productNameSnapshot,
    catalogueNumber: item.catalogueNumberSnapshot,
    category: item.categorySnapshot || "",
    quantityPacks: item.quantityPacks,
    packSize: item.packSize,
    totalPieces: item.totalPieces,
    unitPricePaise: money(item.unitPricePaise),
    packPricePaise: money(item.packPricePaise),
    listPriceTotalPaise: money(item.listPriceTotalPaise),
    discountAmountPaise: money(item.discountAmountPaise),
    finalAmountPaise: money(item.finalAmountPaise),
    productNote: item.productNote || "",
    remarks: item.remarks || "",
    isPriority: item.isPriority,
  };
}

export function mapAdminOrderListItem(record: AdminOrderRecord) {
  const legacy = mapPostgresOrderToLegacy(record);
  return {
    ...legacy,
    id: record.id.toString(),
    orderNumber: record.orderNumber,
    orderDate: record.orderDate.toISOString(),
    dealer: {
      id: record.dealer.id.toString(),
      name: record.dealer.businessName,
      dealerCode: record.dealer.dealerCode || "",
    },
    assignedStaff: record.assignedStaff
      ? { id: record.assignedStaff.id.toString(), name: record.assignedStaff.displayName }
      : null,
    grossAmountPaise: money(record.grossAmountPaise),
    finalPayableAmountPaise: money(record.finalPayableAmountPaise),
    status: record.status,
    acceptanceStatus: record.acceptanceStatus,
    fulfilmentStatus: record.fulfilmentStatus,
  };
}

export function mapAdminOrderDetail(record: AdminOrderRecord) {
  return {
    ...mapAdminOrderListItem(record),
    legacyPhpId: record.legacyPhpId || null,
    baseDiscountAmountPaise: money(record.baseDiscountAmountPaise),
    additionalDiscountAmountPaise: money(record.additionalDiscountAmountPaise),
    couponDiscountAmountPaise: money(record.couponDiscountAmountPaise),
    cancelledAt: record.cancelledAt?.toISOString() ?? null,
    completedAt: record.completedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    items: (record.items ?? []).map((item) => mapOrderItem(item, record)),
    productorder: (record.items ?? []).map((item) => mapOrderItem(item, record)),
    notes: record.note ? [{ type: "order", note: record.note }] : [],
  };
}