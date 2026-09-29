import { NextRequest, NextResponse } from "next/server";
import { adminDetailResponse, adminMutationResponse } from "@/server/admin/admin-response";
import { AdminRouteError, adminErrorResponse } from "@/server/admin/admin-errors";
import { cloudinary, uploadImage } from "@/lib/cloudinary";
import { auditAdminAction, requireAdmin, requestIdFrom } from "@/server/admin/admin-route";
import { getAdminProfile, updateAdminProfile } from "@/server/modules/admin/profile/profile.service";
import { parseAdminProfileUpdate } from "@/server/modules/admin/profile/profile.schemas";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireAdmin();
    const requestId = requestIdFrom(request);
    const data = await getAdminProfile(actor);
    await auditAdminAction({ actor, request, eventType: "ADMIN_PROFILE_VIEWED", route: "/api/admin/profile", requestId });
    return NextResponse.json(adminDetailResponse(data), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[GET /api/admin/profile]", error);
    return adminErrorResponse(error, "Admin profile is unavailable");
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const actor = await requireAdmin();
    const requestId = requestIdFrom(request);
    const input = parseAdminProfileUpdate(await request.json());
    const data = await updateAdminProfile(actor, input, { requestId });
    return NextResponse.json(adminMutationResponse("Admin profile updated", data), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[PATCH /api/admin/profile]", error);
    return adminErrorResponse(error, "Admin profile could not be updated");
  }
}

// Multipart upload of the profile image; stores the Cloudinary URL on the admin profile.
export async function POST(request: NextRequest) {
  let uploadedPublicId: string | null = null;
  try {
    const actor = await requireAdmin();
    const file = (await request.formData()).get("image");
    if (!(file instanceof File)) throw new AdminRouteError("INVALID_REQUEST", "Image file is required");
    const uploaded = await uploadImage(file, "sapoms/profile").catch((error) => {
      throw error?.status === 400 ? new AdminRouteError("INVALID_REQUEST", error.message) : error;
    });
    uploadedPublicId = uploaded.public_id;
    // ponytail: previous image stays in Cloudinary; store its public id if orphan cleanup matters.
    const data = await updateAdminProfile(actor, { imageUrl: uploaded.secure_url }, { requestId: requestIdFrom(request) });
    return NextResponse.json(adminMutationResponse("Profile image updated", data), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (uploadedPublicId) await cloudinary.uploader.destroy(uploadedPublicId).catch(() => undefined);
    console.error("[POST /api/admin/profile]", error);
    return adminErrorResponse(error, "Profile image could not be updated");
  }
}
