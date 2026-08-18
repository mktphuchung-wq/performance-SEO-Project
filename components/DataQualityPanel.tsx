"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardHeader } from "@/components/ui";
import type { ContentUrl } from "@/lib/repositories/content-urls";
import type { SyncRun } from "@/lib/repositories/sync-runs";
import type { RefreshRun } from "@/lib/repositories/refresh-runs";

interface DataQualityResponse {
  missingGscProperty: ContentUrl[];
  missingMemberEmail: ContentUrl[];
  recentSyncRuns: SyncRun[];
  recentRefreshRuns: RefreshRun[];
}

/** Group by the field that is missing, so the fix is one action per group rather than per URL. */
function groupBy(urls: ContentUrl[], key: "project" | "member_name"): Array<{ label: string; count: number }> {
  const counts = new Map<string, number>();
  for (const url of urls) {
    const label = url[key] || "(blank)";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
}

export function DataQualityPanel({ refreshKey }: { refreshKey?: number }) {
  const [data, setData] = useState<DataQualityResponse | null>(null);

  useEffect(() => {
    fetch("/api/admin/data-quality")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData(null));
  }, [refreshKey]);

  if (!data) return null;

  const missingProperty = groupBy(data.missingGscProperty, "project");
  const missingEmail = groupBy(data.missingMemberEmail, "member_name");
  const allClear = missingProperty.length === 0 && missingEmail.length === 0;

  return (
    <Card>
      <CardHeader
        title="Data quality"
        description="Anything listed here blocks real numbers — a URL without these mappings can never be measured."
      />

      <div className="grid gap-5 px-5 py-4 md:grid-cols-2">
        <Issue
          title="Projects without a Search Console property"
          groups={missingProperty}
          emptyLabel="Every active URL has a mapped property."
          fixLabel="Map projects →"
        />
        <Issue
          title="Members without an email alias"
          groups={missingEmail}
          emptyLabel="Every active URL has a member email."
          fixLabel="Map members →"
        />
      </div>

      {allClear && (
        <p className="border-t border-line px-5 py-3 text-[13px] text-positive">
          All mappings complete — refresh results reflect real Search Console data.
        </p>
      )}
    </Card>
  );
}

function Issue({
  title,
  groups,
  emptyLabel,
  fixLabel,
}: {
  title: string;
  groups: Array<{ label: string; count: number }>;
  emptyLabel: string;
  fixLabel: string;
}) {
  return (
    <div>
      <h3 className="text-[13px] font-medium text-ink">{title}</h3>
      {groups.length === 0 ? (
        <p className="mt-1.5 text-[13px] text-ink-subtle">{emptyLabel}</p>
      ) : (
        <>
          <ul className="mt-2 space-y-1">
            {groups.map((group) => (
              <li key={group.label} className="flex items-center justify-between gap-3 text-[13px]">
                <span className="truncate text-ink">{group.label}</span>
                <span className="numeric shrink-0 rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning">
                  {group.count} URL{group.count === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ul>
          <Link href="/admin/settings" className="mt-2 inline-block text-[13px] font-medium text-accent hover:underline">
            {fixLabel}
          </Link>
        </>
      )}
    </div>
  );
}
