import { NextResponse } from "next/server";

type DatabaseError = Error & { code?: string };

export class ApiRouteError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiRouteError";
  }
}

function requestId(): string {
  return crypto.randomUUID();
}

function isDatabaseUnavailable(error: DatabaseError): boolean {
  const code = error.code ?? "";
  return (
    ["ENOTFOUND", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EHOSTUNREACH", "57P01", "57P02", "57P03"].includes(code) ||
    /^08\d{3}$/.test(code)
  );
}

export function jsonError(status: number, code: string, message: string, id = requestId()) {
  return NextResponse.json(
    { error: message, code, requestId: id },
    { status, headers: { "x-request-id": id } },
  );
}

/**
 * Converts a Route Handler failure into the JSON contract used by dashboard
 * readers. The log retains diagnostic data; the client only receives a safe
 * message and a request ID for matching its error to the server log.
 */
export async function runJson<T>(route: string, handler: () => Promise<T>): Promise<NextResponse<T | Record<string, string>>> {
  const startedAt = Date.now();
  try {
    return NextResponse.json(await handler());
  } catch (unknownError) {
    const error: DatabaseError = unknownError instanceof Error ? unknownError : new Error("Unknown route failure");
    const id = requestId();
    const expected = error instanceof ApiRouteError;
    const status = expected ? error.status : isDatabaseUnavailable(error) ? 503 : 500;
    const code = expected ? error.code : status === 503 ? "DB_UNAVAILABLE" : "INTERNAL_ERROR";
    const message = expected
      ? error.message
      : status === 503
        ? "Data service is temporarily unavailable. Please try again."
        : "Could not load data. Please try again.";

    console.error("API request failed", {
      requestId: id,
      route,
      status,
      code,
      errorName: error.name,
      databaseCode: error.code,
      durationMs: Date.now() - startedAt,
    });

    return jsonError(status, code, message, id);
  }
}
