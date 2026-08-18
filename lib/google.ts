import { google } from "googleapis";
import { getGoogleSheetId, getGoogleSheetTab } from "./env";

function authClient(accessToken: string) {
  const oauth2 = new google.auth.OAuth2();
  oauth2.setCredentials({ access_token: accessToken });
  return oauth2;
}

export async function fetchContentUrlSheetRows(accessToken: string): Promise<string[][]> {
  const sheets = google.sheets({ version: "v4", auth: authClient(accessToken) });
  const spreadsheetId = getGoogleSheetId();
  const tab = getGoogleSheetTab();

  const result = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${tab}!A:Z`,
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });

  return (result.data.values ?? []) as string[][];
}

export interface GscSite {
  siteUrl: string;
  permissionLevel: string;
}

/**
 * The exact property strings the signed-in account can read. Admins must pick
 * from these rather than typing one — a domain property (`sc-domain:x.com`)
 * and a URL-prefix property (`https://x.com/`) are different sites to the API,
 * and a near-miss only shows up later as a permission_denied on every refresh.
 */
export async function listGscSites(accessToken: string): Promise<GscSite[]> {
  const webmasters = google.webmasters({ version: "v3", auth: authClient(accessToken) });
  const response = await webmasters.sites.list({});

  return (response.data.siteEntry ?? [])
    .filter((entry) => Boolean(entry.siteUrl))
    .map((entry) => ({
      siteUrl: entry.siteUrl as string,
      permissionLevel: entry.permissionLevel ?? "unknown",
    }))
    .sort((a, b) => a.siteUrl.localeCompare(b.siteUrl));
}

export interface SearchAnalyticsRow {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export type GoogleApiErrorType = "invalid_credentials" | "permission_denied" | "unknown";

export function classifyGoogleApiError(error: unknown): GoogleApiErrorType {
  const status = (error as { code?: number; status?: number })?.code ?? (error as { status?: number })?.status;
  const message = String((error as { message?: string })?.message ?? "").toLowerCase();

  if (status === 401 || message.includes("credential") || message.includes("unauthorized")) {
    return "invalid_credentials";
  }
  if (status === 403 || message.includes("permission") || message.includes("forbidden") || message.includes("scope")) {
    return "permission_denied";
  }
  return "unknown";
}

export async function queryUrlSearchAnalytics(
  accessToken: string,
  siteUrl: string,
  pageUrl: string,
  startDate: string,
  endDate: string,
): Promise<SearchAnalyticsRow | null> {
  const webmasters = google.webmasters({ version: "v3", auth: authClient(accessToken) });

  const response = await webmasters.searchanalytics.query({
    siteUrl,
    requestBody: {
      startDate,
      endDate,
      dimensions: ["page"],
      dimensionFilterGroups: [
        {
          filters: [{ dimension: "page", operator: "equals", expression: pageUrl }],
        },
      ],
      rowLimit: 1,
    },
  });

  const row = response.data.rows?.[0];
  if (!row) return null;

  return {
    clicks: row.clicks ?? 0,
    impressions: row.impressions ?? 0,
    ctr: row.ctr ?? 0,
    position: row.position ?? 0,
  };
}
