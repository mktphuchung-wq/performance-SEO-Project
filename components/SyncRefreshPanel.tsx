"use client";

import { useState } from "react";
import { RANGE_LABELS } from "@/lib/format";
import { SELECTABLE_RANGE_KEYS, type RangeKey } from "@/lib/ranges";
import { Button, Card, CardHeader, Checkbox } from "@/components/ui";

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

  // Every range is cached independently, so refreshing is a multi-select: the
  // 3M/6M views stay empty until they are refreshed too. Default to all of them.
  const [selectedRanges, setSelectedRanges] = useState<RangeKey[]>([...SELECTABLE_RANGE_KEYS]);
  const [activeRange, setActiveRange] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [run, setRun] = useState<RefreshRunState | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [doneRanges, setDoneRanges] = useState(0);

  const [recomputing, setRecomputing] = useState(false);
  const [recomputeMessage, setRecomputeMessage] = useState<string | null>(null);
  const [recomputeFailed, setRecomputeFailed] = useState(false);

  async function handleRecompute() {
    setRecomputing(true);
    setRecomputeMessage(null);
    setRecomputeFailed(false);
    try {
      const res = await fetch("/api/admin/kpi/recompute", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Recompute failed");
      setRecomputeMessage(`Rescored ${(data.recomputed ?? []).length} range(s) from cache.`);
      onDone?.();
    } catch (error) {
      setRecomputeFailed(true);
      setRecomputeMessage((error as Error).message);
    } finally {
      setRecomputing(false);
    }
  }

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

  function toggleRange(rangeKey: RangeKey, checked: boolean) {
    setSelectedRanges((current) => {
      const next = checked ? [...current, rangeKey] : current.filter((key) => key !== rangeKey);
      // Keep canonical order so the refresh always walks 1M → 3M → 6M → all time.
      return SELECTABLE_RANGE_KEYS.filter((key) => next.includes(key));
    });
  }

  function toggleAllRanges(checked: boolean) {
    setSelectedRanges(checked ? [...SELECTABLE_RANGE_KEYS] : []);
  }

  async function handleRefresh() {
    if (selectedRanges.length === 0) return;
    setRefreshing(true);
    setRefreshError(null);
    setRun(null);
    setDoneRanges(0);
    try {
      for (const target of selectedRanges) {
        setActiveRange(target);
        await refreshRange(target);
        setDoneRanges((count) => count + 1);
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
  const allSelected = selectedRanges.length === SELECTABLE_RANGE_KEYS.length;

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
            Each range is cached separately — tick every range you want filled. Selected ranges are refreshed one after
            another.
          </p>
          <div className="space-y-2">
            <span className="block text-xs font-medium text-ink-muted">Ranges</span>
            <div className="flex flex-wrap gap-2">
              <Checkbox
                label="All ranges"
                checked={allSelected}
                onChange={toggleAllRanges}
                disabled={refreshing}
              />
              {SELECTABLE_RANGE_KEYS.map((option) => (
                <Checkbox
                  key={option}
                  label={RANGE_LABELS[option]}
                  checked={selectedRanges.includes(option)}
                  onChange={(checked) => toggleRange(option, checked)}
                  disabled={refreshing}
                />
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button onClick={handleRefresh} disabled={refreshing || syncing || selectedRanges.length === 0}>
              {refreshing
                ? `Refreshing… (${doneRanges + 1}/${selectedRanges.length})`
                : `Refresh ${selectedRanges.length} range${selectedRanges.length === 1 ? "" : "s"}`}
            </Button>
            {selectedRanges.length === 0 && (
              <span className="text-[13px] text-ink-muted">Select at least one range.</span>
            )}
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

      <div className="space-y-2 border-t border-line px-5 py-4">
        <h3 className="text-[13px] font-medium text-ink">3 · Recompute KPI scores</h3>
        <p className="text-[13px] leading-5 text-ink-muted">
          Regrades the 1M / 3M / 6M ranges from data already in Postgres — no Search Console calls, so it costs no
          quota. Use after changing a project type, excluding a URL, or editing KPI settings.
        </p>
        <Button variant="secondary" onClick={handleRecompute} disabled={recomputing || syncing || refreshing}>
          {recomputing ? "Recomputing…" : "Recompute scores"}
        </Button>
        {recomputeMessage && (
          <p className={`text-[13px] ${recomputeFailed ? "text-negative" : "text-ink-muted"}`}>{recomputeMessage}</p>
        )}
      </div>
    </Card>
  );
}
