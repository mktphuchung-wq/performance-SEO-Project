"use client";

import { RANGE_LABELS } from "@/lib/format";

const RANGE_OPTIONS = ["current_month", "previous_month", "last_3_months", "last_6_months", "all_time"];

export function RangeSwitcher({ value, onChange }: { value: string; onChange: (range: string) => void }) {
  return (
    <div role="tablist" className="inline-flex flex-wrap gap-1 rounded-xl border border-line bg-surface p-1">
      {RANGE_OPTIONS.map((option) => (
        <button
          key={option}
          role="tab"
          aria-selected={value === option}
          onClick={() => onChange(option)}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
            value === option ? "bg-accent text-white" : "text-ink-muted hover:bg-neutral-soft hover:text-ink"
          }`}
        >
          {RANGE_LABELS[option]}
        </button>
      ))}
    </div>
  );
}
