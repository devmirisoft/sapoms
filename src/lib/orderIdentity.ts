import type { Prisma } from "@prisma/client";
import { financialYearLabel } from "@/lib/orderDisplay";

/**
 * The id and number for a new order. The number is built from the id
 * (OM/26-27/DMS-2250), the number staff and dealers know an order by, so the two can
 * never drift apart. The id is reserved here and passed to order.create.
 */
export async function nextOrderIdentity(tx: Prisma.TransactionClient, now = new Date()) {
  const [{ id }] = await tx.$queryRaw<Array<{ id: bigint }>>`SELECT nextval(pg_get_serial_sequence('orders', 'id')) AS id`;
  return { id, orderNumber: `OM/${financialYearLabel(now)}/DMS-${id.toString().padStart(3, "0")}` };
}
