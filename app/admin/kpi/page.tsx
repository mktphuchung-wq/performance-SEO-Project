"use client";

import { useEffect, useState } from "react";
import { KpiSummaryTable } from "@/components/KpiSummaryTable";
import { RangeSwitcher } from "@/components/RangeSwitcher";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { RANGE_LABELS } from "@/lib/format";
import { DEFAULT_RANGE_KEY, isRollingRange, type RangeKey } from "@/lib/ranges";
import type { ContentVolumeRow } from "@/lib/repositories/content-volume";
import type { MemberScoreRow, ProjectScoreRow } from "@/lib/repositories/kpi-score-rollups";
import type { MemberRollupRow, ProjectRollupRow } from "@/lib/repositories/rollups";

type Scope = "member" | "project";

interface SummaryResponse {
  scores: Array<MemberScoreRow | ProjectScoreRow>;
  rollups: Array<MemberRollupRow | ProjectRollupRow>;
  volume: ContentVolumeRow[];
  startDate: string | null;
  endDate: string | null;
}

const EMPTY: SummaryResponse = { scores: [], rollups: [], volume: [], startDate: null, endDate: null };

const TABS: Array<{ scope: Scope; label: string; entityLabel: string }> = [
  { scope: "member", label: "Theo Member", entityLabel: "Member" },
  { scope: "project", label: "Theo Project", entityLabel: "Project" },
];

export default function AdminKpiPage() {
  const [range, setRange] = useState<string>(DEFAULT_RANGE_KEY);
  const [scope, setScope] = useState<Scope>("member");
  const [data, setData] = useState<SummaryResponse>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const scoreable = isRollingRange(range as RangeKey);
  const entityLabel = TABS.find((t) => t.scope === scope)!.entityLabel;

  // Loading is switched on by whoever changes the range or the tab, not by the
  // effect itself — a setState in an effect body costs an extra render pass.
  function changeRange(next: string) {
    if (next === range) return;
    setLoading(true);
    setRange(next);
  }

  function changeScope(next: Scope) {
    if (next === scope) return;
    setLoading(true);
    setScope(next);
  }

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/admin/kpi/summary?scope=${scope}&range=${range}`)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? "Failed to load KPI summary");
        return body as SummaryResponse;
      })
      .then((body) => {
        if (cancelled) return;
        setData(body);
        setError(null);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setData(EMPTY);
        setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [scope, range]);

  const measuredWindow = data.startDate && data.endDate ? ` · ${data.startDate} → ${data.endDate}` : "";

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-5 py-6">
      <PageHeader
        title="Performance Score"
        description="KPI score next to the traffic it was graded from, and the amount of content produced in the window."
        action={<RangeSwitcher value={range} onChange={changeRange} />}
      />

      <Card>
        <CardHeader
          title={`${RANGE_LABELS[range] ?? range}${measuredWindow}`}
          description={
            scoreable
              ? "Sort by any column; filter by name. A member with no eligible URL shows “—”, never 0."
              : `${RANGE_LABELS[range] ?? range} has no previous period to compare against, so it is not scored — the traffic and volume columns still apply.`
          }
          action={
            <div role="tablist" className="inline-flex gap-1 rounded-xl border border-line bg-surface p-1">
              {TABS.map((tab) => (
                <button
                  key={tab.scope}
                  role="tab"
                  aria-selected={scope === tab.scope}
                  onClick={() => changeScope(tab.scope)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    scope === tab.scope ? "bg-accent text-white" : "text-ink-muted hover:bg-neutral-soft hover:text-ink"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          }
        />

        {error && <p className="px-5 py-4 text-[13px] text-negative">{error}</p>}
        {!error && loading && <p className="px-5 py-10 text-center text-sm text-ink-muted">Loading…</p>}
        {!error && !loading && (
          <KpiSummaryTable
            scores={data.scores}
            rollups={data.rollups}
            volume={data.volume}
            entityLabel={entityLabel}
          />
        )}
      </Card>
    </div>
  );
}
