import "server-only";

import { toolSet, type Tool, type ToolContext } from "../types";
import * as searchProducts from "./searchProducts";
import * as getProductDetails from "./getProductDetails";
import * as getOrders from "./getOrders";
import * as getOrderStatus from "./getOrderStatus";
import * as getLedgerSummary from "./getLedgerSummary";
import * as draftOrder from "./draftOrder";

/** The dealer assistant's tools. */
export const dealerTools = toolSet<ToolContext>([searchProducts, getProductDetails, getOrders, getOrderStatus, getLedgerSummary, draftOrder] as Tool<ToolContext>[]);

// The names the checks and evals use.
export const toolSchemas = dealerTools.schemas;
export const toolHandlers = dealerTools.handlers;
