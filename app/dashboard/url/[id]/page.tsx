"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DATA_STATUS_LABELS, GROWTH_STATUS_LABELS, RANGE_LABELS, formatGrowthPct, formatNumber, formatPosition } from "@/lib/format";
import type { UrlPerformanceRow } from "@/lib/repositories/performance-cache";
import type { ContentUrl } from "@/lib/repositories/content-urls";

export default function UrlDetailPage() {
  const params = useParams<{ id: string }>();
  const [contentUrl, setContentUrl] = useState<ContentUrl | null>(null);
  const [rows, setRows] = useState<UrlPerformanceRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/performance/url?id=${params.id}`)
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? "Failed to load");
        return data;
      })
      .then((data) => {
        setContentUrl(data.contentUrl);
        setRows(data.rows ?? []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [params.id]);

  if (loading) return <div className="mx-auto max-w-4xl px-4 py-8 text-sm text-slate-500">Loading…</div>;
  if (error) return <div className="mx-auto max-w-4xl px-4 py-8 text-sm text-red-600">{error}</div>;
  if (!contentUrl) return null;

  const chartData = rows
    .filter((r) => r.range_key !== "custom")
    .map((r) => ({ range: RANGE_LABELS[r.range_key] ?? r.range_key, clicks: r.clicks ?? 0, impressions: r.impressions ?? 0 }));

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 space-y-6">
      <div>
        <a href={contentUrl.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline break-all">
          {contentUrl.url}
        </a>
        <div className="text-sm text-slate-500 mt-1">
          {contentUrl.project} · {contentUrl.member_name} · {contentUrl.work_type}
        </div>
      </div>

      {chartData.length > 0 && (
        <div className="bg-white border rounded-lg p-4 h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="range" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="clicks" fill="#0f172a" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="overflow-x-auto border rounded-lg bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-slate-50 text-left text-xs font-medium text-slate-500">
              <th className="px-3 py-2">Range</th>
              <th className="px-3 py-2 text-right">Clicks</th>
              <th className="px-3 py-2 text-right">Impressions</th>
              <th className="px-3 py-2 text-right">Avg Position</th>
              <th className="px-3 py-2 text-right">Click Growth</th>
              <th className="px-3 py-2">Growth</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.range_key} className="border-b last:border-0">
                <td className="px-3 py-2 font-medium">{RANGE_LABELS[row.range_key] ?? row.range_key}</td>
                <td className="px-3 py-2 text-right">{formatNumber(row.clicks)}</td>
                <td className="px-3 py-2 text-right">{formatNumber(row.impressions)}</td>
                <td className="px-3 py-2 text-right">{formatPosition(row.position)}</td>
                <td className="px-3 py-2 text-right">{formatGrowthPct(row.click_growth_pct)}</td>
                <td className="px-3 py-2">{GROWTH_STATUS_LABELS[row.growth_status] ?? row.growth_status}</td>
                <td className="px-3 py-2">{DATA_STATUS_LABELS[row.data_status] ?? row.data_status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
