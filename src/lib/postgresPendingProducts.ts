import catalogueJson from "../../public/data/omsonsdata.json";
import { mergeCatalogueRecords, type CatalogueProduct } from "@/lib/catalogue";
import { prisma } from "@/server/db/prisma";
import type { PendingProductsItemRow, PendingProductsOrderRow } from "@/lib/pendingProducts";
import { resolvePendingOverlayStates, type PendingOverlayState } from "@/lib/pendingProductOverlays";

// Shared by the Pending Products and Dispatch Tracking routes, so both read the
// same lines out of the same orders.

// The file has one record per catalogue page; reports work on whole products.
export const pendingCatalogueProducts = mergeCatalogueRecords(catalogueJson as unknown as CatalogueProduct[]).products;

export type PendingSourceOrder = {
  id: bigint;
  legacyPhpId: string | null;
  orderNumber: string;
  orderDate: Date;
  dealerId: bigint;
  dealer: { businessName: string; dealerCode: string | null };
  status: string;
  fulfilmentStatus: string;
  cancellationReason: string | null;
  assignedStaffId: bigint | null;
  assignedStaff: { displayName: string } | null;
  items: Array<{
    id: bigint;
    legacyPhpOrderItemId: string | null;
    catalogueNumberSnapshot: string;
    productNameSnapshot: string;
    skuSnapshot: string | null;
    categorySnapshot: string | null;
    quantityPacks: number;
    packSize: number;
    totalPieces: number;
    remarks: string | null;
    dispatches: Array<{ quantity: number }>;
  }>;
};

export async function loadOrderOverlayStates(orders: PendingSourceOrder[]) {
  if (orders.length === 0) return new Map<string, PendingOverlayState>();

  const rows = await prisma.orderOverlay.findMany({
    where: { orderId: { in: orders.map((order) => order.id) } },
    orderBy: { createdAt: "asc" },
    select: { orderId: true, type: true, status: true, metadata: true },
  });

  return resolvePendingOverlayStates(
    rows,
    new Map(orders.map((order) => [order.id.toString(), order.legacyPhpId || order.id.toString()]))
  );
}

export function orderAlias(order: PendingSourceOrder): PendingProductsOrderRow {
  return {
    order_id: order.legacyPhpId || order.id.toString(),
    orderId: order.legacyPhpId || order.id.toString(),
    order_number: order.orderNumber,
    order_date: order.orderDate.toISOString(),
    orderDate: order.orderDate.toISOString(),
    order_dealer: order.dealerId.toString(),
    orderdata_dealerid: order.dealerId.toString(),
    Dealer_Id: order.dealerId.toString(),
    Dealer_Name: order.dealer.businessName,
    Dealer_Code: order.dealer.dealerCode ?? "",
    accept_order: "1",
    del_status: "0",
    order_status: order.status,
    mtstatus: order.fulfilmentStatus,
    reason: order.cancellationReason ?? "",
    assignedstaff: order.assignedStaffId?.toString() ?? "",
    staffid: order.assignedStaffId?.toString() ?? "",
    staffname: order.assignedStaff?.displayName ?? "",
  };
}

export function itemAliases(order: PendingSourceOrder): PendingProductsItemRow[] {
  const orderId = order.legacyPhpId || order.id.toString();
  return order.items.map((item) => ({
    orderdata_id: item.legacyPhpOrderItemId || item.id.toString(),
    orderdata_orderid: orderId,
    orderdata_cat_no: item.catalogueNumberSnapshot,
    product_name: item.productNameSnapshot,
    product_discription: item.skuSnapshot ?? "",
    product_unit: "Units",
    orderdata_item_quantity: item.quantityPacks,
    readyquantity: item.dispatches.reduce((sum, dispatch) => sum + dispatch.quantity, 0),
    orderdata_status: item.dispatches.length > 0 ? "1" : "0",
    remark: item.remarks ?? "",
    remarks: item.remarks ?? "",
    packSize: item.packSize,
    totalPieces: item.totalPieces,
    quantityPacks: item.quantityPacks,
    category: item.categorySnapshot ?? "",
  }));
}
