"use client";

import Link from "next/link";
import { DATA_STATUS_LABELS, formatGrowthPct, formatNumber, formatPosition } from "@/lib/format";

export interface PerformanceTableRow {
  content_url_id: string;
  url: string;
  project: string;
  member_name: string;
  work_type: string;
  clicks: number | null;
  impressions: number | null;
  position: number | null;
  click_growth_pct: number | null;
  data_status: string;
  growth_status: string;
}

const statusBadgeClass: Record<string, string> = {
  ok: "bg-emerald-50 text-emerald-700",
  no_data: "bg-slate-100 text-slate-600",
  not_eligible: "bg-amber-50 text-amber-700",
  error: "bg-red-50 text-red-700",
};

export function PerformanceTable({ rows, showMember = false }: { rows: PerformanceTableRow[]; showMember?: boolean }) {
  if (rows.length === 0) {
    return <div className="text-sm text-slate-500 py-8 text-center">No URLs found for this range.</div>;
  }

  return (
    <div className="overflow-x-auto border rounded-lg bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-slate-50 text-left text-xs font-medium text-slate-500">
            <th className="px-3 py-2">URL</th>
            <th className="px-3 py-2">Project</th>
            {showMember && <th className="px-3 py-2">Member</th>}
            <th className="px-3 py-2">Type</th>
            <th className="px-3 py-2 text-right">Clicks</th>
            <th className="px-3 py-2 text-right">Impressions</th>
            <th className="px-3 py-2 text-right">Avg Position</th>
            <th className="px-3 py-2 text-right">Click Growth</th>
            <th className="px-3 py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.content_url_id} className="border-b last:border-0 hover:bg-slate-50">
              <td className="px-3 py-2 max-w-xs truncate">
                <Link href={`/dashboard/url/${row.content_url_id}`} className="text-blue-600 hover:underline" title={row.url}>
                  {row.url}
                </Link>
              </td>
              <td className="px-3 py-2 text-slate-600">{row.project || "—"}</td>
              {showMember && <td className="px-3 py-2 text-slate-600">{row.member_name || "—"}</td>}
              <td className="px-3 py-2 text-slate-600">{row.work_type || "—"}</td>
              <td className="px-3 py-2 text-right">{formatNumber(row.clicks)}</td>
              <td className="px-3 py-2 text-right">{formatNumber(row.impressions)}</td>
              <td className="px-3 py-2 text-right">{formatPosition(row.position)}</td>
              <td className="px-3 py-2 text-right">{formatGrowthPct(row.click_growth_pct)}</td>
              <td className="px-3 py-2">
                <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${statusBadgeClass[row.data_status] ?? ""}`}>
                  {DATA_STATUS_LABELS[row.data_status] ?? row.data_status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
