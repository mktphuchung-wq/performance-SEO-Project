"use client";

import { useState } from "react";
import { RANGE_LABELS } from "@/lib/format";

const REFRESH_RANGE_OPTIONS = ["current_month", "previous_month", "last_3_months", "last_6_months", "all_time"];
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

  const [range, setRange] = useState(ALL_RANGES);
  const [activeRange, setActiveRange] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [run, setRun] = useState<RefreshRunState | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  async function handleSync() {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const res = await fetch("/api/sync/sheet", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Sync failed");
      setSyncMessage(
        `Sync complete: ${data.insertedRows} inserted, ${data.updatedRows} updated, ${data.deactivatedRows} deactivated, ${data.failedRows} failed.`,
      );
      onDone?.();
    } catch (error) {
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
    // otherwise the 3M/6M columns stay empty until they are refreshed too.
    const targets = range === ALL_RANGES ? REFRESH_RANGE_OPTIONS : [range];
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

  return (
    <div className="bg-white border rounded-lg p-4 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">Sync Google Sheet</h2>
        <p className="text-xs text-slate-500 mt-0.5">Pull the latest content_urls rows into Postgres.</p>
        <div className="mt-2 flex items-center gap-3">
          <button
            onClick={handleSync}
            disabled={syncing}
            className="rounded-md bg-slate-900 text-white text-sm px-3 py-1.5 disabled:opacity-50"
          >
            {syncing ? "Syncing…" : "Sync now"}
          </button>
          {syncMessage && <span className="text-xs text-slate-600">{syncMessage}</span>}
        </div>
      </div>

      <div className="border-t pt-4">
        <h2 className="text-sm font-semibold text-slate-900">Refresh GSC performance</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Fetch Search Console data for all active URLs. Each range is cached separately — refresh
          every range to fill the 1M / 3M / 6M columns.
        </p>
        <div className="mt-2 flex items-center gap-3 flex-wrap">
          <select
            value={range}
            onChange={(e) => setRange(e.target.value)}
            className="border rounded-md text-sm px-2 py-1.5"
            disabled={refreshing}
          >
            <option value={ALL_RANGES}>All ranges</option>
            {REFRESH_RANGE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {RANGE_LABELS[option]}
              </option>
            ))}
          </select>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="rounded-md bg-slate-900 text-white text-sm px-3 py-1.5 disabled:opacity-50"
          >
            {refreshing ? "Refreshing…" : "Refresh now"}
          </button>
        </div>

        {run && (
          <div className="mt-3 space-y-1">
            <div className="w-full bg-slate-100 rounded-full h-2">
              <div
                className="bg-slate-900 h-2 rounded-full transition-all"
                style={{ width: `${run.total_urls ? (run.processed_urls / run.total_urls) * 100 : 0}%` }}
              />
            </div>
            <div className="text-xs text-slate-500">
              {activeRange && <span className="font-medium">{RANGE_LABELS[activeRange]}: </span>}
              {run.processed_urls}/{run.total_urls} processed · {run.urls_with_data} with data · {run.no_data_urls} no
              data · {run.failed_urls} failed · status: {run.status}
            </div>
          </div>
        )}
        {refreshError && <div className="text-xs text-red-600 mt-2">{refreshError}</div>}
      </div>
    </div>
  );
}
