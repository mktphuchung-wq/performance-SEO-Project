"use client";

import { useEffect, useState } from "react";
import { RangeSwitcher } from "@/components/RangeSwitcher";
import { MemberComparisonTable } from "@/components/MemberComparisonTable";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { RANGE_LABELS } from "@/lib/format";
import type { MemberRollupRow } from "@/lib/repositories/rollups";

export default function AdminMembersPage() {
  const [range, setRange] = useState("current_month");
  const [rows, setRows] = useState<MemberRollupRow[]>([]);

  useEffect(() => {
    fetch(`/api/admin/members?range=${range}`)
      .then((r) => r.json())
      .then((data) => setRows(data.rows ?? []));
  }, [range]);

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-5 py-6">
      <PageHeader
        title="Member comparison"
        description="Every member's URLs rolled up. Counts read URLs / URLs with data."
        action={<RangeSwitcher value={range} onChange={setRange} />}
      />
      <Card>
        <CardHeader title={RANGE_LABELS[range] ?? range} />
        <MemberComparisonTable rows={rows} />
      </Card>
    </div>
  );
}
