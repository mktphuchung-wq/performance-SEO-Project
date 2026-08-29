"use client";

import { useState } from "react";
import { RANGE_LABELS } from "@/lib/format";
import { SELECTABLE_RANGE_KEYS, type RangeKey } from "@/lib/ranges";
import { Button, Card, CardHeader, Checkbox } from "@/components/ui";

interface RefreshRunState {
  id: string;
  status: string;
  phase: string;
  range_key: string;
  total_urls: number;
  processed_urls: number;
  urls_with_data: number;
  no_data_urls: number;
  failed_urls: number;
  total_items: number;
  completed_items: number;
  retry_count: number;
  gsc_call_count: number;
  heartbeat_at: string;
  error_message?: string | null;
}

interface SyncRunState {
  id: string;
  status: string;
  inserted_rows: number;
  updated_rows: number;
  deactivated_rows: number;
  failed_rows: number;
  rows_skipped_unchanged: number;
  error_message: string | null;
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
  /** Position of the range being refreshed, so the button counter is accurate even when a range fails. */
  const [rangeIndex, setRangeIndex] = useState(0);

  const [recomputing, setRecomputing] = useState(false);
  const [recomputeMessage, setRecomputeMessage] = useState<string | null>(null);
  const [recomputeFailed, setRecomputeFailed] = useState(false);

