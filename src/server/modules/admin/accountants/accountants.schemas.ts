import { z } from "zod";
import { optionalPhoneSchema } from "@/lib/fieldRules";
import { parseAdminPagination } from "@/server/admin/admin-pagination";
import { AdminRouteError } from "@/server/admin/admin-errors";

export { parseAdminPagination as parseAdminAccountantListInput };

const baseSchema = z.object({
  name: z.string().trim().min(1).optional(),
  email: z.string().trim().email().optional(),
  password: z.string().min(6).optional(),
  phone: optionalPhoneSchema,
  designation: z.string().trim().optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "SUSPENDED"]).optional(),
});

export async function parseCreateAdminAccountantInput(request: Request) {
  const parsed = baseSchema.extend({
    name: z.string().trim().min(1),
    email: z.string().trim().email(),
    password: z.string().min(6),
  }).safeParse(await request.json());

  if (!parsed.success) throw new AdminRouteError("INVALID_REQUEST", parsed.error.issues[0]?.message || "Invalid accountant payload");
  return parsed.data;
}

export async function parseUpdateAdminAccountantInput(request: Request) {
  const parsed = baseSchema.safeParse(await request.json());
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    throw new AdminRouteError("INVALID_REQUEST", parsed.error?.issues[0]?.message || "Invalid accountant payload");
  }
  return parsed.data;
}
