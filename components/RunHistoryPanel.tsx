"use client";

import { useEffect, useState } from "react";
import { Badge, Card, CardHeader, type BadgeTone } from "@/components/ui";
import { RANGE_LABELS, formatNumber } from "@/lib/format";
import type { SyncRun } from "@/lib/repositories/sync-runs";
import type { RefreshRun } from "@/lib/repositories/refresh-runs";
import type { RangeFreshness } from "@/lib/repositories/performance-cache";

interface RunsResponse {
  syncRuns: SyncRun[];
  refreshRuns: RefreshRun[];
  freshness: RangeFreshness[];
}

const statusTone: Record<string, BadgeTone> = {
  success: "positive",
  failed: "negative",
  running: "accent",
};

function formatWhen(value: string | null): string {
  if (!value) return "never";
  return new Date(value).toLocaleString();
}

function relativeAge(value: string | null): string | null {
  if (!value) return null;
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function RunHistoryPanel({ refreshKey }: { refreshKey?: number }) {
  const [data, setData] = useState<RunsResponse | null>(null);

  useEffect(() => {
    fetch("/api/admin/runs")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData(null));
  }, [refreshKey]);

  if (!data) return null;

  const freshnessByRange = new Map(data.freshness.map((f) => [f.range_key, f]));
  const ranges = ["current_month", "previous_month", "last_3_months", "last_6_months", "all_time"];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Cached data by range"
          description="The dashboard reads these cached rows, not Google directly — they survive a reload and only change when you refresh."
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-line bg-neutral-soft/60 text-left text-xs font-medium uppercase tracking-wide text-ink-subtle">
                <th className="px-4 py-2.5">Range</th>
                <th className="px-4 py-2.5">Window</th>
                <th className="px-4 py-2.5 text-right">URLs cached</th>
                <th className="px-4 py-2.5 text-right">With data</th>
                <th className="px-4 py-2.5 text-right">Errors</th>
                <th className="px-4 py-2.5">Last refreshed</th>
              </tr>
            </thead>
            <tbody>
              {ranges.map((rangeKey) => {
                const row = freshnessByRange.get(rangeKey);
                return (
                  <tr key={rangeKey} className="border-b border-line last:border-0">
                    <td className="px-4 py-2.5 font-medium text-ink">{RANGE_LABELS[rangeKey] ?? rangeKey}</td>
                    <td className="px-4 py-2.5 text-ink-muted">
                      {row?.start_date ? `${row.start_date} → ${row.end_date}` : "—"}
                    </td>
                    <td className="numeric px-4 py-2.5 text-right text-ink">
                      {row ? formatNumber(row.cached_urls) : "—"}
                    </td>
                    <td className="numeric px-4 py-2.5 text-right text-positive">
                      {row ? formatNumber(row.ok_urls) : "—"}
                    </td>
                    <td className="numeric px-4 py-2.5 text-right">
                      {row && row.error_urls > 0 ? (
                        <span className="text-negative">{formatNumber(row.error_urls)}</span>
                      ) : (
                        <span className="text-ink-subtle">{row ? "0" : "—"}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-ink-muted">
                      {row?.refreshed_at ? (
                        <span title={formatWhen(row.refreshed_at)}>{relativeAge(row.refreshed_at)}</span>
                      ) : (
                        <span className="text-ink-subtle">Never refreshed</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Sheet sync history" />
          <ul className="divide-y divide-line">
            {data.syncRuns.length === 0 && <li className="px-5 py-4 text-[13px] text-ink-subtle">No sync yet.</li>}
            {data.syncRuns.map((run) => (
              <li key={run.id} className="px-5 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[13px] text-ink-muted">{formatWhen(run.started_at)}</span>
                  <Badge tone={statusTone[run.status] ?? "neutral"}>{run.status}</Badge>
                </div>
                <div className="numeric mt-1 text-[13px] text-ink-muted">
                  {run.total_rows} rows · {run.inserted_rows} new · {run.updated_rows} updated ·{" "}
                  {run.deactivated_rows} deactivated · {run.failed_rows} failed
                </div>
                {run.error_message && <p className="mt-1 text-[13px] text-negative">{run.error_message}</p>}
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeader title="GSC refresh history" />
          <ul className="divide-y divide-line">
            {data.refreshRuns.length === 0 && <li className="px-5 py-4 text-[13px] text-ink-subtle">No refresh yet.</li>}
            {data.refreshRuns.map((run) => (
              <li key={run.id} className="px-5 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[13px] text-ink-muted">
                    {formatWhen(run.started_at)} · {RANGE_LABELS[run.range_key] ?? run.range_key}
                  </span>
                  <Badge tone={statusTone[run.status] ?? "neutral"}>{run.status}</Badge>
                </div>
                <div className="numeric mt-1 text-[13px] text-ink-muted">
                  {run.processed_urls}/{run.total_urls} processed · {run.urls_with_data} with data ·{" "}
                  {run.no_data_urls} no data ·{" "}
                  <span className={run.failed_urls > 0 ? "text-negative" : undefined}>{run.failed_urls} failed</span>
                </div>
                {run.error_message && <p className="mt-1 text-[13px] text-negative">{run.error_message}</p>}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
