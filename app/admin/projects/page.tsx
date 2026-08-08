"use client";

import { useEffect, useState } from "react";
import { RangeSwitcher } from "@/components/RangeSwitcher";
import { ProjectComparisonTable } from "@/components/ProjectComparisonTable";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { RANGE_LABELS } from "@/lib/format";
import { DEFAULT_RANGE_KEY } from "@/lib/ranges";
import type { ProjectRollupRow } from "@/lib/repositories/rollups";

export default function AdminProjectsPage() {
  const [range, setRange] = useState<string>(DEFAULT_RANGE_KEY);
  const [rows, setRows] = useState<ProjectRollupRow[]>([]);

  useEffect(() => {
    fetch(`/api/admin/projects?range=${range}`)
      .then((r) => r.json())
      .then((data) => setRows(data.rows ?? []));
  }, [range]);

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-5 py-6">
      <PageHeader
        title="Project comparison"
        description="Every project's URLs rolled up. Counts read URLs / URLs with data."
        action={<RangeSwitcher value={range} onChange={setRange} />}
      />
      <Card>
        <CardHeader title={RANGE_LABELS[range] ?? range} />
        <ProjectComparisonTable rows={rows} />
      </Card>
    </div>
  );
}
