import { NextRequest, NextResponse } from "next/server";
import { WalletStatus, WalletTransactionType } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { requireAuth } from "@/server/auth/session";
import { errorStatus } from "@/server/http/auth-error";
import { applyWalletAdjustment, applyWalletChange, getWalletSnapshot, setWalletStatus } from "@/lib/postgresWallet";

export const runtime = "nodejs";

function text(value: unknown, max = 1000) { return String(value ?? "").trim().slice(0, max); }
function parseDealerId(value: string) {
  if (!/^\d+$/.test(value)) throw new Error("Invalid dealer id.");
  return BigInt(value);
}
function actionType(action: string) {
  if (["topup", "credit"].includes(action)) return WalletTransactionType.CREDIT;
  if (["debit"].includes(action)) return WalletTransactionType.DEBIT;
  if (["refund"].includes(action)) return WalletTransactionType.REFUND;
  return null;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ dealerId: string }> }) {
  try {
    const actor = await requireAuth();
    if (actor.role !== "ADMIN") return NextResponse.json({ success: false, message: "Only Admin can manage Dealer wallets." }, { status: 403 });
    const { dealerId: rawDealerId } = await params;
    const dealerId = parseDealerId(rawDealerId);
    const body = await req.json();
    const action = text(body.action ?? body.type, 40).toLowerCase();
    const note = text(body.note);
    const reference = text(body.reference, 200);
    const idempotencyKey = text(req.headers.get("idempotency-key") || body.idempotencyKey, 240);
    if (!idempotencyKey) return NextResponse.json({ success: false, message: "Idempotency key is required." }, { status: 400 });
    if (!note) return NextResponse.json({ success: false, message: "A note is required." }, { status: 400 });
    if (!reference && action !== "disable" && action !== "deactivate") return NextResponse.json({ success: false, message: "A reference is required." }, { status: 400 });

    const result = await prisma.$transaction(async (tx) => {
      const actorMeta = { userId: actor.userId, role: actor.role, displayName: actor.displayName };
      if (action === "disable" || action === "deactivate") return setWalletStatus(tx, dealerId, WalletStatus.INACTIVE, { idempotencyKey, note, actor: actorMeta });
      if (action === "activate") return setWalletStatus(tx, dealerId, WalletStatus.ACTIVE, { idempotencyKey, note, actor: actorMeta });
      if (action === "adjust" || action === "adjustment") {
        await applyWalletAdjustment(tx, dealerId, body.amount, {
          direction: text(body.direction, 20).toLowerCase() === "debit" || Number(body.amount) < 0 ? "debit" : "credit",
          idempotencyKey,
          reference,
          note,
          actor: actorMeta,
          allowCreate: true,
        });
        return getWalletSnapshot(tx, dealerId, { limit: 50 });
      }
      const type = actionType(action);
      if (!type) throw Object.assign(new Error("Unsupported wallet action."), { status: 400, code: "unsupported_action" });
      await applyWalletChange(tx, dealerId, type, body.amount, {
        idempotencyKey,
        reference,
        note,
        actor: actorMeta,
        allowCreate: type === WalletTransactionType.CREDIT || type === WalletTransactionType.REFUND,
      });
      return getWalletSnapshot(tx, dealerId, { limit: 50 });
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    console.error("[POST /api/wallet/[dealerId]/adjust]", error);
    const status = Number(error?.status) || (error?.message === "Invalid dealer id." ? 400 : errorStatus(error));
    return NextResponse.json({ success: false, code: error?.code || "wallet_error", message: status >= 500 ? "Unable to update wallet." : error?.message }, { status });
  }
}