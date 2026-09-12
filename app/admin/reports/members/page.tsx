"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, CardHeader, EmptyState, Field, PageHeader, inputClass } from "@/components/ui";
import { FetchJsonError, fetchJson, messageOf } from "@/lib/http/fetch-json";
import {
  RANGE_LABELS,
  formatCtr,
  formatDelta,
  formatGrowthPct,
  formatMonth,
  formatNumber,
  formatPosition,
  formatScore,
} from "@/lib/format";
import type { MemberReportReadDto } from "@/lib/reports/member-report";
import { MEMBER_REPORT_RANGE_KEYS, type MemberReportRangeKey } from "@/lib/repositories/member-report-snapshots";

interface MembersResponse { rows: Array<{ member_name: string; member_email: string | null }> }

function isMembersResponse(v: unknown): v is MembersResponse {
  return typeof v === "object" && v !== null && "rows" in v && Array.isArray((v as { rows: unknown }).rows);
}

function latestClosedMonth(): string {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - 3);
  const nextDay = new Date(cutoff);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const month = nextDay.getUTCMonth() !== cutoff.getUTCMonth() ? cutoff : new Date(Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth(), 0));
  return `${month.getUTCFullYear()}-${String(month.getUTCMonth() + 1).padStart(2, "0")}`;
}

type RangeCol = (typeof MEMBER_REPORT_RANGE_KEYS)[number];

const RANGE_COLS: RangeCol[] = [...MEMBER_REPORT_RANGE_KEYS];

function byRange<K extends MemberReportRangeKey>(
  summaries: MemberReportReadDto["summaries"],
  key: K,
) {
  return summaries.find((s) => s.rangeKey === key);
}

function formatDateShort(value: string): string {
  if (!value) return "\u2014";
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
}

