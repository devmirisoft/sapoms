// Keeps secrets out of the audit table and keeps the JSON columns small.
//
// This runs on values that come straight off request bodies and Prisma rows, so
// it has to assume a caller will eventually hand it a whole user record. The
// redaction is key-name based and applied at every depth, including inside
// arrays: missing one is a credential written to a table admins can read.

export const REDACTED = "[redacted]";

// Matches the field names SAPOMS actually stores secrets under (User.passwordHash,
// AuthSession.refreshTokenHash, DiagnosticPassword, EmailOtp.codeHash) plus the
// usual suspects. Substring match, case-insensitive, so passwordUpdatedAt is hit
// too — losing a harmless timestamp beats leaking a hash.
const SENSITIVE_KEY =
  /pass(word)?|token|secret|api[-_ ]?key|credential|otp|hash|authorization|auth[-_ ]?header|cookie|session[-_ ]?id|private[-_ ]?key|salt|pepper|pin\b|cvv/i;

const MAX_DEPTH = 6;
const MAX_ARRAY = 50;
const MAX_KEYS = 80;
const MAX_STRING = 2000;

export function isSensitiveKey(key: string) {
  return SENSITIVE_KEY.test(key);
}

function primitive(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  // Prisma.Decimal and anything else object-like with a sane toString.
  return String(value);
}

function walk(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return null;

  if (typeof value !== "object") return primitive(value);
  if (value instanceof Date || typeof value === "bigint") return primitive(value);

  if (depth >= MAX_DEPTH) return "[truncated]";

  // Prisma rows with relations can be cyclic; a stack overflow here would take
  // down the request the audit entry was only meant to describe.
  if (seen.has(value as object)) return "[circular]";
  seen.add(value as object);

  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY).map((item) => walk(item, depth + 1, seen));
    if (value.length > MAX_ARRAY) items.push(`…${value.length - MAX_ARRAY} more`);
    return items;
  }

  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(source).slice(0, MAX_KEYS)) {
    out[key] = isSensitiveKey(key) ? REDACTED : walk(source[key], depth + 1, seen);
  }
  return out;
}

/**
 * Makes an arbitrary value safe to persist in a Json column: secrets redacted,
 * BigInt/Date/Decimal JSON-encodable, depth and size bounded.
 */
export function sanitizeAuditValues(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  const walked = walk(value, 0, new WeakSet());
  if (walked === null || typeof walked !== "object" || Array.isArray(walked)) {
    return { value: walked };
  }
  return Object.keys(walked).length === 0 ? null : (walked as Record<string, unknown>);
}

function comparable(value: unknown) {
  const normalized = walk(value, 0, new WeakSet());
  return typeof normalized === "object" && normalized !== null
    ? JSON.stringify(normalized)
    : normalized;
}

export type ValueDiff = {
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
};

/**
 * Reduces a before/after pair to only the fields that actually changed, so an
 * update stores `{status: PENDING} -> {status: APPROVED}` instead of two copies
 * of the whole row. Keys present in only one side count as changed.
 */
export function diffValues(before: unknown, after: unknown): ValueDiff {
  const a = (before ?? {}) as Record<string, unknown>;
  const b = (after ?? {}) as Record<string, unknown>;

  if (typeof a !== "object" || typeof b !== "object" || Array.isArray(a) || Array.isArray(b)) {
    return { oldValues: sanitizeAuditValues(before), newValues: sanitizeAuditValues(after) };
  }

  const oldValues: Record<string, unknown> = {};
  const newValues: Record<string, unknown> = {};

  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (comparable(a[key]) === comparable(b[key])) continue;
    // Both sides are emitted even when one is absent, so the drawer can render
    // "— → value" rather than silently dropping the field.
    oldValues[key] = isSensitiveKey(key) ? REDACTED : walk(a[key], 1, new WeakSet());
    newValues[key] = isSensitiveKey(key) ? REDACTED : walk(b[key], 1, new WeakSet());
  }

  return {
    oldValues: Object.keys(oldValues).length ? oldValues : null,
    newValues: Object.keys(newValues).length ? newValues : null,
  };
}
