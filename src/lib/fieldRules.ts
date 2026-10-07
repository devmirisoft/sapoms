import { z } from "zod";

export const PHONE_ERROR = "Phone number must be exactly 10 digits";

/** Digits only, with a leading +91 / 0 dropped when that leaves exactly 10 digits. */
export function normalizePhone(value: unknown) {
  return String(value ?? "").replace(/\D/g, "").replace(/^(?:91|0)(?=\d{10}$)/, "");
}

export const isValidPhone = (value: unknown) => /^\d{10}$/.test(normalizePhone(value));

/** onChange sanitizer for phone inputs: digits only, capped at 10. */
export const phoneInput = (value: string) => normalizePhone(value).slice(0, 10);

/** Spread onto a phone <input> so the browser blocks submit unless it holds 10 digits. */
export const phoneInputProps = {
  type: "tel",
  inputMode: "numeric",
  pattern: "\\d{10}",
  maxLength: 10,
  title: PHONE_ERROR,
} as const;

/** onChange sanitizer for % inputs: above 100 snaps to 100, negatives to 0. */
export const clampPercentInput = (value: string) => (Number(value) > 100 ? "100" : Number(value) < 0 ? "0" : value);

/** Optional on the wire; when present it is normalized and must be 10 digits. "" clears it. */
export const optionalPhoneSchema = z.preprocess(
  (value) => (value === undefined || value === null ? undefined : String(value).trim() === "" ? "" : normalizePhone(value)),
  z.union([z.literal(""), z.string().regex(/^\d{10}$/, PHONE_ERROR)]).optional(),
);

export const requiredPhoneSchema = z.preprocess(normalizePhone, z.string().regex(/^\d{10}$/, PHONE_ERROR));
