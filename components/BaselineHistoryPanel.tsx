"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, CardHeader, EmptyState, type BadgeTone } from "@/components/ui";
import { formatNumber } from "@/lib/format";

export interface MonthlyMetricRow {
  period_start: string;
  clicks: number | null;
  impressions: number | null;
  data_status: string;
  anomaly_status: string;
  anomaly_direction: string | null;
  anomaly_zscore: number | null;
  manual_override: string | null;
  manual_override_reason: string | null;
}

const ANOMALY_LABELS: Record<string, string> = {
  none: "Normal",
  provisional: "Flagged",
  confirmed: "One-off",
  dismissed: "Sustained",
};

const ANOMALY_TONES: Record<string, BadgeTone> = {
  none: "neutral",
  provisional: "warning",
  confirmed: "warning",
  dismissed: "positive",
};

function isExcluded(row: MonthlyMetricRow): boolean {
  if (row.manual_override === "force_exclude") return true;
  if (row.manual_override === "force_include") return row.data_status !== "ok";
  if (row.data_status !== "ok") return true;
  return row.anomaly_status === "provisional" || row.anomaly_status === "confirmed";
}

/**
 * The months behind a URL's score, and which of them the comparison actually
 * used. This is the answer to "why did this URL score what it scored" once the
 * baseline stopped being simply the period before.
 */
export function BaselineHistoryPanel({
  contentUrlId,
  url,
  onClose,
}: {
  contentUrlId: string;
  url: string;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<MonthlyMetricRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/admin/urls/${contentUrlId}/monthly-metrics`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setRows(data.rows ?? []);
        setError(null);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [contentUrlId]);

  useEffect(load, [load]);

  async function override(row: MonthlyMetricRow, next: string | null) {
    // An override overrules the detector, so whoever reads this later needs to
    // know on what grounds — the same rule the URL-level exclusion follows.
    const reason = next ? window.prompt("Why override this month?", "") : null;
    if (next && reason === null) return;

    setError(null);
    try {
      const res = await fetch(`/api/admin/urls/${contentUrlId}/monthly-metrics`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ periodStart: row.period_start, override: next, reason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not update the override");
      setRows(data.rows ?? []);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Baseline history"
        description={`Monthly Search Console history for ${url}. Months left out are not compared against — an anomalous month standing as the baseline is what makes a return to normal look like a collapse.`}
        action={
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        }
      />
      {error && <p className="px-5 pt-3 text-[13px] text-negative">{error}</p>}
      {loading && <p className="px-5 py-4 text-[13px] text-ink-subtle">Loading…</p>}
      {!loading && rows.length === 0 && (
        <EmptyState
          title="No monthly history recorded yet."
          hint="Run the monthly snapshot from Admin → Overview to build it."
        />
      )}
      {!loading && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-line bg-neutral-soft/60 text-left text-xs font-medium uppercase tracking-wide text-ink-subtle">
                <th className="px-4 py-2.5">Month</th>
                <th className="px-4 py-2.5 text-right">Clicks</th>
                <th className="px-4 py-2.5 text-right">Impressions</th>
                <th className="px-4 py-2.5">Detected</th>
                <th className="px-4 py-2.5">In baseline</th>
                <th className="px-4 py-2.5">Override</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.period_start} className="border-b border-line last:border-0">
                  <td className="numeric whitespace-nowrap px-4 py-2.5 text-ink">{row.period_start.slice(0, 7)}</td>
                  <td className="numeric px-4 py-2.5 text-right text-ink">{formatNumber(row.clicks)}</td>
                  <td className="numeric px-4 py-2.5 text-right text-ink-muted">{formatNumber(row.impressions)}</td>
                  <td className="px-4 py-2.5">
                    <Badge tone={ANOMALY_TONES[row.anomaly_status] ?? "neutral"}>
                      {ANOMALY_LABELS[row.anomaly_status] ?? row.anomaly_status}
                    </Badge>
                    {row.anomaly_direction && (
                      <span className="ml-2 text-xs text-ink-subtle">
                        {row.anomaly_direction}
                        {row.anomaly_zscore !== null && ` · z ${row.anomaly_zscore.toFixed(1)}`}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge tone={isExcluded(row) ? "warning" : "positive"}>
                      {isExcluded(row) ? "Left out" : "Counted"}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-col items-start gap-1">
                      <div className="flex gap-2">
                        <button
                          onClick={() => override(row, row.manual_override === "force_exclude" ? null : "force_exclude")}
                          className="text-xs font-medium text-accent hover:underline"
                        >
                          {row.manual_override === "force_exclude" ? "Undo exclude" : "Exclude"}
                        </button>
                        <button
                          onClick={() => override(row, row.manual_override === "force_include" ? null : "force_include")}
                          className="text-xs font-medium text-accent hover:underline"
                        >
                          {row.manual_override === "force_include" ? "Undo include" : "Include"}
                        </button>
                      </div>
                      {row.manual_override_reason && (
                        <span className="max-w-[200px] text-xs leading-4 text-ink-subtle">
                          {row.manual_override_reason}
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="border-t border-line px-5 py-3 text-[13px] text-ink-muted">
        Changing an override does not rescore on its own — run <strong>Recompute scores</strong> in Admin → Overview.
      </p>
    </Card>
  );
}
