"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge, Card, CardHeader, type BadgeTone } from "@/components/ui";
import {
  DATA_STATUS_LABELS,
  GROWTH_STATUS_LABELS,
  RANGE_LABELS,
  formatGrowthPct,
  formatNumber,
  formatPosition,
} from "@/lib/format";
import type { UrlPerformanceRow } from "@/lib/repositories/performance-cache";
import type { ContentUrl } from "@/lib/repositories/content-urls";

const statusTone: Record<string, BadgeTone> = {
  ok: "positive",
  no_data: "neutral",
  not_eligible: "warning",
  error: "negative",
};

const growthTone: Record<string, BadgeTone> = {
  growing: "positive",
  new_signal: "accent",
  stable: "neutral",
  declining: "negative",
  no_data: "neutral",
};

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

  if (loading) return <p className="mx-auto max-w-5xl px-5 py-10 text-sm text-ink-muted">Loading…</p>;
  if (error) return <p className="mx-auto max-w-5xl px-5 py-10 text-sm text-negative">{error}</p>;
  if (!contentUrl) return null;

  // Only ranges that actually returned data belong on the chart — plotting a
  // no_data range as 0 would break the "No Data ≠ 0" rule.
  const chartData = rows
    .filter((r) => r.range_key !== "custom" && r.data_status === "ok")
    .map((r) => ({
      range: RANGE_LABELS[r.range_key] ?? r.range_key,
      clicks: r.clicks ?? 0,
      impressions: r.impressions ?? 0,
    }));

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-5 py-6">
      <div>
        <Link href="/dashboard" className="text-[13px] font-medium text-accent hover:underline">
          ← Back to dashboard
        </Link>
        <a
          href={contentUrl.url}
          target="_blank"
          rel="noreferrer"
          className="mt-2 block break-all text-lg font-medium tracking-tight text-ink hover:text-accent"
        >
          {contentUrl.url}
        </a>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[13px] text-ink-muted">
          <span>{contentUrl.project}</span>
          <span className="text-ink-subtle">·</span>
          <span>{contentUrl.member_name}</span>
          {contentUrl.work_type && (
            <>
              <span className="text-ink-subtle">·</span>
              <span>{contentUrl.work_type}</span>
            </>
          )}
          {contentUrl.worked_at && (
            <>
              <span className="text-ink-subtle">·</span>
              <span>worked {contentUrl.worked_at}</span>
            </>
          )}
        </div>
      </div>

      {chartData.length > 0 && (
        <Card>
          <CardHeader title="Clicks by range" description="Only ranges with Search Console data are plotted." />
          <div className="h-64 px-3 py-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e3e6ea" vertical={false} />
                <XAxis dataKey="range" tick={{ fontSize: 12, fill: "#545c66" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 12, fill: "#545c66" }} tickLine={false} axisLine={false} width={44} />
                <Tooltip
                  cursor={{ fill: "#eef0f3" }}
                  contentStyle={{ borderRadius: 8, border: "1px solid #e3e6ea", fontSize: 13 }}
                />
                <Bar dataKey="clicks" fill="#1a73e8" radius={[4, 4, 0, 0]} maxBarSize={56} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="All ranges" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-line bg-neutral-soft/60 text-left text-xs font-medium uppercase tracking-wide text-ink-subtle">
                <th className="px-4 py-2.5">Range</th>
                <th className="px-4 py-2.5 text-right">Clicks</th>
                <th className="px-4 py-2.5 text-right">Impressions</th>
                <th className="px-4 py-2.5 text-right">Avg pos.</th>
                <th className="px-4 py-2.5 text-right">Click growth</th>
                <th className="px-4 py-2.5">Growth</th>
                <th className="px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.range_key} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5 font-medium text-ink">{RANGE_LABELS[row.range_key] ?? row.range_key}</td>
                  <td className="numeric px-4 py-2.5 text-right text-ink">{formatNumber(row.clicks)}</td>
                  <td className="numeric px-4 py-2.5 text-right text-ink">{formatNumber(row.impressions)}</td>
                  <td className="numeric px-4 py-2.5 text-right text-ink-muted">{formatPosition(row.position)}</td>
                  <td className="numeric px-4 py-2.5 text-right text-ink-muted">
                    {formatGrowthPct(row.click_growth_pct)}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge tone={growthTone[row.growth_status] ?? "neutral"}>
                      {GROWTH_STATUS_LABELS[row.growth_status] ?? row.growth_status}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5">
                    <span title={row.error_message ?? undefined}>
                      <Badge tone={statusTone[row.data_status] ?? "neutral"}>
                        {DATA_STATUS_LABELS[row.data_status] ?? row.data_status}
                      </Badge>
                    </span>
                    {row.error_message && (
                      <p className="mt-1 max-w-[260px] text-xs leading-4 text-negative">{row.error_message}</p>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
