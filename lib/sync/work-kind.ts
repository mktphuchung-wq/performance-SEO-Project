export type WorkKind = "new" | "existing";

/**
 * The Sheet's `type` column is free text, so this is a whitelist rather than an
 * enum: only a value that clearly says "this row created the URL" is "new".
 *
 * Everything else — audit, update, optimize, an empty cell, a type nobody has
 * typed before — describes work done on a URL that was already live. Such a row
 * says nothing about when the URL went live, so it must never be allowed to
 * blank out that URL's Search Console history. Defaulting the unknown to
 * "existing" is what makes that guarantee hold for types added to the Sheet
 * later without anyone touching this list.
 *
 * Kept in step with the same whitelist in migrations/011_work_events.sql.
 */
export const NEW_POST_WORK_TYPES = [
  "new",
  "new post",
  "newpost",
  "new posts",
  "post moi",
  "post mới",
  "bai moi",
  "bài mới",
];

const NEW_POST_SET = new Set(NEW_POST_WORK_TYPES);

/** Lowercase, and treat spaces, hyphens and underscores as the same separator. */
export function normalizeWorkType(workType: string): string {
  return workType.trim().toLowerCase().replace(/[\s_-]+/g, " ");
}

export function classifyWorkKind(workType: string): WorkKind {
  return NEW_POST_SET.has(normalizeWorkType(workType)) ? "new" : "existing";
}
