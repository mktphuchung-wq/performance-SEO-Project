import { fetchContentUrlSheetRows } from "@/lib/google";
import { computeUrlHash } from "@/lib/hash";
import { deactivateMissingContentUrls, upsertContentUrl } from "@/lib/repositories/content-urls";
import { getMemberAliasMap } from "@/lib/repositories/member-aliases";
import { getProjectGscPropertyMap } from "@/lib/repositories/project-gsc-properties";
import { completeSyncRun, createSyncRun, failSyncRun } from "@/lib/repositories/sync-runs";

const REQUIRED_HEADERS = ["project", "url", "member_name", "date", "type"];

export interface SheetSyncResult {
  syncRunId: string;
  totalRows: number;
  insertedRows: number;
  updatedRows: number;
  deactivatedRows: number;
  failedRows: number;
  warnings: string[];
}

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase();
}

function validateHeaders(headerRow: string[]): { columnIndex: Record<string, number> } {
  const normalized = headerRow.map(normalizeHeader);
  const missing = REQUIRED_HEADERS.filter((h) => !normalized.includes(h));
  if (missing.length > 0) {
    throw new Error(`Sheet header missing required columns: ${missing.join(", ")}. Found: ${normalized.join(", ")}`);
  }

  const seen = new Set<string>();
  for (const header of normalized) {
    if (REQUIRED_HEADERS.includes(header)) {
      if (seen.has(header)) {
        throw new Error(`Sheet header has duplicate column: ${header}`);
      }
      seen.add(header);
    }
  }

  const columnIndex: Record<string, number> = {};
  REQUIRED_HEADERS.forEach((header) => {
    columnIndex[header] = normalized.indexOf(header);
  });
  return { columnIndex };
}

function parseWorkedAt(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const date = new Date(String(raw));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

export async function syncContentUrlsFromSheet(accessToken: string, triggeredBy: string | null): Promise<SheetSyncResult> {
  const syncRunId = await createSyncRun(triggeredBy);
  const warnings: string[] = [];

  try {
    const rows = await fetchContentUrlSheetRows(accessToken);
    if (rows.length === 0) {
      throw new Error("Sheet returned no rows (expected a header row plus data).");
    }

    const [headerRow, ...dataRows] = rows;
    const { columnIndex } = validateHeaders(headerRow);

    const memberAliasMap = await getMemberAliasMap();
    const projectGscPropertyMap = await getProjectGscPropertyMap();

    let insertedRows = 0;
    let updatedRows = 0;
    let failedRows = 0;
    const seenHashes: string[] = [];
    let sourceRowNumber = 1;

    for (const row of dataRows) {
      sourceRowNumber += 1;
      const isBlank = row.every((cell) => String(cell ?? "").trim() === "");
      if (isBlank) continue;

      const project = String(row[columnIndex.project] ?? "").trim();
      const url = String(row[columnIndex.url] ?? "").trim();
      const memberName = String(row[columnIndex.member_name] ?? "").trim();
      const workedAt = parseWorkedAt(row[columnIndex.date]);
      const workType = String(row[columnIndex.type] ?? "").trim().toLowerCase();

      if (!url) {
        warnings.push(`Row ${sourceRowNumber}: skipped, missing url`);
        failedRows += 1;
        continue;
      }

      try {
        const urlHash = computeUrlHash(url);
        const memberEmail = memberAliasMap.get(memberName) ?? null;
        const gscProperty = projectGscPropertyMap.get(project) ?? null;

        const { inserted } = await upsertContentUrl({
          urlHash,
          project,
          url,
          memberName,
          memberEmail,
          workType,
          gscProperty,
          workedAt,
          sourceRowNumber,
        });

        seenHashes.push(urlHash);
        if (inserted) insertedRows += 1;
        else updatedRows += 1;
      } catch (rowError) {
        failedRows += 1;
        warnings.push(`Row ${sourceRowNumber}: ${(rowError as Error).message}`);
      }
    }

    const deactivatedRows = await deactivateMissingContentUrls(seenHashes);

    await completeSyncRun(syncRunId, {
      totalRows: dataRows.length,
      insertedRows,
      updatedRows,
      deactivatedRows,
      failedRows,
    });

    return { syncRunId, totalRows: dataRows.length, insertedRows, updatedRows, deactivatedRows, failedRows, warnings };
  } catch (error) {
    await failSyncRun(syncRunId, (error as Error).message);
    throw error;
  }
}
