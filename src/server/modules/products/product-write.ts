import { AdminRouteError } from "@/server/admin/admin-errors";
import type { ProductWriteInput } from "@/server/modules/admin/products/products.types";

function text(value: unknown, max = 1000) { return String(value ?? "").trim().slice(0, max); }
function bool(value: unknown, fallback = true) { return typeof value === "boolean" ? value : fallback; }
function int(value: unknown) { const parsed = Math.trunc(Number(value)); return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined; }
function paise(value: unknown) { const parsed = Number(String(value ?? "").replace(/,/g, "").trim()); return BigInt(Math.round((Number.isFinite(parsed) && parsed > 0 ? parsed : 0) * 100)); }
function rawPaise(value: unknown) { if (typeof value === "bigint") return value; if (typeof value === "string" || typeof value === "number") { const parsed = BigInt(String(value || 0)); return parsed >= BigInt(0) ? parsed : BigInt(0); } return undefined; }

export function parseProductWriteInput(raw: unknown): ProductWriteInput {
  const input = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const name = text(input.name ?? input.product_name, 300);
  if (!name) throw new AdminRouteError("INVALID_REQUEST", "Product name is required");
  const rawVariants = Array.isArray(input.variants) ? input.variants : [input];
  const variants = rawVariants.filter((variant): variant is Record<string, unknown> => Boolean(variant) && typeof variant === "object").map((variant) => {
    const sku = text(variant.sku ?? variant.catalogueNumber ?? variant.product_cat, 160);
    const packSize = int(variant.packSize ?? variant.product_quantity);
    const unitPricePaise = rawPaise(variant.unitPricePaise) ?? paise(variant.unitPrice ?? variant.product_price ?? variant.price);
    const packPricePaise = rawPaise(variant.packPricePaise) ?? unitPricePaise * BigInt(packSize ?? 1);
    return { id: text(variant.id, 40) || undefined, sku, catalogueNumber: text(variant.catalogueNumber ?? variant.product_cat ?? sku, 160), unitName: text(variant.unitName ?? variant.product_unit, 80), packSize, unitPricePaise, packPricePaise, active: bool(variant.active, true) };
  });
  if (!variants.length || variants.every((variant) => !variant.sku && !variant.catalogueNumber)) throw new AdminRouteError("INVALID_REQUEST", "At least one catalogue number is required");
  return { productCode: text(input.productCode ?? input.product_code, 160) || undefined, name, description: text(input.description ?? input.product_discription, 20000), imageUrl: text(input.imageUrl ?? input.product_image, 1000), categoryName: text(input.categoryName ?? input.category ?? input.product_category, 160) || undefined, active: bool(input.active, true), variants };
}
