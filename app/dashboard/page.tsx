"use client";

import { useEffect, useState } from "react";
import { RangeSwitcher } from "@/components/RangeSwitcher";
import { StatCard } from "@/components/StatCard";
import { PerformanceTable, type PerformanceTableRow } from "@/components/PerformanceTable";
import { formatGrowthPct, formatNumber } from "@/lib/format";
import type { MemberRollupRow } from "@/lib/repositories/rollups";

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
    <div className="mx-auto max-w-6xl px-4 py-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-lg font-semibold text-slate-900">My Performance</h1>
        <RangeSwitcher
          value={range}
          onChange={(next) => {
            setLoading(true);
            setRange(next);
          }}
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="URLs" value={rollup ? String(rollup.url_count) : "—"} sub={rollup ? `${rollup.urls_with_data} with data` : undefined} />
        <StatCard label="Clicks" value={formatNumber(rollup?.clicks)} sub={rollup ? formatGrowthPct(rollup.click_growth_pct) : undefined} />
        <StatCard label="Impressions" value={formatNumber(rollup?.impressions)} sub={rollup ? formatGrowthPct(rollup.impression_growth_pct) : undefined} />
        <StatCard label="Growing / Declining" value={rollup ? `${rollup.growing_urls} / ${rollup.declining_urls}` : "—"} sub={rollup ? `${rollup.no_data_urls} no data` : undefined} />
      </div>

      {loading ? (
        <div className="text-sm text-slate-500 py-8 text-center">Loading…</div>
      ) : (
        <PerformanceTable rows={rows} />
      )}
    </div>
  );
}
