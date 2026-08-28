import { fetchContentUrlSheetRows } from "@/lib/google";
import { withTransaction } from "@/lib/db";
import { getSyncBulkChunkSize, getSyncDateFormatHint } from "@/lib/env";
import { computeContentHash, computeUrlHash, computeWorkContentHash, computeWorkHash } from "@/lib/hash";
import {
  bulkUpsertContentUrlWorks,
  deactivateMissingWorks,
  getWorkContentHashMap,
  type BulkUpsertContentUrlWorkInput,
} from "@/lib/repositories/content-url-works";
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
import { classifyWorkKind } from "@/lib/sync/work-kind";

const REQUIRED_HEADERS = ["project", "url", "member_name", "date", "type"];

/**
 * The Sheet row that currently speaks for the URL: the latest work done on it.
 * Ties go to the row further down the Sheet, which is the one a person added
 * most recently.
 */
function latestWork(works: BulkUpsertContentUrlWorkInput[]): BulkUpsertContentUrlWorkInput {
  return works.reduce((latest, work) => {
    const a = work.workedAt ?? "";
    const b = latest.workedAt ?? "";
    if (a !== b) return a > b ? work : latest;
    return (work.sourceRowNumber ?? 0) >= (latest.sourceRowNumber ?? 0) ? work : latest;
  });
}

/**
 * The earliest date a work event claimed to have created this URL, or null when
 * none did. Null is the safe answer — it says "already live", so no Search
 * Console data is ever withheld for a URL we only ever saw audited.
 */
function publishedAtOf(works: BulkUpsertContentUrlWorkInput[]): string | null {
  const created = works.filter((work) => work.workKind === "new" && work.workedAt).map((work) => work.workedAt!);
  return created.length > 0 ? created.reduce((earliest, date) => (date < earliest ? date : earliest)) : null;
}

/**
 * Roll a URL's work events up into the single content_urls row that represents
 * it. The URL keeps its current owner and type for everything the UI already
 * shows; the per-event history stays in content_url_works.
 */
function contentUrlFrom(
  works: BulkUpsertContentUrlWorkInput[],
  url: string,
  projectGscProperties: Map<string, string>,
): BulkUpsertContentUrlInput {
  const latest = latestWork(works);
  const publishedAt = publishedAtOf(works);
  const gscProperty = projectGscProperties.get(latest.project) ?? null;
  return {
    urlHash: latest.urlHash,
    project: latest.project,
    url,
    memberName: latest.memberName,
    memberEmail: latest.memberEmail,
    workType: latest.workType,
    gscProperty,
    workedAt: latest.workedAt,
    publishedAt,
    sourceRowNumber: latest.sourceRowNumber,
    contentHash: computeContentHash({
      project: latest.project,
      url,
      memberName: latest.memberName,
      workedAt: latest.workedAt,
      workType: latest.workType,
      gscProperty,
      publishedAt,
    }),
  };
}

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
    // One entry per Sheet row. The Sheet is a work log — auditing a URL adds a
    // row rather than editing the old one — so collapsing rows by URL here (as
    // this used to) threw away who wrote the post and when, and moved the URL's
    // date forward onto the audit.
    const worksByHash = new Map<string, BulkUpsertContentUrlWorkInput>();
    const worksByUrlHash = new Map<string, BulkUpsertContentUrlWorkInput[]>();
    const urlText = new Map<string, string>();
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
      const urlHash = computeUrlHash(url);
      const memberEmail = memberAliasMap.get(memberName) ?? null;
      const workKind = classifyWorkKind(workType);
      const work: BulkUpsertContentUrlWorkInput = {
        workHash: computeWorkHash({ urlHash, workedAt: parsedDate.value, workType, memberName }),
        contentHash: computeWorkContentHash({ project, memberEmail, workKind, sourceRowNumber }),
        urlHash,
        project,
        memberName,
        memberEmail,
        workType,
        workKind,
        workedAt: parsedDate.value,
        sourceRowNumber,
      };
      // Only a row identical in URL, date, type and member is the same work
      // written twice. Two rows for one URL are two pieces of work and both stay.
      if (worksByHash.has(work.workHash)) {
        warnings.push(`Row ${sourceRowNumber}: duplicate work event (same URL, date, type and member); kept once`);
        continue;
      }
      worksByHash.set(work.workHash, work);
      urlText.set(urlHash, url);
      const forUrl = worksByUrlHash.get(urlHash);
      if (forUrl) forUrl.push(work);
      else worksByUrlHash.set(urlHash, [work]);
    }
    if (worksByUrlHash.size === 0) throw new Error("Sheet contained no valid URLs; no URLs were changed.");

    const byHash = new Map<string, BulkUpsertContentUrlInput>();
    for (const [urlHash, works] of worksByUrlHash) {
      const url = urlText.get(urlHash)!;
      byHash.set(urlHash, contentUrlFrom(works, url, projectGscPropertyMap));
    }

    await heartbeatSyncRun(runId);
    const dbStarted = Date.now();
    const result = await withTransaction(async (client) => {
      const [existing, existingWorks] = await Promise.all([getContentHashMap(client), getWorkContentHashMap(client)]);
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
      const changedWorks = [...worksByHash.values()].filter((work) => {
        const current = existingWorks.get(work.workHash);
        return !current || !current.isActive || current.contentHash !== work.contentHash;
      });
      const chunkSize = getSyncBulkChunkSize();
      for (let offset = 0; offset < changed.length; offset += chunkSize) {
        await bulkUpsertContentUrls(changed.slice(offset, offset + chunkSize), client);
      }
      // Works are written after the URLs they belong to: the insert resolves
      // content_url_id by joining url_hash, so the URL row has to exist first.
      await bulkUpsertContentUrlWorks(changedWorks, client);
      const deactivatedRows = await deactivateMissingContentUrls([...byHash.keys()], client);
      await deactivateMissingWorks([...worksByHash.keys()], client);
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
