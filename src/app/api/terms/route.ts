import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db/prisma";
import { requireRole, writeAuthAuditLog } from "@/server/auth/session";
import { compatibilityFailure, compatibilitySuccess } from "@/server/http/compat-response";
import { requestIp } from "@/server/http/request-meta";
import { isTermsUpdatedSinceAccepted } from "@/server/terms-content";
import { agreementView, parseSignatureImage, recordSignatures } from "@/server/terms-signatures";

export async function GET() {
  try {
    const actor = await requireRole("DEALER");
    const [profile, view] = await Promise.all([
      prisma.dealerProfile.findUnique({ where: { id: actor.dealerId! }, select: { termsAcceptedAt: true, termsActive: true } }),
      // This dealer's own document, or the global template, with their values and signatures.
      agreementView(actor, actor.dealerId!),
    ]);
    // Admin switched this dealer's document off: nothing to show or accept.
    const active = profile?.termsActive !== false;

    return NextResponse.json(
      compatibilitySuccess({
        active,
        accepted: Boolean(profile?.termsAcceptedAt),
        acceptedAt: profile?.termsAcceptedAt?.toISOString() ?? null,
        blocks: active ? view.blocks : [],
        signatures: active ? view.signatures : {},
        signable: active ? view.signable : [],
        updatedAt: view.updatedAt?.toISOString() ?? null,
        updatedSinceAccepted: active && isTermsUpdatedSinceAccepted(view.updatedAt, profile?.termsAcceptedAt),
      }),
    );
  } catch (error) {
    // Logged because every failure, not just a missing session, comes back as 401 here.
    console.error("[/api/terms]", error);
    return NextResponse.json(compatibilityFailure("Unauthenticated"), { status: 401 });
  }
}

// Accepting signs every open dealer slot in the document, so a document with one needs a drawn signature.
export async function POST(request: NextRequest) {
  try {
    const actor = await requireRole("DEALER");
    const acceptedAt = new Date();
    const body = await request.json().catch(() => null);
    const view = await agreementView(actor, actor.dealerId!);
    const image = parseSignatureImage(body?.signature);
    if (view.signable.length && !image) {
      return NextResponse.json(compatibilityFailure("Please sign the agreement before accepting."), { status: 400 });
    }

    await prisma.$transaction(async (tx) => {
      if (view.signable.length && image) {
        await recordSignatures(tx, { actor, dealerId: actor.dealerId!, slots: view.signable, image, document: view.blocks, ip: requestIp(request) });
      }
      await tx.dealerProfile.update({
        where: { id: actor.dealerId! },
        data: { termsAcceptedAt: acceptedAt },
      });
    });

    await writeAuthAuditLog({
      sessionId: actor.sessionId,
      userId: actor.userId,
      role: actor.role,
      eventType: "TERMS_ACCEPTED",
      metadata: {
        dealerId: actor.dealerId?.toString(),
        acceptedAt: acceptedAt.toISOString(),
      },
    });

    return NextResponse.json(
      compatibilitySuccess({
        accepted: true,
        acceptedAt: acceptedAt.toISOString(),
      }),
    );
  } catch (error) {
    // Logged because every failure, not just a missing session, comes back as 401 here.
    console.error("[/api/terms]", error);
    return NextResponse.json(compatibilityFailure("Unauthenticated"), { status: 401 });
  }
}
