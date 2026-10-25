import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db/prisma";
import { requireAuth } from "@/server/auth/session";
import { compatibilityFailure, compatibilitySuccess } from "@/server/http/compat-response";
import { requestIp } from "@/server/http/request-meta";
import { agreementView, canViewAgreement, parseSignatureImage, recordSignatures } from "@/server/terms-signatures";

export const runtime = "nodejs";

type Params = { params: Promise<{ dealerId: string }> };

async function resolve(params: Params["params"]) {
  const actor = await requireAuth().catch(() => null);
  if (!actor) return { error: NextResponse.json(compatibilityFailure("Unauthenticated"), { status: 401 }) };
  const { dealerId } = await params;
  if (!/^\d+$/.test(dealerId)) return { error: NextResponse.json(compatibilityFailure("Invalid dealer"), { status: 400 }) };
  const id = BigInt(dealerId);
  if (!(await canViewAgreement(actor, id))) return { error: NextResponse.json(compatibilityFailure("Forbidden"), { status: 403 }) };
  return { actor, id };
}

// One dealer's agreement for admins and the dealer's assigned staff, with the slots the viewer may sign.
export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const resolved = await resolve(params);
    if ("error" in resolved) return resolved.error;
    const { blocks, signatures, signable } = await agreementView(resolved.actor, resolved.id);
    return NextResponse.json(compatibilitySuccess({ blocks, signatures, signable }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[GET /api/terms/dealers/[dealerId]]", error);
    return NextResponse.json(compatibilityFailure("Agreement unavailable"), { status: 500 });
  }
}

// Signs one slot: { slot, signature } where signature is signature_pad's PNG data URL.
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const resolved = await resolve(params);
    if ("error" in resolved) return resolved.error;
    const { actor, id } = resolved;
    const body = await request.json().catch(() => null);
    const view = await agreementView(actor, id);
    if (typeof body?.slot !== "string" || !view.signable.includes(body.slot)) {
      return NextResponse.json(compatibilityFailure("You can't sign this part of the agreement."), { status: 403 });
    }
    const image = parseSignatureImage(body?.signature);
    if (!image) return NextResponse.json(compatibilityFailure("Draw a signature first."), { status: 400 });

    await recordSignatures(prisma, { actor, dealerId: id, slots: [body.slot], image, document: view.blocks, ip: requestIp(request) });
    return NextResponse.json(compatibilitySuccess({ slot: body.slot }, "Signed"));
  } catch (error) {
    console.error("[POST /api/terms/dealers/[dealerId]]", error);
    return NextResponse.json(compatibilityFailure("Could not save the signature"), { status: 500 });
  }
}