  const [snapshotMonths, setSnapshotMonths] = useState("1");
  const [snapshotting, setSnapshotting] = useState(false);
  const [snapshotMessage, setSnapshotMessage] = useState<string | null>(null);
  const [snapshotFailed, setSnapshotFailed] = useState(false);
  function pollRun<T extends { status: string; error_message?: string | null }>(url: string, onUpdate: (run: T) => void): Promise<T> {
    return new Promise((resolve, reject) => {
      let inFlight = false;
      let consecutiveFailures = 0;
      const poll = async () => {
        if (inFlight) return;
        inFlight = true;
        try {
          const response = await fetch(url, { cache: "no-store" });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error ?? "Could not read run status");
          const current = data.run as T;
          consecutiveFailures = 0;
          onUpdate(current);
          if (["success", "partial", "failed", "cancelled"].includes(current.status)) {
            clearInterval(timer);
            if (current.status === "failed" || current.status === "cancelled") reject(new Error(current.error_message ?? "Job failed"));
            else resolve(current);
          }
        } catch (error) {
          consecutiveFailures += 1;
          if (consecutiveFailures >= 5) {
            clearInterval(timer);
            reject(error);
          }
        } finally {
          inFlight = false;
        }
      };
      const timer = setInterval(poll, 2500);
      void poll();
    });
  }

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

  async function handleSnapshot() {
    setSnapshotting(true);
    setSnapshotMessage(null);
    setSnapshotFailed(false);
    try {
      const res = await fetch("/api/admin/monthly-snapshot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ months: Number(snapshotMonths) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not record monthly history");
      const errors = (data.errors ?? []) as string[];
      setSnapshotFailed(errors.length > 0);
      setSnapshotMessage(
        `${data.rowsWritten} row(s) across ${data.months.length} month(s) · ${data.flagged} flagged · ${data.reconciled} settled`
        + (errors.length > 0 ? ` · ${errors.length} error(s): ${errors[0]}` : ""),
      );
      onDone?.();
    } catch (error) {
      setSnapshotFailed(true);
      setSnapshotMessage((error as Error).message);
    } finally {
      setSnapshotting(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    setSyncMessage(null);
    setSyncFailed(false);
    try {
      const res = await fetch("/api/sync/sheet", { method: "POST" });
      const data = await res.json();
      if (!res.ok && res.status !== 409) throw new Error(data.error ?? "Sync failed");
      if (!data.runId) throw new Error(data.error ?? "Sync failed");
      setSyncMessage(res.status === 409 ? "Attached to the active sync run." : "Sync queued.");
      const finalRun = await pollRun<SyncRunState>(`/api/sync/status?id=${encodeURIComponent(data.runId)}`, (current) => {
        setSyncMessage(current.status === "queued" ? "Sync queued." : "Syncing Google Sheet...");
      });
      setSyncMessage(
        `${finalRun.inserted_rows} new · ${finalRun.updated_rows} updated · ${finalRun.rows_skipped_unchanged} unchanged · ${finalRun.deactivated_rows} deactivated · ${finalRun.failed_rows} failed`,
      );
      onDone?.();
    } catch (error) {
      setSyncFailed(true);
      setSyncMessage((error as Error).message);
    } finally {
      setSyncing(false);
    }
  }

  async function refreshRange(rangeKey: string): Promise<RefreshRunState> {
    // Clear the previous range's counters before awaiting /start, otherwise the
    // finished range's 100% totals render under the next range's label.
    setRun(null);
    const startRes = await fetch("/api/refresh/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rangeKey }),
    });
    const startData = await startRes.json();
    if (!startRes.ok && startRes.status !== 409) throw new Error(startData.error ?? "Failed to start refresh");
    if (startRes.status === 409 && startData.rangeKey !== rangeKey) {
      throw new Error(`Another range is already running: ${RANGE_LABELS[startData.rangeKey] ?? startData.rangeKey}`);
    }

    const runId = startData.run?.id ?? startData.runId;
    if (!runId) throw new Error(startData.error ?? "Failed to start refresh");
    let currentRun: RefreshRunState = startData.run ?? {
      id: runId, status: "queued", phase: "planning", range_key: rangeKey,
      total_urls: 0, processed_urls: 0, urls_with_data: 0, no_data_urls: 0, failed_urls: 0,
      total_items: 0, completed_items: 0, retry_count: 0, gsc_call_count: 0, heartbeat_at: new Date().toISOString(),
    };
    setRun(currentRun);
    let statusFailures = 0;
    let statusInFlight = false;
    const statusTimer = setInterval(() => {
      if (statusInFlight) return;
      statusInFlight = true;
      void fetch(`/api/refresh/status?id=${encodeURIComponent(runId)}`, { cache: "no-store" })
        .then(async (response) => {
          const data = await response.json();
          if (!response.ok) throw new Error(data.error ?? "Could not read refresh status");
          statusFailures = 0;
          setRun(data.run as RefreshRunState);
        })
        .catch(() => { statusFailures += 1; })
        .finally(() => { statusInFlight = false; });
    }, 2500);
    try {
      while (["queued", "running"].includes(currentRun.status)) {
        const processRes = await fetch("/api/refresh/process", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ refreshRunId: runId }),
        });
        const processData = await processRes.json();
        if (!processRes.ok) throw new Error(processData.error ?? "Refresh item failed");
        currentRun = processData.run as RefreshRunState;
        setRun(currentRun);
        if (!processData.done && !processData.processedItem) await new Promise((resolve) => setTimeout(resolve, 2500));
        if (statusFailures >= 5) setRefreshError("Status connection interrupted; the refresh worker is still retrying.");
      }
    } finally {
      clearInterval(statusTimer);
    }
    if (currentRun.status === "failed" || currentRun.status === "cancelled") {
      throw new Error(currentRun.error_message ?? "Refresh failed");
    }
    setRun(currentRun);
    return currentRun;
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
    setRangeIndex(0);
    // A failing range must not discard the ranges that already committed data,
    // so each one is attempted independently and errors are collected.
    const failures: string[] = [];
    let completed = 0;
    try {
      for (const [index, target] of selectedRanges.entries()) {
        setActiveRange(target);
        setRangeIndex(index);
        try {
          const finalRun = await refreshRange(target);
          completed += 1;
          if (finalRun.status === "partial") {
            failures.push(`${RANGE_LABELS[target] ?? target}: ${finalRun.error_message ?? `${finalRun.failed_urls} URL(s) failed`}`);
          }
        } catch (error) {
          failures.push(`${RANGE_LABELS[target] ?? target}: ${(error as Error).message}`);
        }
      }
      if (failures.length > 0) {
        const prefix = completed > 0 ? `${completed} of ${selectedRanges.length} ranges refreshed — ` : "";
        setRefreshError(prefix + failures.join(" · "));
      }
      // Refetch whenever any range landed, otherwise the overview keeps showing
      // pre-refresh numbers even though Postgres already has the new rows.
      if (completed > 0) onDone?.();
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
            {syncing ? "Syncing..." : "Sync now"}
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
                ? `Refreshing... (${rangeIndex + 1}/${selectedRanges.length})`
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
              <div className="numeric text-xs text-ink-subtle">
                {run.phase.replaceAll("_", " ")} · {run.completed_items}/{run.total_items} items · {run.gsc_call_count} GSC calls · {run.retry_count} retries · heartbeat {run.heartbeat_at.slice(11, 19)} UTC
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

      <div className="space-y-2 border-t border-line px-5 py-4">
        <h3 className="text-[13px] font-medium text-ink">4 · Record monthly history</h3>
        <p className="text-[13px] leading-5 text-ink-muted">
          Stores closed calendar months so a score can be graded against several past periods instead of only the one
          before it, and flags months that stand far out from a URL&apos;s own history so they do not become the
          yardstick for the month after. Run it once a month; run it with a larger number of months once, to backfill.
          It does call Search Console, one query per property per month.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-[13px] text-ink">
            Months
            <input
              type="number"
              min={1}
              max={16}
              value={snapshotMonths}
              onChange={(e) => setSnapshotMonths(e.target.value)}
              className="w-20 rounded-lg border border-line-strong px-2 py-1 text-sm"
            />
          </label>
          <Button
            variant="secondary"
            onClick={handleSnapshot}
            disabled={snapshotting || recomputing || syncing || refreshing}
          >
            {snapshotting ? "Recording…" : "Record monthly history"}
          </Button>
        </div>
        {snapshotMessage && (
          <p className={`text-[13px] ${snapshotFailed ? "text-negative" : "text-ink-muted"}`}>{snapshotMessage}</p>
        )}
      </div>
    </Card>
  );
}
