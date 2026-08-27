export type GoogleApiErrorType = "invalid_credentials" | "permission_denied" | "rate_limited" | "transient" | "unknown";

export function classifyGoogleApiError(error: unknown): GoogleApiErrorType {
  const value = error as { code?: number | string; status?: number; response?: { status?: number }; name?: string };
  const rawStatus = value?.status ?? value?.response?.status ?? value?.code;
  const status = typeof rawStatus === "number" ? rawStatus : Number(rawStatus);
  const code = String(value?.code ?? "").toUpperCase();
  const message = String((error as { message?: string })?.message ?? "").toLowerCase();

  if (status === 401 || message.includes("credential") || message.includes("unauthorized")) return "invalid_credentials";
  if (status === 403 || message.includes("permission") || message.includes("forbidden") || message.includes("scope")) {
    return "permission_denied";
  }
  if (status === 429) return "rate_limited";
  if ((Number.isFinite(status) && status >= 500) || ["ETIMEDOUT", "ECONNRESET", "EAI_AGAIN", "ECONNABORTED"].includes(code) || value?.name === "AbortError") {
    return "transient";
  }
  return "unknown";
}

export function isWideQueryUnsupported(error: unknown): boolean {
  const value = error as { code?: number | string; status?: number; response?: { status?: number } };
  const status = Number(value?.status ?? value?.response?.status ?? value?.code);
  const message = String((error as { message?: string })?.message ?? "").toLowerCase();
  return status === 400 && (message.includes("dimension") || message.includes("filter") || message.includes("row") || message.includes("query"));
}
