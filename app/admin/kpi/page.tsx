"use client";

import { useEffect, useState } from "react";
import { KpiSummaryTable } from "@/components/KpiSummaryTable";
import { MemberCompositeTable } from "@/components/MemberCompositeTable";
import { RangeSwitcher } from "@/components/RangeSwitcher";
import { StatCard } from "@/components/StatCard";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { RANGE_LABELS, formatOfficialKpi } from "@/lib/format";
import {
  formatWeightMix,
  weightPct,
  type KpiPeriodWeights,
  type MemberCompositeKpi,
} from "@/lib/performance/composite-score";
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

interface CompositeResponse {
  rows: MemberCompositeKpi[];
  avgOfficialKpi: number | null;
  scoredMemberCount: number;
  memberCount: number;
  defaultWeights: KpiPeriodWeights | null;
}

/** Compact "25/50/25" for a stat card; the full mix goes in the sub-line. */
function weightLabel(weights: KpiPeriodWeights): string {
  return [weights.last_1_month, weights.last_3_months, weights.last_6_months].map(weightPct).join("/");
}

const EMPTY_COMPOSITE: CompositeResponse = {
  rows: [],
  avgOfficialKpi: null,
  scoredMemberCount: 0,
  memberCount: 0,
  defaultWeights: null,
};

const TABS: Array<{ scope: Scope; label: string; entityLabel: string }> = [
  { scope: "member", label: "Theo Member", entityLabel: "Member" },
  { scope: "project", label: "Theo Project", entityLabel: "Project" },
];

export default function AdminKpiPage() {
  const [range, setRange] = useState<string>(DEFAULT_RANGE_KEY);
  const [scope, setScope] = useState<Scope>("member");
  const [data, setData] = useState<SummaryResponse>(EMPTY);
  const [composite, setComposite] = useState<CompositeResponse>(EMPTY_COMPOSITE);
  const [compositeLoading, setCompositeLoading] = useState(true);
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

  // Official KPI spans 1M + 3M + 6M, so it is loaded once and left alone when
  // the range or the tab changes.
  useEffect(() => {
    let cancelled = false;

    fetch("/api/admin/kpi/members/summary")
      .then((r) => r.json())
      .catch(() => EMPTY_COMPOSITE)
      .then((body: CompositeResponse) => {
        if (cancelled) return;
        setComposite({ ...EMPTY_COMPOSITE, ...body });
        setCompositeLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

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
        description="Official KPI per member, then the traffic and content behind it for one range at a time."
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Avg Official KPI"
          value={formatOfficialKpi(composite.avgOfficialKpi)}
          sub={`${composite.scoredMemberCount} of ${composite.memberCount} members scored`}
        />
        <StatCard
          label="Team default mix"
          value={composite.defaultWeights ? weightLabel(composite.defaultWeights) : "—"}
          sub={composite.defaultWeights ? formatWeightMix(composite.defaultWeights) : "Loading…"}
        />
        <StatCard
          label="Personal strategies"
          value={String(composite.rows.filter((row) => row.hasCustomWeights).length)}
          sub="Members on their own period mix"
        />
        <StatCard
          label="Partial coverage"
          value={String(composite.rows.filter((row) => row.availablePeriodCount > 0 && row.availablePeriodCount < 3).length)}
          sub="Members scored on fewer than 3 periods"
        />
      </div>

      <Card>
        <CardHeader
          title="Official KPI by member"
          description="Derived from the 1M / 3M / 6M scores — the range switcher below does not change it. Trend is diagnostic only and never affects the ranking."
        />
        {compositeLoading ? (
          <p className="px-5 py-10 text-center text-sm text-ink-muted">Loading…</p>
        ) : (
          <MemberCompositeTable rows={composite.rows} />
        )}
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <div>
          <h2 className="text-sm font-medium text-ink">Selected range diagnostics</h2>
          <p className="mt-0.5 text-[13px] text-ink-muted">
            The table below follows this range. The Official KPI above does not.
          </p>
        </div>
        <RangeSwitcher value={range} onChange={changeRange} />
      </div>

      <Card>
        <CardHeader
          title={`Selected range score — ${RANGE_LABELS[range] ?? range}${measuredWindow}`}
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
