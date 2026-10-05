// Coupon code -> extra percent added to the dealer's base discount. Shared so the
// server re-validates the code instead of trusting a client-sent percent.
export const COUPONS: Record<string, number> = {
  "test60": 60,
  "SAVE50": 50,
  "VIP80": 80,
};

export function couponPercent(code: unknown) {
  return COUPONS[String(code ?? "").trim()] ?? 0;
}
