export const PRODUCT_NOTE_LIMIT: number;

export function normalizeSku(value: unknown): string;
export function normalizeProductNote(value: unknown, max?: number): string;
export function isExpectedOrderNumber(value: unknown): boolean;
export function buildOrderRemarks(priorityRemarks: string, orderNote: string): string;
export function getCombinedRemarkText(row: unknown): string;
export function remarksContainProductNote(remarks: unknown, note: unknown): boolean;
export function resolveNormalizedSku(row: unknown): string;
export function normalizeOrderItemId(value: unknown): string | null;
export function resolveOrderId(row: unknown): string;
export function buildMatchedOrderRows(
  submittedRows: Array<Record<string, unknown>>,
  phpRows: Array<Record<string, unknown>>
): Array<{
  submittedRow: Record<string, unknown>;
  phpRow: Record<string, unknown> | null;
  normalizedSku: string;
  occurrence: number;
}>;
export function normalizePhpOrderItems(payload: unknown, fallbackOrderId?: string): Array<Record<string, unknown>>;
export function buildFallbackLookupKey(orderId: string, normalizedSku: string, occurrence: number): string;
export function extractLegacyProductNote(value: unknown): string;
export function buildInvoiceProductName(productName: string, productNote: string): string;
export function buildInvoiceDescriptionMeta(input: {
  productName?: unknown;
  catalogueNumber?: unknown;
  productNote?: unknown;
  isPriority?: boolean;
}): { mainText: string; noteText: string };
export function mergeFallbackProductNotes<T extends Record<string, unknown>>(
  items: T[],
  fallbackNotes: Array<Record<string, unknown>>
): Array<T & { fallbackProductNote: string; displayRemark: string }>;
export function mergeProductNotesIntoInvoiceItems<T extends Record<string, unknown>>(
  items: T[],
  fallbackNotes: Array<Record<string, unknown>>
): Array<T & { productNote: string }>;
export function resolveDisplayRemark(input: { remark?: unknown; remarks?: unknown; fallbackNote?: unknown }): string;
export function verifyOrderProductNotesPersistence(input: {
  fetchImpl: typeof fetch;
  backendUrl: string;
  actualOrderId: string;
  dealerId: string;
  submittedRows: Array<Record<string, unknown>>;
  fallbackApiPath?: string;
  maxAttempts?: number;
}): Promise<{ verifiedInPhp: number; savedToFallback: number; failed: number }>;
