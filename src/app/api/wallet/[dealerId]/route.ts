import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db/prisma";
import { requireAuth } from "@/server/auth/session";
import { errorStatus } from "@/server/http/auth-error";
import { isStaffLike } from "@/server/auth/sales-scope";
import { getWalletSnapshot } from "@/lib/postgresWallet";

export const runtime = "nodejs";

function parseDealerId(value: string) {
  if (!/^\d+$/.test(value)) throw new Error("Invalid dealer id.");
  return BigInt(value);
}

async function canReadWallet(actor: Awaited<ReturnType<typeof requireAuth>>, dealerId: bigint) {
  if (actor.role === "ADMIN") return true;
  if (actor.role === "DEALER") return actor.dealerId === dealerId;
  if (isStaffLike(actor) && actor.staffId) {
    const assignment = await prisma.dealerStaffAssignment.findFirst({
      where: { dealerId, staffId: actor.staffId, active: true, dealer: { deletedAt: null, user: { status: "ACTIVE" } } },
      select: { id: true },
    });
    return Boolean(assignment);
  }
  return false;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ dealerId: string }> }) {
  try {
    const actor = await requireAuth();
    const { dealerId: rawDealerId } = await params;
    const dealerId = parseDealerId(rawDealerId);
    if (!(await canReadWallet(actor, dealerId))) return NextResponse.json({ success: false, message: "Wallet access denied." }, { status: 403 });
    const limit = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get("limit") || 50)));
    const data = await getWalletSnapshot(prisma, dealerId, { limit });
    return NextResponse.json({ success: true, ...data });
  } catch (error) {
    console.error("[GET /api/wallet/[dealerId]]", error);
    const status = error instanceof Error && error.message === "Invalid dealer id." ? 400 : errorStatus(error);
    const message = status >= 500 ? "Unable to load wallet." : String((error as Error)?.message ?? "Unable to load wallet.");
    return NextResponse.json({ success: false, message }, { status });
  }
}