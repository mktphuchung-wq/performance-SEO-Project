import { TREND_GLYPHS, TREND_HINTS, TREND_LABELS } from "@/lib/format";
import type { TrendState } from "@/lib/performance/composite-score";

const trendTones: Record<TrendState, string> = {
  improving: "bg-positive-soft text-positive",
  recovering: "bg-positive-soft text-positive",
  declining: "bg-negative-soft text-negative",
  cooling: "bg-warning-soft text-warning",
  stable: "bg-neutral-soft text-ink-muted",
  insufficient_data: "bg-neutral-soft text-ink-subtle",
};

/**
 * The direction, always as words.
 *
 * The arrow and the tint are redundant on purpose: colour alone is unreadable to
 * a colour-blind viewer and invisible to a screen reader, so "Improving" is the
 * message and the rest only reinforces it. Recovering and Improving share a tone
 * for that reason — their difference is in the label, which is where meaning
 * that matters belongs.
 */
export function TrendBadge({ trend, size = "md" }: { trend: TrendState; size?: "sm" | "md" }) {
  const label = TREND_LABELS[trend] ?? trend;
  return (
    <span
      title={TREND_HINTS[trend]}
      className={`inline-flex items-center gap-1.5 rounded-full font-medium ${trendTones[trend]} ${
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-sm"
      }`}
    >
      <span aria-hidden="true">{TREND_GLYPHS[trend] ?? "—"}</span>
      {label}
    </span>
  );
}
