"use client";

import { useEffect, useState } from "react";
import { RangeSwitcher } from "@/components/RangeSwitcher";
import { PerformanceTable, type PerformanceTableRow } from "@/components/PerformanceTable";
import { Card, CardHeader, Field, PageHeader, inputClass } from "@/components/ui";
import { RANGE_LABELS } from "@/lib/format";
import { DEFAULT_RANGE_KEY } from "@/lib/ranges";

export default function AdminUrlsPage() {
  const [range, setRange] = useState<string>(DEFAULT_RANGE_KEY);
  const [project, setProject] = useState("");
  const [member, setMember] = useState("");
  const [rows, setRows] = useState<PerformanceTableRow[]>([]);
  const [projects, setProjects] = useState<string[]>([]);
  const [members, setMembers] = useState<string[]>([]);

  const [dataVersion, setDataVersion] = useState(0);
  const [kpiError, setKpiError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams({ range });
    if (project) params.set("project", project);
    if (member) params.set("member", member);

    fetch(`/api/admin/urls?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => {
        setRows(data.rows ?? []);
        setProjects(data.projects ?? []);
        setMembers(data.members ?? []);
      });
  }, [range, project, member, dataVersion]);

  async function toggleKpiExclusion(row: PerformanceTableRow) {
    const excluding = !row.kpi_excluded;
    // Excluding a URL is a judgement call someone else will have to understand
    // later, so it carries a reason. Re-including clears it.
    const reason = excluding ? window.prompt("Why is this URL excluded from KPI?", "Seasonal — out of season") : null;
    if (excluding && reason === null) return; // cancelled

    setKpiError(null);
    try {
      const res = await fetch(`/api/admin/urls/${row.content_url_id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kpiExcluded: excluding, reason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not update KPI exclusion");
      setDataVersion((v) => v + 1);
    } catch (error) {
      setKpiError((error as Error).message);
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-5 py-6">
      <PageHeader
        title="URL data source"
        description="Every active URL from the sheet with its cached Search Console metrics."
        action={<RangeSwitcher value={range} onChange={setRange} />}
      />

      <Card>
        <CardHeader
          title={`${RANGE_LABELS[range] ?? range} · ${rows.length} URL${rows.length === 1 ? "" : "s"}`}
        />

        <div className="flex flex-wrap items-end gap-3 border-b border-line px-5 py-4">
          <Field label="Project">
            <select value={project} onChange={(e) => setProject(e.target.value)} className={inputClass}>
              <option value="">All projects</option>
              {projects.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Member">
            <select value={member} onChange={(e) => setMember(e.target.value)} className={inputClass}>
              <option value="">All members</option>
              {members.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {kpiError && <p className="px-5 pt-3 text-[13px] text-negative">{kpiError}</p>}
        <PerformanceTable rows={rows} showMember onToggleKpiExclusion={toggleKpiExclusion} />
        <p className="border-t border-line px-5 py-3 text-[13px] text-ink-muted">
          Excluding a URL takes it out of KPI scoring entirely. Run <strong>Recompute scores</strong> in Admin →
          Overview to apply the change.
        </p>
      </Card>
    </div>
  );
}
