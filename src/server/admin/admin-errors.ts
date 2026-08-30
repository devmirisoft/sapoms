import { NextResponse } from "next/server";

export type AdminErrorCode =
  | "INVALID_REQUEST"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INTERNAL_ERROR";

const STATUS_BY_CODE: Record<AdminErrorCode, number> = {
  INVALID_REQUEST: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_ERROR: 500,
};

export class AdminRouteError extends Error {
  constructor(
    public readonly code: AdminErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function adminErrorResponse(error: unknown, fallbackMessage = "Admin request failed") {
  let code: AdminErrorCode = "INTERNAL_ERROR";
  let message = fallbackMessage;

  if (error instanceof AdminRouteError) {
    code = error.code;
    message = error.message;
  } else if (error instanceof Error && error.message === "Unauthenticated") {
    code = "UNAUTHENTICATED";
    message = "Unauthenticated";
  } else if (error instanceof Error && error.message === "Forbidden") {
    code = "FORBIDDEN";
    message = "Forbidden";
  }

  return NextResponse.json(
    {
      status: false,
      success: false,
      msg: message,
      message,
      error: {
        code,
        ...((error instanceof AdminRouteError && error.details) ? error.details : {}),
        // Unmapped failures reach the client as a generic message; in dev, carry the
        // real one so the browser console is enough to debug without the server log.
        ...(process.env.NODE_ENV !== "production" && !(error instanceof AdminRouteError)
          ? { detail: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }
          : {}),
      },
    },
    {
      status: STATUS_BY_CODE[code],
      headers: { "Cache-Control": "no-store" },
    },
  );
}