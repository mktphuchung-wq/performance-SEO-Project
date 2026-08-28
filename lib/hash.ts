import { createHash } from "node:crypto";

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url.trim());
    parsed.hash = "";
    let pathname = parsed.pathname;
    if (pathname.length > 1 && pathname.endsWith("/")) {
      pathname = pathname.slice(0, -1);
    }
    return `${parsed.protocol}//${parsed.hostname.toLowerCase()}${pathname}${parsed.search}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

export function computeUrlHash(url: string): string {
  return createHash("sha256").update(normalizeUrl(url)).digest("hex");
}

export interface ContentHashInput {
  project: string;
  url: string;
  memberName: string;
  workedAt: string | null;
  workType: string;
  gscProperty: string | null;
  publishedAt: string | null;
}

export function computeContentHash(input: ContentHashInput): string {
  const payload = JSON.stringify([
    input.project,
    input.url,
    input.memberName,
    input.workedAt,
    input.workType,
    input.gscProperty,
    input.publishedAt,
  ]);
  return createHash("sha256").update(payload).digest("hex");
}

export interface WorkHashInput {
  urlHash: string;
  workedAt: string | null;
  workType: string;
  memberName: string;
}

/**
 * Identity of one work event. Two Sheet rows that agree on all four are the same
 * piece of work written twice, not two audits — collapsing them is intended.
 * Deliberately excludes the row number so reordering the Sheet does not orphan
 * every event and re-create it.
 */
export function computeWorkHash(input: WorkHashInput): string {
  const payload = JSON.stringify([input.urlHash, input.workedAt, input.workType, input.memberName]);
  return createHash("sha256").update(payload).digest("hex");
}

export interface WorkContentHashInput {
  project: string;
  memberEmail: string | null;
  workKind: string;
  sourceRowNumber: number | null;
}

/** The mutable half of a work event — what a sync has to write back when it changes. */
export function computeWorkContentHash(input: WorkContentHashInput): string {
  const payload = JSON.stringify([input.project, input.memberEmail, input.workKind, input.sourceRowNumber]);
  return createHash("sha256").update(payload).digest("hex");
}
