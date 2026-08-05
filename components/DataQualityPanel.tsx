"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { ContentUrl } from "@/lib/repositories/content-urls";
import type { SyncRun } from "@/lib/repositories/sync-runs";
import type { RefreshRun } from "@/lib/repositories/refresh-runs";

interface DataQualityResponse {
  missingGscProperty: ContentUrl[];
  missingMemberEmail: ContentUrl[];
  recentSyncRuns: SyncRun[];
  recentRefreshRuns: RefreshRun[];
}

export function DataQualityPanel({ refreshKey }: { refreshKey?: number }) {
  const [data, setData] = useState<DataQualityResponse | null>(null);

  useEffect(() => {
    fetch("/api/admin/data-quality")
      .then((r) => r.json())
      .then(setData);
  }, [refreshKey]);

  if (!data) return null;

  const failedSync = data.recentSyncRuns.filter((r) => r.status === "failed");
  const failedRefresh = data.recentRefreshRuns.filter((r) => r.status === "failed");

  return (
    <div className="bg-white border rounded-lg p-4 space-y-4">
      <h2 className="text-sm font-semibold text-slate-900">Data quality</h2>

      <DataQualitySection
        title={`Projects missing a GSC property (${data.missingGscProperty.length})`}
        emptyLabel="All active URLs have a mapped GSC property."
      >
        {data.missingGscProperty.slice(0, 10).map((url) => (
          <li key={url.id} className="text-xs text-slate-600">
            <span className="font-medium">{url.project || "(no project)"}</span> — {url.url}
          </li>
        ))}
        {data.missingGscProperty.length > 0 && (
          <li className="text-xs">
            <Link href="/admin/settings" className="text-blue-600 hover:underline">
              Map projects to GSC properties →
            </Link>
          </li>
        )}
      </DataQualitySection>

      <DataQualitySection
        title={`Members missing an email alias (${data.missingMemberEmail.length})`}
        emptyLabel="All active URLs have a member email mapped."
      >
        {data.missingMemberEmail.slice(0, 10).map((url) => (
          <li key={url.id} className="text-xs text-slate-600">
            <span className="font-medium">{url.member_name || "(no member)"}</span> — {url.url}
          </li>
        ))}
        {data.missingMemberEmail.length > 0 && (
          <li className="text-xs">
            <Link href="/admin/settings" className="text-blue-600 hover:underline">
              Map member names to emails →
            </Link>
          </li>
        )}
      </DataQualitySection>

      <DataQualitySection title={`Failed sync runs (${failedSync.length})`} emptyLabel="No failed sync runs recently.">
        {failedSync.map((run) => (
          <li key={run.id} className="text-xs text-red-600">
            {new Date(run.started_at).toLocaleString()} — {run.error_message}
          </li>
        ))}
      </DataQualitySection>

      <DataQualitySection title={`Failed refresh runs (${failedRefresh.length})`} emptyLabel="No failed refresh runs recently.">
        {failedRefresh.map((run) => (
          <li key={run.id} className="text-xs text-red-600">
            {new Date(run.started_at).toLocaleString()} ({run.range_key}) — {run.error_message}
          </li>
        ))}
      </DataQualitySection>
    </div>
  );
}

function DataQualitySection({
  title,
  emptyLabel,
  children,
}: {
  title: string;
  emptyLabel: string;
  children: React.ReactNode;
}) {
  const hasChildren = Array.isArray(children) ? children.some(Boolean) : Boolean(children);
  return (
    <div>
      <h3 className="text-xs font-semibold text-slate-700">{title}</h3>
      {hasChildren ? (
        <ul className="mt-1 space-y-0.5">{children}</ul>
      ) : (
        <p className="text-xs text-slate-400 mt-1">{emptyLabel}</p>
      )}
    </div>
  );
}
