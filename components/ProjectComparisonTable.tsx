"use client";

import { RollupTable } from "@/components/RollupTable";
import type { ProjectRollupRow } from "@/lib/repositories/rollups";

export function ProjectComparisonTable({ rows }: { rows: ProjectRollupRow[] }) {
  return (
    <RollupTable
      entityLabel="Project"
      rows={rows.map((row) => ({ ...row, key: row.project, label: row.project }))}
    />
  );
}
