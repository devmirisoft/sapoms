import { NextResponse } from "next/server";
import { requireAuth } from "@/server/auth/session";
import { countsFor } from "@/server/modules/pending-counts";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ success: true, counts: await countsFor(await requireAuth()) });
  } catch (error: any) {
    const status = Number(error?.status) || (error?.message === "Unauthenticated" ? 401 : error?.message === "Forbidden" ? 403 : 500);
    return NextResponse.json({ success: false, counts: {}, message: status >= 500 ? "Failed to load counts" : error.message }, { status });
  }
}
