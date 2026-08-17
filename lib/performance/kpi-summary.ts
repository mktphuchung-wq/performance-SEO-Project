import type { ContentVolumeRow } from "@/lib/repositories/content-volume";
import type { MemberScoreRow, ProjectScoreRow } from "@/lib/repositories/kpi-score-rollups";
import type { MemberRollupRow, ProjectRollupRow } from "@/lib/repositories/rollups";

export type SummaryScoreRow = MemberScoreRow | ProjectScoreRow;
export type SummaryRollupRow = MemberRollupRow | ProjectRollupRow;

export interface KpiSummaryRow {
  name: string;
  volumeTotal: number;
  volumeParts: ContentVolumeRow[];
  score: SummaryScoreRow | null;
  rollup: SummaryRollupRow | null;
}

export type SortKey = "name" | "volume" | "score" | "clicks" | "impressions";
export type SortDirection = "asc" | "desc";

/** Member rows key on member_name, project rows on project; both arrive here. */
export function nameOf(row: { member_name?: string; project?: string }): string {
  return ("member_name" in row ? row.member_name : row.project) ?? "";
}

/**
 * One row per member (or project) that appears in ANY of the three sources —
 * a member can have produced content without a score yet, or hold a score for
 * URLs worked on before this window. Dropping either would quietly hide work.
 */
export function joinSummaryRows(
  scores: SummaryScoreRow[],
  rollups: SummaryRollupRow[],
  volume: ContentVolumeRow[],
): KpiSummaryRow[] {
  const names = new Set<string>();
  for (const row of scores) names.add(nameOf(row));
  for (const row of rollups) names.add(nameOf(row));
  for (const row of volume) names.add(row.key);
  names.delete("");

  return [...names].map((name) => {
    const parts = volume.filter((v) => v.key === name);
    return {
      name,
      volumeParts: parts,
      volumeTotal: parts.reduce((sum, p) => sum + Number(p.url_count), 0),
      score: scores.find((s) => nameOf(s) === name) ?? null,
      rollup: rollups.find((r) => nameOf(r) === name) ?? null,
    };
  });
}

/** The value a column sorts on. Null means "not comparable" — always sorted last. */
export function valueFor(row: KpiSummaryRow, key: SortKey): string | number | null {
  switch (key) {
    case "name":
      return row.name.toLowerCase();
    case "volume":
      return row.volumeTotal;
    case "score":
      return row.score?.kpi_score ?? null;
    case "clicks":
      return row.rollup?.clicks ?? null;
    case "impressions":
      return row.rollup?.impressions ?? null;
  }
}

export function filterSummaryRows(rows: KpiSummaryRow[], search: string): KpiSummaryRow[] {
  const needle = search.trim().toLowerCase();
  return needle ? rows.filter((r) => r.name.toLowerCase().includes(needle)) : rows;
}

/**
 * Sort a copy, never in place. A missing score is not a low score, so it never
 * competes for a position: it drops to the bottom whichever way the column is
 * sorted, ascending included.
 */
export function sortSummaryRows(rows: KpiSummaryRow[], key: SortKey, direction: SortDirection): KpiSummaryRow[] {
  const dir = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = valueFor(a, key);
    const bv = valueFor(b, key);
    if (av === null && bv === null) return a.name.localeCompare(b.name);
    if (av === null) return 1;
    if (bv === null) return -1;
    return av < bv ? -dir : av > bv ? dir : a.name.localeCompare(b.name);
  });
}

/** "12 (8 new post · 4 audit)" — the breakdown only when there is more than one kind. */
export function volumeLabel(row: KpiSummaryRow): string {
  if (row.volumeParts.length < 2) return String(row.volumeTotal);
  const parts = row.volumeParts.map((p) => `${p.url_count} ${p.work_type}`).join(" · ");
  return `${row.volumeTotal} (${parts})`;
}
