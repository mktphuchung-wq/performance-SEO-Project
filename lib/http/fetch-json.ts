export interface ApiErrorBody {
  error?: string;
  code?: string;
  requestId?: string;
}

export class FetchJsonError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status?: number,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = "FetchJsonError";
  }
}

function isJsonContentType(value: string | null): boolean {
  return value?.split(";", 1)[0]?.trim().toLowerCase().endsWith("+json") || value?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Reads an API body once and keeps HTTP errors distinct from malformed bodies. */
export async function fetchJson<T>(url: string, init: RequestInit = {}, validate?: (value: unknown) => value is T): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new FetchJsonError("Could not reach the data service. Please try again.", "NETWORK_ERROR");
  }

  const text = await response.text();
  const requestId = response.headers.get("x-request-id") ?? undefined;
  if (!text.trim()) {
    throw new FetchJsonError(
      `The data service returned an empty response (${response.status}).`,
      "EMPTY_RESPONSE",
      response.status,
      requestId,
    );
  }

  if (!isJsonContentType(response.headers.get("content-type"))) {
    throw new FetchJsonError(
      `The data service returned an unexpected response (${response.status}).`,
      "NON_JSON_RESPONSE",
      response.status,
      requestId,
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new FetchJsonError(
      `The data service returned invalid JSON (${response.status}).`,
      "INVALID_JSON",
      response.status,
      requestId,
    );
  }

  const body = object(payload);
  if (!response.ok) {
    const error = body as ApiErrorBody | null;
    throw new FetchJsonError(
      error?.error ?? `Could not load data (${response.status}).`,
      error?.code ?? "HTTP_ERROR",
      response.status,
      error?.requestId ?? requestId,
    );
  }

  if (!body || (validate && !validate(payload))) {
    throw new FetchJsonError("The data service returned an invalid response.", "INVALID_RESPONSE", response.status, requestId);
  }

  return payload as T;
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Could not load data. Please try again.";
}
