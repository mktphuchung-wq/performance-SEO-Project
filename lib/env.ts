function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function getGoogleClientId(): string {
  return required("GOOGLE_CLIENT_ID");
}

export function getGoogleClientSecret(): string {
  return required("GOOGLE_CLIENT_SECRET");
}

export function getAdminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function getGoogleSheetId(): string {
  return required("GOOGLE_SHEET_ID");
}

export function getGoogleSheetTab(): string {
  return process.env.GOOGLE_SHEET_TAB || "content_urls";
}

export function getDatabaseUrl(): string {
  return required("DATABASE_URL");
}

function positiveInteger(name: string, fallback: number, maximum = Number.MAX_SAFE_INTEGER): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? Math.min(value, maximum) : fallback;
}

export function getSyncGscConcurrency(): number {
  return positiveInteger("SYNC_GSC_CONCURRENCY", 4, 16);
}

export function isSyncGscWideQueryEnabled(): boolean {
  return process.env.SYNC_GSC_WIDE_QUERY?.toLowerCase() !== "false";
}

export function getSyncBulkChunkSize(): number {
  return positiveInteger("SYNC_BULK_CHUNK_SIZE", 500, 1000);
}

export function getSyncStaleRunMinutes(): number {
  return positiveInteger("SYNC_STALE_RUN_MINUTES", 15, 1440);
}

export function getSyncDateFormatHint(): "dmy" | "mdy" {
  return process.env.SYNC_DATE_FORMAT_HINT?.toLowerCase() === "mdy" ? "mdy" : "dmy";
}
