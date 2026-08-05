"use client";

import { formatGrowthPct, formatNumber, formatPosition } from "@/lib/format";
import type { MemberRollupRow } from "@/lib/repositories/rollups";

export function MemberComparisonTable({ rows }: { rows: MemberRollupRow[] }) {
  if (rows.length === 0) {
    return <div className="text-sm text-slate-500 py-8 text-center">No data for this range yet.</div>;
  }

  return (
    <div className="overflow-x-auto border rounded-lg bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-slate-50 text-left text-xs font-medium text-slate-500">
            <th className="px-3 py-2">Member</th>
            <th className="px-3 py-2 text-right">URLs</th>
            <th className="px-3 py-2 text-right">Clicks</th>
            <th className="px-3 py-2 text-right">Impressions</th>
            <th className="px-3 py-2 text-right">Avg Position</th>
            <th className="px-3 py-2 text-right">Click Growth</th>
            <th className="px-3 py-2 text-right">Growing</th>
            <th className="px-3 py-2 text-right">Declining</th>
            <th className="px-3 py-2 text-right">No Data</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.member_name} className="border-b last:border-0 hover:bg-slate-50">
              <td className="px-3 py-2 font-medium text-slate-900">{row.member_name}</td>
              <td className="px-3 py-2 text-right">{row.url_count}</td>
              <td className="px-3 py-2 text-right">{formatNumber(row.clicks)}</td>
              <td className="px-3 py-2 text-right">{formatNumber(row.impressions)}</td>
              <td className="px-3 py-2 text-right">{formatPosition(row.position)}</td>
              <td className="px-3 py-2 text-right">{formatGrowthPct(row.click_growth_pct)}</td>
              <td className="px-3 py-2 text-right text-emerald-600">{row.growing_urls}</td>
              <td className="px-3 py-2 text-right text-red-600">{row.declining_urls}</td>
              <td className="px-3 py-2 text-right text-slate-400">{row.no_data_urls}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
