import type { ContentUrl } from "@/lib/repositories/content-urls";

export interface RefreshPreflightProject {
  project: string;
  affectedUrlCount: number;
  gscProperty?: string;
}

export class RefreshPreflightError extends Error {
  constructor(
    public readonly code: "MISSING_GSC_MAPPING" | "PROPERTY_ACCESS_DENIED",
    public readonly projects: RefreshPreflightProject[],
  ) {
    const total = projects.reduce((sum, project) => sum + project.affectedUrlCount, 0);
    const summary = projects.map((project) => `${project.project} (${project.affectedUrlCount})`).join(", ");
    super(
      code === "MISSING_GSC_MAPPING"
        ? `Search Console mapping is missing for ${total} eligible URL(s): ${summary}. Set a property in Admin -> Settings.`
        : `The signed-in Google account cannot read the mapped Search Console property for ${total} eligible URL(s): ${summary}. Reconnect an account with access or update the mapping in Admin -> Settings.`,
    );
    this.name = "RefreshPreflightError";
  }
}

function isEligible(url: ContentUrl, endDate: string): boolean {
  return !url.published_at || url.published_at <= endDate;
}

function groupProjects(rows: Array<{ project: string; gscProperty?: string }>): RefreshPreflightProject[] {
  const grouped = new Map<string, RefreshPreflightProject>();
  for (const row of rows) {
    const current = grouped.get(row.project) ?? { project: row.project, affectedUrlCount: 0, gscProperty: row.gscProperty };
    current.affectedUrlCount += 1;
    grouped.set(row.project, current);
  }
  return [...grouped.values()].sort((a, b) => a.project.localeCompare(b.project));
}

/**
 * Resolves the immutable URL snapshot from the project mapping table.  A
 * `content_urls.gsc_property` value is a denormalised convenience field, not a
 * fallback: otherwise a removed or renamed project mapping could silently keep
 * querying an old property.
 */
export function preflightRefreshUrls(
  urls: ContentUrl[],
  endDate: string,
  projectProperties: Map<string, string>,
  readableProperties: ReadonlySet<string>,
): ContentUrl[] {
  const eligible = urls.filter((url) => isEligible(url, endDate));
  const missing = groupProjects(eligible
    .filter((url) => !projectProperties.get(url.project))
    .map((url) => ({ project: url.project })));
  if (missing.length > 0) throw new RefreshPreflightError("MISSING_GSC_MAPPING", missing);

  const unreadable = groupProjects(eligible
    .map((url) => ({ project: url.project, gscProperty: projectProperties.get(url.project)! }))
    .filter(({ gscProperty }) => !readableProperties.has(gscProperty)));
  if (unreadable.length > 0) throw new RefreshPreflightError("PROPERTY_ACCESS_DENIED", unreadable);

  return urls.map((url) => ({ ...url, gsc_property: projectProperties.get(url.project) ?? null }));
}
