import { NextResponse } from "next/server";
import { prisma } from "@/server/db/prisma";
import { requireRole, writeAuthAuditLog } from "@/server/auth/session";
import { compatibilityFailure, compatibilitySuccess } from "@/server/http/compat-response";
import { fillDealerFields, getDealerTerms, isTermsUpdatedSinceAccepted } from "@/server/terms-content";

export async function GET() {
  try {
    const actor = await requireRole("DEALER");
    const [profile, terms] = await Promise.all([
      prisma.dealerProfile.findUnique({ where: { id: actor.dealerId! }, select: { termsAcceptedAt: true, termsActive: true } }),
      // This dealer's own document, or the global template.
      getDealerTerms(actor.dealerId!),
    ]);
    // Admin switched this dealer's document off: nothing to show or accept.
    const active = profile?.termsActive !== false;

    return NextResponse.json(
      compatibilitySuccess({
        active,
        accepted: Boolean(profile?.termsAcceptedAt),
        acceptedAt: profile?.termsAcceptedAt?.toISOString() ?? null,
        blocks: active ? await fillDealerFields(terms.blocks, actor.dealerId!) : [],
        updatedAt: terms.updatedAt?.toISOString() ?? null,
        updatedSinceAccepted: active && isTermsUpdatedSinceAccepted(terms.updatedAt, profile?.termsAcceptedAt),
      }),
    );
  } catch {
    return NextResponse.json(compatibilityFailure("Unauthenticated"), { status: 401 });
  }
}

export async function POST() {
  try {
    const actor = await requireRole("DEALER");
    const acceptedAt = new Date();

    await prisma.dealerProfile.update({
      where: { id: actor.dealerId! },
      data: { termsAcceptedAt: acceptedAt },
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
  } catch {
    return NextResponse.json(compatibilityFailure("Unauthenticated"), { status: 401 });
  }
}
