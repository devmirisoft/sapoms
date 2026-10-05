import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, type AuthActor } from "@/server/auth/session";
import { cancelDraft, confirmDraft } from "@/lib/agent/drafts";

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({ draftId: z.uuid(), action: z.enum(["confirm", "cancel"]).default("confirm") });

/** The dealer's Confirm / Cancel on an assistant draft card. The LLM is never involved here. */
export async function POST(request: NextRequest) {
  let actor: AuthActor;
  try { actor = await requireAuth(); } catch { return NextResponse.json({ error: "UNAUTHENTICATED", message: "Please sign in again." }, { status: 401 }); }
  if (actor.role !== "DEALER" || !actor.dealerId) return NextResponse.json({ error: "FORBIDDEN", message: "Only dealers can confirm orders." }, { status: 403 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_REQUEST", message: "A valid draftId is required." }, { status: 400 });

  try {
    const result = parsed.data.action === "cancel"
      ? await cancelDraft(parsed.data.draftId, actor.dealerId)
      : await confirmDraft(parsed.data.draftId, actor.dealerId, { userId: actor.userId, role: actor.role, displayName: actor.displayName, sessionId: actor.sessionId });
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error("[POST /api/agent/confirm]", error);
    return NextResponse.json({ error: "CONFIRM_FAILED", message: "Could not place the order. Nothing was charged; please try again." }, { status: 500 });
  }
}
