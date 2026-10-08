import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { isSaleLive, parseTodaysSale, todayIST, type TodaysSale } from "@/lib/todaysSale";

export const TODAYS_SALE_KEY = "todays_sale";

type Db = Pick<Prisma.TransactionClient, "appSetting">;

export async function readTodaysSale(db: Db = prisma): Promise<TodaysSale> {
  const row = await db.appSetting.findUnique({ where: { key: TODAYS_SALE_KEY } });
  return (row ? parseTodaysSale(row.value) : null) ?? { saleDate: todayIST(), items: [] };
}

/** Lowercase SKU -> percent for active items, empty unless the sale is live today. */
export async function liveSalePercents(db: Db = prisma): Promise<Map<string, number>> {
  const sale = await readTodaysSale(db);
  if (!isSaleLive(sale)) return new Map();
  return new Map(sale.items.filter((item) => item.active).map((item) => [item.SKU.toLowerCase(), item.discountPercent]));
}
