import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db/prisma";
import { cloudinary, uploadImage } from "@/lib/cloudinary";
import { requireAdmin, requestIdFrom } from "@/server/admin/admin-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const CLOUDINARY_FOLDER = "sapoms/slider";

function safeTitle(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim().slice(0, 200) || null : null;
}

function safePosition(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || value.trim() === "") return 0;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toDto(row: { id: bigint; title: string | null; imageUrl: string; position: number; isActive: boolean; createdAt: Date; updatedAt: Date }) {
  return {
    id: row.id.toString(),
    title: row.title,
    imageUrl: row.imageUrl,
    image_url: row.imageUrl,
    position: row.position,
    isActive: row.isActive,
    is_active: row.isActive,
    createdAt: row.createdAt.toISOString(),
    created_at: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}


function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Slider request failed";
  const status = Number((error as { status?: unknown })?.status) || (message === "Unauthenticated" ? 401 : message === "Forbidden" ? 403 : 500);
  return NextResponse.json({ success: false, message }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET() {
  try {
    await requireAdmin();
    const rows = await prisma.sliderImage.findMany({
      orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    });
    return NextResponse.json({ success: true, data: rows.map(toDto) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[GET /api/admin/slider]", error);
    return errorResponse(error);
  }
}
export async function POST(request: NextRequest) {
  let uploadedPublicId: string | null = null;
  try {
    const actor = await requireAdmin();
    const form = await request.formData();
    const file = form.get("image");
    if (!(file instanceof File)) throw Object.assign(new Error("Image file is required"), { status: 400 });

    const uploaded = await uploadImage(file, CLOUDINARY_FOLDER);
    uploadedPublicId = uploaded.public_id;

    const row = await prisma.sliderImage.create({
      data: {
        title: safeTitle(form.get("title")),
        imageUrl: uploaded.secure_url,
        cloudinaryPublicId: uploaded.public_id,
        position: safePosition(form.get("position")),
        isActive: true,
        createdByUserId: actor.userId,
      },
    });

    return NextResponse.json({ success: true, data: toDto(row), requestId: requestIdFrom(request) }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (uploadedPublicId) await cloudinary.uploader.destroy(uploadedPublicId).catch(() => undefined);
    console.error("[POST /api/admin/slider]", error);
    return errorResponse(error);
  }
}