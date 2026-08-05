"use client";

import { useEffect, useState } from "react";
import { RangeSwitcher } from "@/components/RangeSwitcher";
import { PerformanceTable, type PerformanceTableRow } from "@/components/PerformanceTable";

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
    <div className="mx-auto max-w-6xl px-4 py-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-lg font-semibold text-slate-900">URL Data Source</h1>
        <RangeSwitcher value={range} onChange={setRange} />
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <select value={project} onChange={(e) => setProject(e.target.value)} className="border rounded-md text-sm px-2 py-1.5">
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select value={member} onChange={(e) => setMember(e.target.value)} className="border rounded-md text-sm px-2 py-1.5">
          <option value="">All members</option>
          {members.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      <PerformanceTable rows={rows} showMember />
    </div>
  );
}
