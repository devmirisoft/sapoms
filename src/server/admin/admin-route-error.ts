// The error type on its own, with no next/server import, so the schema parsers
// that throw it can be exercised outside the Next runtime.
// admin-errors.ts re-exports both names, so existing importers are unaffected.

export type AdminErrorCode =
  | "INVALID_REQUEST"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INTERNAL_ERROR";

export class AdminRouteError extends Error {
  constructor(
    public readonly code: AdminErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}
