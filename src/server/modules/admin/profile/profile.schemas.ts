import { AdminRouteError } from "@/server/admin/admin-errors";
import { PHONE_ERROR, normalizePhone } from "@/lib/fieldRules";
import type { AdminProfileUpdateInput } from "./profile.types";

function optionalText(value: unknown, max: number, label: string) {
  if (value === undefined) return undefined;
  if (value === null) return "";
  if (typeof value !== "string") throw new AdminRouteError("INVALID_REQUEST", `${label} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new AdminRouteError("INVALID_REQUEST", `${label} is too long`);
  return trimmed;
}

export function parseAdminProfileUpdate(body: unknown): AdminProfileUpdateInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AdminRouteError("INVALID_REQUEST", "JSON body is required");
  }
  const input = body as Record<string, unknown>;
  const parsed: AdminProfileUpdateInput = {
    name: optionalText(input.name ?? input.ADMIN_NAME, 200, "name"),
    email: optionalText(input.email ?? input.ADMIN_EMAIL, 254, "email"),
    phone: optionalText(input.phone ?? input.ADMIN_PHONE, 40, "phone"),
    imageUrl: optionalText(input.imageUrl ?? input.ADMIN_IMAGE, 1000, "imageUrl"),
    currentPassword: optionalText(input.currentPassword, 500, "currentPassword"),
    newPassword: optionalText(input.newPassword, 500, "newPassword"),
  };

  if (parsed.email && !/^\S+@\S+\.\S+$/.test(parsed.email)) {
    throw new AdminRouteError("INVALID_REQUEST", "email is invalid");
  }
  if (parsed.phone) {
    parsed.phone = normalizePhone(parsed.phone);
    if (parsed.phone.length !== 10) throw new AdminRouteError("INVALID_REQUEST", PHONE_ERROR);
  }
  if (parsed.newPassword && parsed.newPassword.length < 8) {
    throw new AdminRouteError("INVALID_REQUEST", "newPassword must be at least 8 characters");
  }
  if (parsed.newPassword && !parsed.currentPassword) {
    throw new AdminRouteError("INVALID_REQUEST", "currentPassword is required to update password");
  }

  return parsed;
}