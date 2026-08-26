import { fetchContentUrlSheetRows } from "@/lib/google";
import { withTransaction } from "@/lib/db";
import { getSyncBulkChunkSize, getSyncDateFormatHint } from "@/lib/env";
import { computeContentHash, computeUrlHash } from "@/lib/hash";
import {
  bulkUpsertContentUrls,
  deactivateMissingContentUrls,
  getContentHashMap,
  type BulkUpsertContentUrlInput,
} from "@/lib/repositories/content-urls";
import { getMemberAliasMap } from "@/lib/repositories/member-aliases";
import { getProjectGscPropertyMap } from "@/lib/repositories/project-gsc-properties";
import { claimSyncRun, completeSyncRun, failSyncRun, heartbeatSyncRun } from "@/lib/repositories/sync-runs";
import { parseSheetDate } from "@/lib/sync/parse-date";

const REQUIRED_HEADERS = ["project", "url", "member_name", "date", "type"];

function normalizeHeader(header: unknown): string {
  return String(header ?? "").trim().toLowerCase();
}

function validateHeaders(headerRow: unknown[]): Record<string, number> {
  const normalized = headerRow.map(normalizeHeader);
  const missing = REQUIRED_HEADERS.filter((header) => !normalized.includes(header));
  if (missing.length > 0) throw new Error(`Sheet header missing required columns: ${missing.join(", ")}. Found: ${normalized.join(", ")}`);
  for (const header of REQUIRED_HEADERS) {
    if (normalized.filter((value) => value === header).length > 1) throw new Error(`Sheet header has duplicate column: ${header}`);
  }
  return Object.fromEntries(REQUIRED_HEADERS.map((header) => [header, normalized.indexOf(header)]));
}

export async function runSyncJob(runId: string, accessToken: string): Promise<void> {
  if (!(await claimSyncRun(runId))) return;
  const warnings: string[] = [];
  try {
    const sheetStarted = Date.now();
    const rows = await fetchContentUrlSheetRows(accessToken);
    const sheetReadMs = Date.now() - sheetStarted;
    if (rows.length < 2) throw new Error("Sheet returned no data rows; no URLs were changed.");

    const [headerRow, ...dataRows] = rows;
    const columns = validateHeaders(headerRow);
    const [memberAliasMap, projectGscPropertyMap] = await Promise.all([getMemberAliasMap(), getProjectGscPropertyMap()]);
    const byHash = new Map<string, BulkUpsertContentUrlInput>();
    let failedRows = 0;

    for (let index = 0; index < dataRows.length; index += 1) {
      const row = dataRows[index];
      const sourceRowNumber = index + 2;
      if (row.every((cell) => String(cell ?? "").trim() === "")) continue;
      const project = String(row[columns.project] ?? "").trim();
      const url = String(row[columns.url] ?? "").trim();
      const memberName = String(row[columns.member_name] ?? "").trim();
      const workType = String(row[columns.type] ?? "").trim().toLowerCase();
      if (!url) {
        warnings.push(`Row ${sourceRowNumber}: skipped, missing url`);
        failedRows += 1;
        continue;
      }
      const parsedDate = parseSheetDate(row[columns.date], getSyncDateFormatHint());
      if (parsedDate.error) {
        warnings.push(`Row ${sourceRowNumber}: ${parsedDate.error}`);
        failedRows += 1;
      }
      const gscProperty = projectGscPropertyMap.get(project) ?? null;
      const input: BulkUpsertContentUrlInput = {
        urlHash: computeUrlHash(url),
        project,
        url,
        memberName,
        memberEmail: memberAliasMap.get(memberName) ?? null,
        workType,
        gscProperty,
        workedAt: parsedDate.value,
        sourceRowNumber,
        contentHash: computeContentHash({ project, url, memberName, workedAt: parsedDate.value, workType, gscProperty }),
      };
      if (byHash.has(input.urlHash)) warnings.push(`Row ${sourceRowNumber}: duplicate normalized URL; last row wins`);
      byHash.set(input.urlHash, input);
    }
    if (byHash.size === 0) throw new Error("Sheet contained no valid URLs; no URLs were changed.");

    await heartbeatSyncRun(runId);
    const dbStarted = Date.now();
    const result = await withTransaction(async (client) => {
      const existing = await getContentHashMap(client);
      const changed: BulkUpsertContentUrlInput[] = [];
      let insertedRows = 0;
      let updatedRows = 0;
      let rowsSkippedUnchanged = 0;
      for (const input of byHash.values()) {
        const current = existing.get(input.urlHash);
        if (!current) {
          insertedRows += 1;
          changed.push(input);
        } else if (!current.isActive || current.contentHash !== input.contentHash) {
          updatedRows += 1;
          changed.push(input);
        } else {
          rowsSkippedUnchanged += 1;
        }
      }
      const chunkSize = getSyncBulkChunkSize();
      for (let offset = 0; offset < changed.length; offset += chunkSize) {
        await bulkUpsertContentUrls(changed.slice(offset, offset + chunkSize), client);
      }
      const deactivatedRows = await deactivateMissingContentUrls([...byHash.keys()], client);
      return { insertedRows, updatedRows, rowsSkippedUnchanged, deactivatedRows };
    });
    const dbWriteMs = Date.now() - dbStarted;
    await completeSyncRun(runId, {
      totalRows: dataRows.length,
      failedRows,
      sheetReadMs,
      dbWriteMs,
      ...result,
    });
    if (warnings.length > 0) console.warn(`Sync ${runId} completed with warnings`, warnings);
  } catch (error) {
    await failSyncRun(runId, (error as Error).message);
    throw error;
  }
}
