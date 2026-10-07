import { normalizeBusinessCalendarDate } from "@/lib/orderDate.js";

// The homepage "Today's Sale" list. Display only: the percent is a badge, order
// pricing never reads it. Stored as one AppSetting row; live only on saleDate (IST).

export type SaleItem = {
  id: string;
  SKU: string;
  name: string;
  specs: string;
  image: string;
  discountPercent: number;
  active: boolean;
};

export type TodaysSale = { saleDate: string; items: SaleItem[] };

export const MAX_SALE_PERCENT = 90;

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function todayIST(): string {
  return normalizeBusinessCalendarDate(new Date()) ?? "";
}

export function isSaleLive(sale: TodaysSale, today = todayIST()) {
  return sale.items.length > 0 && sale.saleDate === today;
}

// Returns null when the payload is malformed; items without SKU/name are dropped.
export function parseTodaysSale(input: unknown): TodaysSale | null {
  const body = (input && typeof input === "object" ? input : {}) as { saleDate?: unknown; items?: unknown };
  const saleDate = typeof body.saleDate === "string" ? body.saleDate.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(saleDate) || normalizeBusinessCalendarDate(saleDate) !== saleDate) return null;
  if (!Array.isArray(body.items) || body.items.length > 50) return null;

  const items: SaleItem[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of body.items.entries()) {
    const item = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const SKU = text(item.SKU, 120);
    const name = text(item.name, 300);
    if (!SKU || !name || seen.has(SKU.toLowerCase())) continue;
    const discountPercent = Number(item.discountPercent);
    if (!Number.isInteger(discountPercent) || discountPercent < 1 || discountPercent > MAX_SALE_PERCENT) return null;
    seen.add(SKU.toLowerCase());
    items.push({
      id: text(item.id, 80) || `${Date.now()}-${index}`,
      SKU,
      name,
      specs: text(item.specs, 500),
      image: text(item.image, 1000),
      discountPercent,
      active: item.active !== false,
    });
  }
  return { saleDate, items };
}
