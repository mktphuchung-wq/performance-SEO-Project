"use client";

import { useEffect, useState } from "react";
import { RangeSwitcher } from "@/components/RangeSwitcher";
import { ProjectComparisonTable } from "@/components/ProjectComparisonTable";
import type { ProjectRollupRow } from "@/lib/repositories/rollups";

export default function AdminProjectsPage() {
  const [range, setRange] = useState("current_month");
  const [rows, setRows] = useState<ProjectRollupRow[]>([]);

  useEffect(() => {
    fetch(`/api/admin/projects?range=${range}`)
      .then((r) => r.json())
      .then((data) => setRows(data.rows ?? []));
  }, [range]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-lg font-semibold text-slate-900">Project Comparison</h1>
        <RangeSwitcher value={range} onChange={setRange} />
      </div>
      <ProjectComparisonTable rows={rows} />
    </div>
  );
}