function formatDateTime(value: string | null): string {
  if (!value) return "\u2014";
  return new Date(value).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

function GrowthStatusLabel({ value }: { value: string }) {
  const map: Record<string, { label: string; tone: "positive" | "negative" | "warning" | "neutral" | "accent" }> = {
    growing: { label: "Growing", tone: "positive" },
    declining: { label: "Declining", tone: "negative" },
    stable: { label: "Stable", tone: "neutral" },
    new_signal: { label: "New", tone: "accent" },
    no_data: { label: "No data", tone: "neutral" },
  };
  const entry = map[value] ?? { label: value, tone: "neutral" as const };
  return <Badge tone={entry.tone}>{entry.label}</Badge>;
}

function DataStatusLabel({ value }: { value: string }) {
  const map: Record<string, { label: string; tone: "positive" | "negative" | "warning" | "neutral" }> = {
    ok: { label: "OK", tone: "positive" },
    no_data: { label: "No data", tone: "neutral" },
    not_eligible: { label: "Excluded", tone: "warning" },
    error: { label: "Error", tone: "negative" },
  };
  const entry = map[value] ?? { label: value, tone: "neutral" as const };
  return <Badge tone={entry.tone}>{entry.label}</Badge>;
}

interface UrlRow {
  contentUrlId: string;
  project: string;
  url: string;
  workType: string;
  workedAt: string | null;
  kpiExcluded: boolean;
  byRange: Partial<Record<RangeCol, MemberReportReadDto["urls"][number]>>;
}

function groupUrls(urls: MemberReportReadDto["urls"]): UrlRow[] {
  const map = new Map<string, UrlRow>();
  for (const u of urls) {
    let row = map.get(u.contentUrlId);
    if (!row) {
      row = {
        contentUrlId: u.contentUrlId,
        project: u.project,
        url: u.url,
        workType: u.workType,
        workedAt: u.workedAt,
        kpiExcluded: u.kpiExcluded,
        byRange: {},
      };
      map.set(u.contentUrlId, row);
    }
    row.byRange[u.rangeKey] = u;
  }
  return Array.from(map.values());
}

function SummaryRow({
  label,
  values,
  bold,
}: {
  label: string;
  values: [string, string, string];
  bold?: boolean;
}) {
  return (
    <tr>
      <td className={`px-4 py-2 text-[13px] ${bold ? "font-medium text-ink" : "text-ink-muted"}`}>{label}</td>
      {values.map((v, i) => (
        <td key={i} className="px-4 py-2 text-right text-[13px] tabular-nums text-ink">
          {v}
        </td>
      ))}
    </tr>
  );
}

export default function MemberReportPage() {
  const router = useRouter();
  const [month, setMonth] = useState(latestClosedMonth);
  const [memberEmail, setMemberEmail] = useState("");
  const [members, setMembers] = useState<Array<{ member_name: string; member_email: string | null }>>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [report, setReport] = useState<MemberReportReadDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snapshotMissing, setSnapshotMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchJson<MembersResponse>("/api/admin/members", {}, isMembersResponse)
      .then((data) => {
        if (!cancelled) setMembers(data.rows);
      })
      .catch(() => {
        if (!cancelled) setMembers([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingMembers(false);
      });
    return () => { cancelled = true; };
  }, []);

  const loadReport = useCallback(() => {
    if (!month || !memberEmail) return;
    setLoading(true);
    setError(null);
    setSnapshotMissing(false);
    fetchJson<MemberReportReadDto>(
      `/api/admin/reports/members?month=${encodeURIComponent(month)}&memberEmail=${encodeURIComponent(memberEmail)}`,
    )
      .then((data) => { setReport(data); })
      .catch((err: unknown) => {
        if (err instanceof FetchJsonError && err.status === 404) {
          setSnapshotMissing(true);
          setReport(null);
        } else {
          setError(messageOf(err));
          setReport(null);
        }
      })
      .finally(() => setLoading(false));
  }, [month, memberEmail]);

  const handleView = useCallback(() => { loadReport(); }, [loadReport]);

  const handleGenerate = useCallback(() => {
    if (!month || !memberEmail) return;
    setGenerating(true);
    setError(null);
    setSnapshotMissing(false);
    fetchJson<MemberReportReadDto & { created: boolean }>(
      "/api/admin/reports/members",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month, memberEmail }),
      },
    )
      .then((data) => { setReport(data); })
      .catch((err: unknown) => { setError(messageOf(err)); })
      .finally(() => setGenerating(false));
  }, [month, memberEmail]);

  const handleExport = useCallback(() => {
    if (!month || !memberEmail) return;
    router.push(`/api/admin/reports/members/export?month=${encodeURIComponent(month)}&memberEmail=${encodeURIComponent(memberEmail)}`);
  }, [month, memberEmail, router]);

  const urlRows = useMemo(() => (report ? groupUrls(report.urls) : []), [report]);

  const selectedMember = members.find((m) => m.member_email === memberEmail);

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-5 py-6">
      <PageHeader
        title="Member reports"
        description="Monthly performance snapshots for individual members."
      />

      <Card>
        <CardHeader title="Generate or view report" description="Select a month and member, then generate a snapshot or view an existing one." />
        <div className="flex flex-wrap items-end gap-4 px-5 py-4">
          <Field label="Month">
            <input
              type="month"
              value={month}
              onChange={(e) => { setMonth(e.target.value); setReport(null); setSnapshotMissing(false); setError(null); }}
              max={latestClosedMonth()}
              className={inputClass}
              aria-label="Report month"
            />
          </Field>
          <Field label="Member">
            <select
              value={memberEmail}
              onChange={(e) => { setMemberEmail(e.target.value); setReport(null); setSnapshotMissing(false); setError(null); }}
              disabled={loadingMembers}
              className={inputClass}
              aria-label="Select member"
            >
              <option value="">{loadingMembers ? "Loading…" : "Choose a member"}</option>
              {members.map((m) => (
                <option key={m.member_email ?? m.member_name} value={m.member_email ?? ""}>
                  {m.member_name}{m.member_email ? ` (${m.member_email})` : ""}
                </option>
              ))}
            </select>
          </Field>
          <Button onClick={handleView} disabled={!month || !memberEmail || loading || generating}>
            View report
          </Button>
          <Button onClick={handleGenerate} disabled={!month || !memberEmail || generating || loading} variant="secondary">
            {generating ? "Generating…" : "Generate snapshot"}
          </Button>
          <Button onClick={handleExport} disabled={!report} variant="secondary">
            Export CSV
          </Button>
        </div>
      </Card>

      {error && (
        <p className="text-[13px] text-negative">{error}</p>
      )}

      {loading && (
        <Card>
          <EmptyState title="Loading report…" />
        </Card>
      )}

      {!loading && !error && !report && snapshotMissing && (
        <Card>
          <EmptyState
            title="No snapshot for this month"
            hint="Generate a snapshot to view the report."
          />
        </Card>
      )}

      {!loading && !error && !report && !snapshotMissing && (
        <Card>
          <EmptyState
            title="Select a month and member"
            hint="Choose a month and member above, then click View report."
          />
        </Card>
      )}

      {report && (
        <>
          <Card>
            <CardHeader
              title={`${selectedMember?.member_name ?? report.member.name} \u2014 ${formatMonth(report.reportMonth)}`}
              description={`Snapshot ${report.completedAt ? "completed" : "created"} ${formatDateTime(report.completedAt ?? report.createdAt)}`}
            />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs font-medium uppercase tracking-wider text-ink-muted">
                    <th className="px-4 py-2.5">Metric</th>
                    {RANGE_COLS.map((rk) => (
                      <th key={rk} className="px-4 py-2.5 text-right">{RANGE_LABELS[rk] ?? rk}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  <SummaryRow
                    label="KPI Score"
                    bold
                    values={RANGE_COLS.map((rk) => {
                      const s = byRange(report.summaries, rk);
                      return formatScore(s?.kpiScore ?? null);
                    }) as [string, string, string]}
                  />
                  <SummaryRow
                    label="Clicks"
                    values={RANGE_COLS.map((rk) => {
                      const s = byRange(report.summaries, rk);
                      return formatNumber(s?.clicks ?? null);
                    }) as [string, string, string]}
                  />
                  <SummaryRow
                    label="Impressions"
                    values={RANGE_COLS.map((rk) => {
                      const s = byRange(report.summaries, rk);
                      return formatNumber(s?.impressions ?? null);
                    }) as [string, string, string]}
                  />
                  <SummaryRow
                    label="CTR"
                    values={RANGE_COLS.map((rk) => {
                      const s = byRange(report.summaries, rk);
                      return formatCtr(s?.ctr ?? null);
                    }) as [string, string, string]}
                  />
                  <SummaryRow
                    label="Position"
                    values={RANGE_COLS.map((rk) => {
                      const s = byRange(report.summaries, rk);
                      return formatPosition(s?.position ?? null);
                    }) as [string, string, string]}
                  />
                  <SummaryRow
                    label="Click delta"
                    values={RANGE_COLS.map((rk) => {
                      const s = byRange(report.summaries, rk);
                      return formatDelta(s?.clickDelta ?? null);
                    }) as [string, string, string]}
                  />
                  <SummaryRow
                    label="Click growth"
                    values={RANGE_COLS.map((rk) => {
                      const s = byRange(report.summaries, rk);
                      return formatGrowthPct(s?.clickGrowthPct ?? null);
                    }) as [string, string, string]}
                  />
                  <SummaryRow
                    label="Impression delta"
                    values={RANGE_COLS.map((rk) => {
                      const s = byRange(report.summaries, rk);
                      return formatDelta(s?.impressionDelta ?? null);
                    }) as [string, string, string]}
                  />
                  <SummaryRow
                    label="Impression growth"
                    values={RANGE_COLS.map((rk) => {
                      const s = byRange(report.summaries, rk);
                      return formatGrowthPct(s?.impressionGrowthPct ?? null);
                    }) as [string, string, string]}
                  />
                  <SummaryRow
                    label="URLs"
                    values={RANGE_COLS.map((rk) => {
                      const s = byRange(report.summaries, rk);
                      return s ? `${s.urlCount}` : "\u2014";
                    }) as [string, string, string]}
                  />
                  <SummaryRow
                    label="With data"
                    values={RANGE_COLS.map((rk) => {
                      const s = byRange(report.summaries, rk);
                      return s ? `${s.urlsWithData}` : "\u2014";
                    }) as [string, string, string]}
                  />
                  <SummaryRow
                    label="Growing"
                    values={RANGE_COLS.map((rk) => {
                      const s = byRange(report.summaries, rk);
                      return s ? `${s.growingUrls}` : "\u2014";
                    }) as [string, string, string]}
                  />
                  <SummaryRow
                    label="Stable"
                    values={RANGE_COLS.map((rk) => {
                      const s = byRange(report.summaries, rk);
                      return s ? `${s.stableUrls}` : "\u2014";
                    }) as [string, string, string]}
                  />
                  <SummaryRow
                    label="Declining"
                    values={RANGE_COLS.map((rk) => {
                      const s = byRange(report.summaries, rk);
                      return s ? `${s.decliningUrls}` : "\u2014";
                    }) as [string, string, string]}
                  />
                  <SummaryRow
                    label="No data"
                    values={RANGE_COLS.map((rk) => {
                      const s = byRange(report.summaries, rk);
                      return s ? `${s.noDataUrls}` : "\u2014";
                    }) as [string, string, string]}
                  />
                  <SummaryRow
                    label="Range"
                    values={RANGE_COLS.map((rk) => {
                      const s = byRange(report.summaries, rk);
                      return s ? `${formatDateShort(s.startDate)} \u2013 ${formatDateShort(s.endDate)}` : "\u2014";
                    }) as [string, string, string]}
                  />
                  <SummaryRow
                    label="Previous range"
                    values={RANGE_COLS.map((rk) => {
                      const s = byRange(report.summaries, rk);
                      return s ? `${formatDateShort(s.previousStartDate)} \u2013 ${formatDateShort(s.previousEndDate)}` : "\u2014";
                    }) as [string, string, string]}
                  />
                </tbody>
              </table>
            </div>
          </Card>

          {urlRows.length === 0 ? (
            <Card>
              <EmptyState title="No URLs in this report" hint="The member has no tracked URLs for the selected month." />
            </Card>
          ) : (
            <Card>
              <CardHeader title="URL details" description={`${urlRows.length} URL${urlRows.length === 1 ? "" : "s"}`} />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1200px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs font-medium uppercase tracking-wider text-ink-muted">
                      <th className="sticky left-0 z-10 bg-surface px-4 py-2.5">Project</th>
                      <th className="sticky left-[120px] z-10 bg-surface px-4 py-2.5">URL</th>
                      <th className="sticky left-[320px] z-10 bg-surface px-4 py-2.5">Type</th>
                      <th className="sticky left-[420px] z-10 bg-surface px-4 py-2.5">Worked</th>
                      <th className="sticky left-[520px] z-10 bg-surface px-4 py-2.5 text-center">KPI excl.</th>
                      {RANGE_COLS.map((rk) => (
                        <th key={rk} colSpan={12} className="border-l border-line px-4 py-2.5 text-center">{RANGE_LABELS[rk] ?? rk}</th>
                      ))}
                    </tr>
                    <tr className="border-b border-line text-[11px] uppercase tracking-wider text-ink-muted">
                      <th colSpan={5} className="sticky left-0 z-10 bg-surface" />
                      {RANGE_COLS.map((rk) => (
                        <RangeSubHeader key={rk} />
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {urlRows.map((row) => (
                      <UrlRowTr key={row.contentUrlId} row={row} />
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function RangeSubHeader() {
  const cols = [
    "Clicks", "Impr.", "CTR", "Pos.",
    "Prev clicks", "Prev impr.",
    "Click \u0394", "Click %",
    "Imp. \u0394", "Imp. %",
    "Trend", "Status",
  ] as const;
  return (
    <>
      {cols.map((c) => (
        <th key={c} className="px-2.5 py-2 text-right font-medium last:text-left">{c}</th>
      ))}
    </>
  );
}

function UrlRowTr({ row }: { row: UrlRow }) {
  const rangeCells = RANGE_COLS.map((rk) => {
    const u = row.byRange[rk];
    if (!u) {
      return (
        <td key={rk} colSpan={12} className="border-l border-line px-2.5 py-2 text-center text-ink-subtle">\u2014</td>
      );
    }
    return (
      <Fragment key={rk}>
        <td className="border-l border-line px-2.5 py-2 text-right tabular-nums">{formatNumber(u.clicks)}</td>
        <td className="px-2.5 py-2 text-right tabular-nums">{formatNumber(u.impressions)}</td>
        <td className="px-2.5 py-2 text-right tabular-nums">{formatCtr(u.ctr)}</td>
        <td className="px-2.5 py-2 text-right tabular-nums">{formatPosition(u.position)}</td>
        <td className="px-2.5 py-2 text-right tabular-nums">{formatNumber(u.previousClicks)}</td>
        <td className="px-2.5 py-2 text-right tabular-nums">{formatNumber(u.previousImpressions)}</td>
        <td className={`px-2.5 py-2 text-right tabular-nums ${u.clickDelta != null && u.clickDelta > 0 ? "text-positive" : u.clickDelta != null && u.clickDelta < 0 ? "text-negative" : "text-ink-muted"}`}>{formatDelta(u.clickDelta)}</td>
        <td className={`px-2.5 py-2 text-right tabular-nums ${u.clickGrowthPct != null && u.clickGrowthPct > 0 ? "text-positive" : u.clickGrowthPct != null && u.clickGrowthPct < 0 ? "text-negative" : "text-ink-muted"}`}>{formatGrowthPct(u.clickGrowthPct)}</td>
        <td className={`px-2.5 py-2 text-right tabular-nums ${u.impressionDelta != null && u.impressionDelta > 0 ? "text-positive" : u.impressionDelta != null && u.impressionDelta < 0 ? "text-negative" : "text-ink-muted"}`}>{formatDelta(u.impressionDelta)}</td>
        <td className={`px-2.5 py-2 text-right tabular-nums ${u.impressionGrowthPct != null && u.impressionGrowthPct > 0 ? "text-positive" : u.impressionGrowthPct != null && u.impressionGrowthPct < 0 ? "text-negative" : "text-ink-muted"}`}>{formatGrowthPct(u.impressionGrowthPct)}</td>
        <td className="px-2.5 py-2 text-center">
          {u.growthStatus === "no_data" ? <span className="text-ink-subtle">\u2014</span> : <GrowthStatusLabel value={u.growthStatus} />}
        </td>
        <td className="px-2.5 py-2 text-center">
          <DataStatusLabel value={u.dataStatus} />
        </td>
      </Fragment>
    );
  });

  return (
    <tr>
      <td className="sticky left-0 z-10 bg-surface px-4 py-2.5 font-medium text-ink">{row.project}</td>
      <td className="sticky left-[120px] z-10 bg-surface px-4 py-2.5 max-w-[200px] truncate text-ink" title={row.url}>{row.url}</td>
      <td className="sticky left-[320px] z-10 bg-surface px-4 py-2.5 text-ink-muted">{row.workType}</td>
      <td className="sticky left-[420px] z-10 bg-surface px-4 py-2.5 text-ink-muted">{formatDateShort(row.workedAt ?? "")}</td>
      <td className="sticky left-[520px] z-10 bg-surface px-4 py-2.5 text-center">
        {row.kpiExcluded ? <Badge tone="warning">Yes</Badge> : <span className="text-ink-subtle">\u2014</span>}
      </td>
      {rangeCells}
    </tr>
  );
}
