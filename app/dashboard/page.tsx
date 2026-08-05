"use client";

import { useEffect, useState } from "react";
import { RangeSwitcher } from "@/components/RangeSwitcher";
import { StatCard } from "@/components/StatCard";
import { PerformanceTable, type PerformanceTableRow } from "@/components/PerformanceTable";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { RANGE_LABELS, formatGrowthPct, formatNumber } from "@/lib/format";
import type { MemberRollupRow } from "@/lib/repositories/rollups";

function GrowthNote({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) return <>vs. previous period: —</>;
  const tone = value > 0 ? "text-positive" : value < 0 ? "text-negative" : "text-ink-muted";
  return (
    <>
      <span className={`numeric font-medium ${tone}`}>{formatGrowthPct(value)}</span> vs. previous
    </>
  );
}

export default function DashboardPage() {
  const [range, setRange] = useState("current_month");
  const [rows, setRows] = useState<PerformanceTableRow[]>([]);
  const [rollup, setRollup] = useState<MemberRollupRow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      fetch(`/api/me/urls?range=${range}`).then((r) => r.json()),
      fetch(`/api/me/performance?range=${range}`).then((r) => r.json()),
    ]).then(([urlsRes, perfRes]) => {
      if (cancelled) return;
      setRows(urlsRes.rows ?? []);
      setRollup(perfRes.rollup ?? null);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [range]);

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-5 py-6">
      <PageHeader
        title="My performance"
        description="URLs assigned to you in the content sheet, measured in Search Console."
        action={
          <RangeSwitcher
            value={range}
            onChange={(next) => {
              setLoading(true);
              setRange(next);
            }}
          />
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="URLs"
          value={rollup ? String(rollup.url_count) : "—"}
          sub={rollup ? `${rollup.urls_with_data} with data` : undefined}
        />
        <StatCard
          label="Clicks"
          value={formatNumber(rollup?.clicks)}
          sub={rollup ? <GrowthNote value={rollup.click_growth_pct} /> : undefined}
        />
        <StatCard
          label="Impressions"
          value={formatNumber(rollup?.impressions)}
          sub={rollup ? <GrowthNote value={rollup.impression_growth_pct} /> : undefined}
        />
        <StatCard
          label="Growing / Declining"
          value={rollup ? `${rollup.growing_urls} / ${rollup.declining_urls}` : "—"}
          sub={rollup ? `${rollup.no_data_urls} without data` : undefined}
        />
      </div>

      <Card>
        <CardHeader
          title="My URLs"
          description={`${RANGE_LABELS[range] ?? range} — click a URL to see every range side by side.`}
        />
        {loading ? (
          <p className="px-5 py-10 text-center text-sm text-ink-muted">Loading…</p>
        ) : (
          <PerformanceTable rows={rows} />
        )}
      </Card>
    </div>
  );
}
