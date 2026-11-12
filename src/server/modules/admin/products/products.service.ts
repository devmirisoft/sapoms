import { AdminRouteError } from "@/server/admin/admin-errors";
import { AUDIT_ACTION, AUDIT_ENTITY } from "@/lib/auditActions";
import { createAuditLog, type AuditActorInput } from "@/server/audit/audit-log";
import { diffValues } from "@/server/audit/audit-sanitize";
import { invalidateCatalogue } from "@/server/modules/products/catalogue";
import { adminProductRepository } from "./products.repository";
import { mapAdminProduct } from "./products.mapper";
import type { AdminProductListInput, AdminProductRecord, ProductWriteInput } from "./products.types";

// Only the fields worth seeing in a diff — variants are a nested collection and
// belong in the product detail, not in an audit row.
function productValues(record: Pick<AdminProductRecord, "name" | "productCode" | "active"> & { categoryId?: bigint | null }) {
  return {
    name: record.name,
    productCode: record.productCode,
    active: record.active,
  };
}

export async function listAdminProducts(input: AdminProductListInput) {
  const result = await adminProductRepository.list(input);
  return { items: result.items.map(mapAdminProduct), total: result.total };
}

export async function getAdminProduct(productId: bigint) {
  const record = await adminProductRepository.findById(productId);
  if (!record) throw new AdminRouteError("NOT_FOUND", "Product not found");
  return mapAdminProduct(record);
}

export async function createAdminProduct(input: ProductWriteInput, actor?: AuditActorInput) {
  const created = await adminProductRepository.create(input);
  await createAuditLog({
    actor,
    action: AUDIT_ACTION.CREATE,
    entity: AUDIT_ENTITY.PRODUCT,
    entityId: created.id.toString(),
    newValues: productValues(created),
  });
  return mapAdminProduct(created);
}

export async function updateAdminProduct(productId: bigint, input: ProductWriteInput, actor?: AuditActorInput) {
  const existing = await adminProductRepository.findById(productId);
  if (!existing) throw new AdminRouteError("NOT_FOUND", "Product not found");
  const updated = await adminProductRepository.update(productId, input);
  await createAuditLog({
    actor,
    action: AUDIT_ACTION.UPDATE,
    entity: AUDIT_ENTITY.PRODUCT,
    entityId: productId.toString(),
    ...diffValues(productValues(existing), productValues(updated)),
  });
  return mapAdminProduct(updated);
}

/**
 * The product list's toggle, per catalogue number. Disabling hides it from dealers
 * (the catalogue only serves active variants) and zeroes its undispatched lines on
 * open orders; enabling only brings it back to the catalogue - zeroed lines stay.
 */
export async function setAdminVariantActive(variantId: bigint, active: boolean, rawNote: unknown, actor?: AuditActorInput) {
  const variant = await adminProductRepository.findVariant(variantId);
  if (!variant) throw new AdminRouteError("NOT_FOUND", "Catalogue number not found");
  const note = String(rawNote ?? "").trim().slice(0, 1000);
  if (!active && !note) throw new AdminRouteError("INVALID_REQUEST", "Add a note saying why this product is being disabled");

  await adminProductRepository.setVariantActive(variantId, active, note);
  // Before the order sweep, so no new order can pick the item up after it.
  invalidateCatalogue();
  const { affected, failedOrderIds } = active ? { affected: [], failedOrderIds: [] } : await adminProductRepository.disableOpenOrderLines(variant, note);
  await createAuditLog({
    actor,
    action: AUDIT_ACTION.UPDATE,
    entity: AUDIT_ENTITY.PRODUCT,
    entityId: variant.productId.toString(),
    oldValues: { catalogueNumber: variant.catalogueNumber || variant.sku, active: variant.active, disabledNote: variant.disabledNote },
    newValues: { catalogueNumber: variant.catalogueNumber || variant.sku, active, disabledNote: active ? null : note },
    // The zeroed lines' original pack counts live only here.
    metadata: { variantId: variantId.toString(), zeroedOrderLines: affected, failedOrderIds },
  });
  return { active, disabledNote: active ? "" : note, affectedOrders: new Set(affected.map((line) => line.orderNumber)).size, failedOrders: failedOrderIds.length };
}

export async function deleteAdminProduct(productId: bigint, actor?: AuditActorInput) {
  const existing = await adminProductRepository.findById(productId);
  if (!existing) throw new AdminRouteError("NOT_FOUND", "Product not found");
  await adminProductRepository.delete(productId);
  await createAuditLog({
    actor,
    action: AUDIT_ACTION.DELETE,
    entity: AUDIT_ENTITY.PRODUCT,
    entityId: productId.toString(),
    oldValues: productValues(existing),
  });
}
