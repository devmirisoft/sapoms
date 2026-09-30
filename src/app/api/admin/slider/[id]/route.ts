import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db/prisma";
import { cloudinary, uploadImage } from "@/lib/cloudinary";
import { parseBigIntRouteParam, requireAdmin } from "@/server/admin/admin-route";

export const runtime = "nodejs";

const CLOUDINARY_FOLDER = "sapoms/slider";

type Params = { params: Promise<{ id: string }> };

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


function formString(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : undefined;
}

export async function PATCH(request: NextRequest, context: Params) {
  let uploadedPublicId: string | null = null;
  try {
    await requireAdmin();
    const { id } = await context.params;
    const sliderId = parseBigIntRouteParam(id, "slider image id");
    const current = await prisma.sliderImage.findUnique({ where: { id: sliderId } });
    if (!current) throw Object.assign(new Error("Slider image not found"), { status: 404 });

    const form = await request.formData();
    const data: { title?: string | null; position?: number; isActive?: boolean; imageUrl?: string; cloudinaryPublicId?: string } = {};
    if (form.has("title")) data.title = formString(form, "title") || null;
    if (form.has("position")) {
      const position = Number.parseInt(formString(form, "position") ?? "", 10);
      if (!Number.isFinite(position)) throw Object.assign(new Error("Invalid position"), { status: 400 });
      data.position = position;
    }
    if (form.has("isActive")) data.isActive = formString(form, "isActive") !== "false";

    const file = form.get("image");
    if (file instanceof File && file.size > 0) {
      const uploaded = await uploadImage(file, CLOUDINARY_FOLDER);
      uploadedPublicId = uploaded.public_id;
      data.imageUrl = uploaded.secure_url;
      data.cloudinaryPublicId = uploaded.public_id;
    }

    const updated = await prisma.sliderImage.update({ where: { id: sliderId }, data });
    if (uploadedPublicId) {
      await cloudinary.uploader.destroy(current.cloudinaryPublicId).catch((error) => console.error("[slider old cloudinary destroy]", error));
      uploadedPublicId = null;
    }

    return NextResponse.json({ success: true, data: toDto(updated) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (uploadedPublicId) await cloudinary.uploader.destroy(uploadedPublicId).catch(() => undefined);
    console.error("[PATCH /api/admin/slider/[id]]", error);
    return errorResponse(error);
  }
}

export async function DELETE(_request: NextRequest, context: Params) {
  try {
    await requireAdmin();
    const { id } = await context.params;
    const sliderId = parseBigIntRouteParam(id, "slider image id");
    const current = await prisma.sliderImage.findUnique({ where: { id: sliderId } });
    if (!current) throw Object.assign(new Error("Slider image not found"), { status: 404 });

    await prisma.sliderImage.delete({ where: { id: sliderId } });
    await cloudinary.uploader.destroy(current.cloudinaryPublicId).catch((error) => console.error("[slider cloudinary destroy]", error));

    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[DELETE /api/admin/slider/[id]]", error);
    return errorResponse(error);
  }
}