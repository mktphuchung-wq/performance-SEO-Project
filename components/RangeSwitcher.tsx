"use client";

import { RANGE_LABELS, RANGE_SHORT_LABELS } from "@/lib/format";
import { SELECTABLE_RANGE_KEYS } from "@/lib/ranges";

export function RangeSwitcher({ value, onChange }: { value: string; onChange: (range: string) => void }) {
  return (
    <div role="tablist" className="inline-flex flex-wrap gap-1 rounded-xl border border-line bg-surface p-1">
      {SELECTABLE_RANGE_KEYS.map((option) => (
        <button
          key={option}
          role="tab"
          aria-selected={value === option}
          title={RANGE_LABELS[option]}
          onClick={() => onChange(option)}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
            value === option ? "bg-accent text-white" : "text-ink-muted hover:bg-neutral-soft hover:text-ink"
          }`}
        >
          {RANGE_SHORT_LABELS[option] ?? option}
        </button>
      ))}
    </div>
  );
}
