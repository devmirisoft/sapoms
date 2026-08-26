import { NextResponse } from "next/server";

/**
 * Maps a thrown error to an HTTP status.
 *
 * `requireAuth()` signals failure by throwing a plain `Error("Unauthenticated")`
 * (and `requireRole()` throws `Error("Forbidden")`), so those are matched by
 * message. Errors carrying an explicit numeric `status` — e.g.
 * `PostgresOrderStatusError`, `PostgresOrderAnnotationError` — take precedence.
 */
export function errorStatus(error: unknown, fallback = 500) {
  const status = Number((error as { status?: unknown })?.status);
  if (Number.isFinite(status) && status >= 400 && status <= 599) return status;

  const message = (error as { message?: unknown })?.message;
  if (message === "Unauthenticated") return 401;
  if (message === "Forbidden") return 403;

  return fallback;
}

/**
 * Builds an error response, mapping auth failures to 401/403 rather than 500.
 *
 * Client-error messages (4xx) are passed through so callers can act on them;
 * 5xx messages are replaced with `fallback` to avoid leaking internals.
 */
export function jsonError(error: unknown, fallback: string, extra?: Record<string, unknown>) {
  const status = errorStatus(error);
  const message = status >= 500 ? fallback : String((error as { message?: unknown })?.message ?? fallback);
  return NextResponse.json({ success: false, ...extra, message }, { status });
}
