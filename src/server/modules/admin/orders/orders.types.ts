import type { PostgresOrderRecord } from "@/lib/postgresOrders";

export type AdminOrderListInput = {
  page: number;
  pageSize: number;
  search: string;
  status: string;
  dealerId?: bigint;
  staffId?: bigint;
  dateFrom?: Date;
  dateTo?: Date;
};

// Mirrors what the repository actually fetches, so an underfetch is a type
// error instead of a 500 inside mapPostgresOrderToLegacy.
export type AdminOrderRecord = PostgresOrderRecord;
export type AdminOrderItemRecord = AdminOrderRecord["items"][number];
