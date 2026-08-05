"use client";

import { RANGE_LABELS } from "@/lib/format";

const RANGE_OPTIONS = ["current_month", "previous_month", "last_3_months", "last_6_months", "all_time"];

export function RangeSwitcher({ value, onChange }: { value: string; onChange: (range: string) => void }) {
  return (
    <div className="inline-flex rounded-md border bg-white p-1 gap-1">
      {RANGE_OPTIONS.map((option) => (
        <button
          key={option}
          onClick={() => onChange(option)}
          className={`px-3 py-1.5 text-sm rounded ${
            value === option ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          {RANGE_LABELS[option]}
        </button>
      ))}
    </div>
  );
}
