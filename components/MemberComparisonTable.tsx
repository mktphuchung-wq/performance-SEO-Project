"use client";

import { RollupTable } from "@/components/RollupTable";
import type { MemberRollupRow } from "@/lib/repositories/rollups";

export function MemberComparisonTable({ rows }: { rows: MemberRollupRow[] }) {
  return (
    <RollupTable
      entityLabel="Member"
      rows={rows.map((row) => ({ ...row, key: row.member_name, label: row.member_name }))}
    />
  );
}
