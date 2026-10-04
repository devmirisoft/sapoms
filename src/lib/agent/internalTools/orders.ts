import "server-only";

import { z } from "zod";
import { countsFor } from "@/server/modules/pending-counts";
import type { Tool } from "../types";
import type { InternalScope } from "../internalScope";
import { findOrderDetails, listOrders, ORDER_STATUS_FILTERS, ORDER_STATUS_WHERE, orderFilters, type OrderStatusFilter } from "../orders";
import { resolveDealer } from "./dealers";

export const findOrders: Tool<InternalScope> = {
  schema: {
    type: "function",
    function: {
      name: "find_orders",
      description: "Orders you can access, newest first. Optional status, dealer and date range (YYYY-MM-DD, India time).",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", enum: [...ORDER_STATUS_FILTERS] },
          dealer: { type: "string", description: "Dealer name, code or id" },
          fromDate: { type: "string", description: "YYYY-MM-DD" },
          toDate: { type: "string", description: "YYYY-MM-DD, inclusive" },
          limit: { type: "integer", minimum: 1, maximum: 10 },
        },
      },
    },
  },
  argsSchema: z.object({
    status: z.enum(ORDER_STATUS_FILTERS).optional(),
    dealer: z.string().trim().min(1).max(120).optional(),
    fromDate: z.iso.date().optional(),
    toDate: z.iso.date().optional(),
    limit: z.number().int().min(1).max(10).optional(),
  }),
  async handler(args: { status?: OrderStatusFilter; dealer?: string; fromDate?: string; toDate?: string; limit?: number }, scope) {
    let dealerId: bigint | undefined;
    if (args.dealer) {
      const found = await resolveDealer(scope, args.dealer);
      if ("error" in found) return found;
      dealerId = found.dealerId;
    }
    return listOrders({ AND: [scope.orderWhere, orderFilters(args), ...(dealerId ? [{ dealerId }] : [])] }, args.limit ?? 10, true);
  },
};

export const getOrder: Tool<InternalScope> = {
  schema: {
    type: "function",
    function: {
      name: "get_order",
      description: "One order you can access: dealer, approval stage (RSM / staff), items, dispatch and tracking. Accepts OM/26-27/DMS-029, DMS-029 or 29.",
      parameters: { type: "object", properties: { orderId: { type: "string" } }, required: ["orderId"] },
    },
  },
  argsSchema: z.object({ orderId: z.string().trim().min(1).max(60) }),
  async handler(args: { orderId: string }, scope) {
    return findOrderDetails(scope.orderWhere, args.orderId, true);
  },
};

const PENDING_LABELS: Record<string, string> = {
  pendingOrders: "Orders awaiting approval",
  discountRequests: "Custom discount requests waiting for you",
  fundRequests: "Fund requests at your stage",
  dealerRequests: "New dealer requests",
  settlements: "Open wallet settlements",
};

export const pendingApprovals: Tool<InternalScope> = {
  schema: {
    type: "function",
    function: {
      name: "pending_approvals",
      description: "What is waiting on you: the same counts as your sidebar badges, plus the oldest orders awaiting approval.",
      parameters: { type: "object", properties: {} },
    },
  },
  argsSchema: z.object({}),
  async handler(_args: Record<string, never>, scope) {
    const [counts, oldest] = await Promise.all([
      countsFor(scope.actor),
      listOrders({ AND: [scope.orderWhere, ORDER_STATUS_WHERE.awaiting_approval] }, 5, true, "asc"),
    ]);
    return {
      pending: Object.entries(counts).map(([key, count]) => ({ item: PENDING_LABELS[key] ?? key, count })),
      oldestAwaitingOrders: oldest.orders,
      note: "Approve or decline these in the app (Orders, Discount requests, Fund requests, Dealer requests); the assistant is read-only.",
    };
  },
};
