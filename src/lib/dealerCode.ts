export const MIN_DEALER_CODE = 1000;
export const MAX_DEALER_CODE = 9999;
export const DEALER_CODE_WIDTH = 4;
export const RESERVED_DEALER_REQUEST_STATUSES = ["pending", "rsm_pending"] as const;

export function normalizeDealerCode(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

export function isFourDigitDealerCode(value: unknown) {
  return /^\d{4}$/.test(normalizeDealerCode(value));
}

export function parseFourDigitDealerCode(value: unknown) {
  const code = normalizeDealerCode(value);
  return isFourDigitDealerCode(code) ? Number(code) : null;
}

export function collectDealerCodes(rows: unknown[]) {
  return new Set(
    rows
      .map((row) => {
        const source = row && typeof row === "object" ? row as Record<string, unknown> : {};
        const snapshot = source.formSnapshot && typeof source.formSnapshot === "object"
          ? source.formSnapshot as Record<string, unknown>
          : {};

        return normalizeDealerCode(source.Dealer_Dealercode ?? source.dealerCode ?? snapshot.dealerCode);
      })
      .filter(Boolean),
  );
}

export function generateUniqueFourDigitDealerCode(
  existingCodes: Iterable<unknown>,
  random = Math.random,
) {
  void random;
  return generateNextFourDigitDealerCode(existingCodes);
}

export function generateNextFourDigitDealerCode(existingCodes: Iterable<unknown>) {
  let highest: number | null = null;

  for (const value of existingCodes) {
    const numeric = parseFourDigitDealerCode(value);
    if (numeric === null) continue;
    highest = highest === null ? numeric : Math.max(highest, numeric);
  }

  const next = highest === null ? MIN_DEALER_CODE : highest + 1;
  if (next > MAX_DEALER_CODE) return "";
  return String(next).padStart(DEALER_CODE_WIDTH, "0");
}
