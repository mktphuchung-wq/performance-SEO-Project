import type { ReactNode } from "react";

export function StatCard({ label, value, sub }: { label: string; value: string; sub?: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3.5 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <div className="text-xs font-medium uppercase tracking-wide text-ink-subtle">{label}</div>
      <div className="numeric mt-1.5 text-2xl font-medium tracking-tight text-ink">{value}</div>
      {sub && <div className="mt-1 text-[13px] text-ink-muted">{sub}</div>}
    </div>
  );
}
