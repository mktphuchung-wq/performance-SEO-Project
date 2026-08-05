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
