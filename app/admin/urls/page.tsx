"use client";

import { useEffect, useState } from "react";
import { RangeSwitcher } from "@/components/RangeSwitcher";
import { PerformanceTable, type PerformanceTableRow } from "@/components/PerformanceTable";
import { Card, CardHeader, Field, PageHeader, inputClass } from "@/components/ui";
import { RANGE_LABELS } from "@/lib/format";

export default function AdminUrlsPage() {
  const [range, setRange] = useState("current_month");
  const [project, setProject] = useState("");
  const [member, setMember] = useState("");
  const [rows, setRows] = useState<PerformanceTableRow[]>([]);
  const [projects, setProjects] = useState<string[]>([]);
  const [members, setMembers] = useState<string[]>([]);

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
  }, [range, project, member]);

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

        <PerformanceTable rows={rows} showMember />
      </Card>
    </div>
  );
}
