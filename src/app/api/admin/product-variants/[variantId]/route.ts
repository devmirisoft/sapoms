import { NextRequest, NextResponse } from "next/server";
import { invalidatePendingProductsCache } from "@/lib/pendingProducts";
import { adminErrorResponse } from "@/server/admin/admin-errors";
import { auditAdminAction, parseBigIntRouteParam, requireAdmin, requestIdFrom } from "@/server/admin/admin-route";
import { setAdminVariantActive } from "@/server/modules/admin/products/products.service";

export const runtime = "nodejs";

/** Enable or disable one catalogue number: { active: boolean, note?: string } (note required to disable). */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ variantId: string }> }) {
  try {
    const actor = await requireAdmin();
    const requestId = requestIdFrom(request);
    const { variantId } = await params;
    const id = parseBigIntRouteParam(variantId, "variantId");
    const body = await request.json().catch(() => ({}));
    if (typeof body?.active !== "boolean") return NextResponse.json({ success: false, message: "active must be true or false" }, { status: 400 });
    const data = await setAdminVariantActive(id, body.active, body.note, actor);
    if (data.affectedOrders) invalidatePendingProductsCache();
    await auditAdminAction({ actor, request, eventType: "ADMIN_PRODUCT_UPDATED", route: "/api/admin/product-variants/[variantId]", requestId, targetId: variantId });
    return NextResponse.json({ success: true, data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[PATCH /api/admin/product-variants/[variantId]]", error);
    return adminErrorResponse(error, "Product could not be updated");
  }
}
