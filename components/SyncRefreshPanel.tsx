"use client";

import { useState } from "react";
import { RANGE_LABELS } from "@/lib/format";
import { SELECTABLE_RANGE_KEYS } from "@/lib/ranges";
import { Button, Card, CardHeader, Field, inputClass } from "@/components/ui";

const ALL_RANGES = "__all__";

interface RefreshRunState {
  id: string;
  status: string;
  total_urls: number;
  processed_urls: number;
  urls_with_data: number;
  no_data_urls: number;
  failed_urls: number;
}

export function SyncRefreshPanel({ onDone }: { onDone?: () => void }) {
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncFailed, setSyncFailed] = useState(false);

  const [range, setRange] = useState(ALL_RANGES);
  const [activeRange, setActiveRange] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [run, setRun] = useState<RefreshRunState | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  async function handleSync() {
    setSyncing(true);
    setSyncMessage(null);
    setSyncFailed(false);
    try {
      const res = await fetch("/api/sync/sheet", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Sync failed");
      setSyncMessage(
        `${data.insertedRows} new · ${data.updatedRows} updated · ${data.deactivatedRows} deactivated · ${data.failedRows} failed`,
      );
      onDone?.();
    } catch (error) {
      setSyncFailed(true);
      setSyncMessage((error as Error).message);
    } finally {
      setSyncing(false);
    }
  }

  async function refreshRange(rangeKey: string) {
    const startRes = await fetch("/api/refresh/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rangeKey }),
    });
    const startData = await startRes.json();
    if (!startRes.ok) throw new Error(startData.error ?? "Failed to start refresh");

    let currentRun: RefreshRunState = startData.run;
    setRun(currentRun);

    while (currentRun.status === "running") {
      const processRes = await fetch("/api/refresh/process", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshRunId: currentRun.id, batchSize: 20 }),
      });
      const processData = await processRes.json();
      if (!processRes.ok) throw new Error(processData.error ?? "Refresh batch failed");
      currentRun = processData.run;
      setRun(currentRun);
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    setRefreshError(null);
    setRun(null);
    // Each range is cached independently, so "all ranges" walks them in turn —
    // otherwise the 3M/6M views stay empty until they are refreshed too.
    const targets = range === ALL_RANGES ? SELECTABLE_RANGE_KEYS : [range];
    try {
      for (const target of targets) {
        setActiveRange(target);
        await refreshRange(target);
      }
      onDone?.();
    } catch (error) {
      setRefreshError((error as Error).message);
    } finally {
      setActiveRange(null);
      setRefreshing(false);
    }
  }

  const progressPct = run?.total_urls ? (run.processed_urls / run.total_urls) * 100 : 0;

  return (
    <Card>
      <CardHeader title="Data pipeline" description="Sheet → Postgres → Search Console. Run sync first, then refresh." />

      <div className="grid gap-5 px-5 py-4 md:grid-cols-2">
        <div className="space-y-2">
          <h3 className="text-[13px] font-medium text-ink">1 · Sync Google Sheet</h3>
          <p className="text-[13px] leading-5 text-ink-muted">
            Pull the latest <code className="rounded bg-neutral-soft px-1 py-0.5">content_urls</code> rows into
            Postgres.
          </p>
          <Button onClick={handleSync} disabled={syncing || refreshing}>
            {syncing ? "Syncing…" : "Sync now"}
          </Button>
          {syncMessage && (
            <p className={`text-[13px] ${syncFailed ? "text-negative" : "text-ink-muted"}`}>{syncMessage}</p>
          )}
        </div>

        <div className="space-y-2 md:border-l md:border-line md:pl-5">
          <h3 className="text-[13px] font-medium text-ink">2 · Refresh Search Console</h3>
          <p className="text-[13px] leading-5 text-ink-muted">
            Each range is cached separately — keep <strong>All ranges</strong> to fill the 1M / 3M / 6M views.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Range">
              <select
                value={range}
                onChange={(e) => setRange(e.target.value)}
                className={inputClass}
                disabled={refreshing}
              >
                <option value={ALL_RANGES}>All ranges</option>
                {SELECTABLE_RANGE_KEYS.map((option) => (
                  <option key={option} value={option}>
                    {RANGE_LABELS[option]}
                  </option>
                ))}
              </select>
            </Field>
            <Button onClick={handleRefresh} disabled={refreshing || syncing}>
              {refreshing ? "Refreshing…" : "Refresh now"}
            </Button>
          </div>

          {run && (
            <div className="space-y-1.5 pt-1">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-soft">
                <div
                  className="h-full rounded-full bg-accent transition-all"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <div className="numeric text-[13px] text-ink-muted">
                {activeRange && <span className="font-medium text-ink">{RANGE_LABELS[activeRange]}: </span>}
                {run.processed_urls}/{run.total_urls} · {run.urls_with_data} with data · {run.no_data_urls} no data ·{" "}
                <span className={run.failed_urls > 0 ? "text-negative" : undefined}>{run.failed_urls} failed</span>
              </div>
            </div>
          )}
          {refreshError && <p className="text-[13px] text-negative">{refreshError}</p>}
        </div>
      </div>
    </Card>
  );
}
