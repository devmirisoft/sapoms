import "server-only";

import { isStaffLike } from "@/server/auth/sales-scope";
import { toolSet, type Tool, type ToolSet } from "../types";
import type { InternalScope } from "../internalScope";
import * as searchProducts from "../tools/searchProducts";
import * as getProductDetails from "../tools/getProductDetails";
import { findDealers, getDealerSummary } from "./dealers";
import { findOrders, getOrder, pendingApprovals } from "./orders";
import { outstandingReport, productSalesReport, salesReport, salesTarget } from "./reports";

// Product tools are shared with dealers; without a dealer they quote list prices.
const productDetailsAtListPrice: Tool<InternalScope> = { ...getProductDetails, handler: (args) => getProductDetails.handler(args, {}) };

/** Read-only tools for internal users. Every handler scopes itself with the session's InternalScope. */
export function internalTools(scope: InternalScope): ToolSet<InternalScope> {
  return toolSet<InternalScope>([
    findDealers, getDealerSummary,
    findOrders, getOrder, pendingApprovals,
    salesReport, outstandingReport, productSalesReport,
    searchProducts as Tool<InternalScope>, productDetailsAtListPrice,
    ...(isStaffLike(scope.actor) && scope.actor.staffId ? [salesTarget] : []),
  ]);
}
