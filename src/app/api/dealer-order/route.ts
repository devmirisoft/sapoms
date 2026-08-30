import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db/prisma";
import { requireAuth } from "@/server/auth/session";
import { createDealerOrder, formToFields, text } from "@/lib/dealerOrderCreate";

export const runtime = "nodejs";

function jsonBigInt(_key: string, value: unknown) { return typeof value === "bigint" ? value.toString() : value; }

function logOrderFailure(stage: string, error: unknown) {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  console.error("[POST /api/dealer-order] failed", {
    stage,
    prismaCode: typeof record.code === "string" ? record.code : undefined,
    model: typeof record.modelName === "string" ? record.modelName : undefined,
    operation: typeof record.clientMethod === "string" ? record.clientMethod : undefined,
    message: error instanceof Error ? error.message : String(error),
  });
}

export async function POST(request: NextRequest) {
  let failureStage = "request";
  try {
    failureStage = "auth";
    const actor = await requireAuth();
    if (actor.role !== "DEALER" || !actor.dealerId) return NextResponse.json({ success: false, message: "Only dealers can create orders." }, { status: 403 });

    failureStage = "form parse";
    const form = await request.formData();
    if (form.has("exelefile")) return NextResponse.json({ success: false, message: "Excel order import has not been migrated to PostgreSQL yet." }, { status: 422 });
    const fields = formToFields(form);
    const idempotencyKey = text(request.headers.get("idempotency-key"), 240) || null;

    failureStage = "order create";
    const result = await prisma.$transaction((tx) => createDealerOrder(tx, fields, actor.dealerId!, {
      userId: actor.userId,
      role: actor.role,
      displayName: actor.displayName,
      sessionId: actor.sessionId,
    }, { idempotencyKey }));

    return NextResponse.json(JSON.parse(JSON.stringify({
      status: true,
      success: true,
      duplicate: result.duplicate,
      msg: "Order placed successfully",
      message: "Order placed successfully",
      orderId: result.order.id,
      order_id: result.order.id,
      orderNumber: result.order.orderNumber,
      wallet: result.wallet,
    }, jsonBigInt)));
  } catch (error: any) {
    logOrderFailure(failureStage, error);
    const status = Number(error?.status) || 500;
    return NextResponse.json({ success: false, status: false, code: error?.code || "order_failed", message: status >= 500 ? "Unable to submit order." : error.message }, { status });
  }
}
