import { NextRequest, NextResponse } from "next/server";
import { adminDetailResponse } from "@/server/admin/admin-response";
import { adminErrorResponse } from "@/server/admin/admin-errors";
import { auditAdminAction, parseBigIntRouteParam, requireAdmin, requestIdFrom } from "@/server/admin/admin-route";
import { deleteAdminProduct, getAdminProduct, updateAdminProduct } from "@/server/modules/admin/products/products.service";
import { parseProductWriteInput } from "@/server/modules/products/product-write";

export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ productId: string }> }) {
  try {
    const actor = await requireAdmin();
    const requestId = requestIdFrom(request);
    const { productId } = await params;
    const id = parseBigIntRouteParam(productId, "productId");
    const data = await getAdminProduct(id);
    await auditAdminAction({ actor, request, eventType: "ADMIN_PRODUCT_VIEWED", route: "/api/admin/products/[productId]", requestId, targetId: productId });
    return NextResponse.json(adminDetailResponse(data), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[GET /api/admin/products/[productId]]", error);
    return adminErrorResponse(error, "Product is unavailable");
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ productId: string }> }) {
  try {
    const actor = await requireAdmin();
    const requestId = requestIdFrom(request);
    const { productId } = await params;
    const id = parseBigIntRouteParam(productId, "productId");
    const data = await updateAdminProduct(id, parseProductWriteInput(await request.json()), actor);
    await auditAdminAction({ actor, request, eventType: "ADMIN_PRODUCT_UPDATED", route: "/api/admin/products/[productId]", requestId, targetId: productId });
    return NextResponse.json({ success: true, data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[PATCH /api/admin/products/[productId]]", error);
    return adminErrorResponse(error, "Product could not be saved");
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ productId: string }> }) {
  try {
    const actor = await requireAdmin();
    const requestId = requestIdFrom(request);
    const { productId } = await params;
    const id = parseBigIntRouteParam(productId, "productId");
    await deleteAdminProduct(id, actor);
    await auditAdminAction({ actor, request, eventType: "ADMIN_PRODUCT_DELETED", route: "/api/admin/products/[productId]", requestId, targetId: productId });
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[DELETE /api/admin/products/[productId]]", error);
    return adminErrorResponse(error, "Product could not be deleted");
  }
}
