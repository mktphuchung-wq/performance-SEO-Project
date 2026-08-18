export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("en-US").format(Math.round(value));
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined) return "—";
  return `${value.toFixed(digits)}%`;
}

export function formatGrowthPct(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

/** Absolute change against the previous period, always signed: "+1,204" / "-56" / "0". */
export function formatDelta(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const rounded = Math.round(value);
  const sign = rounded > 0 ? "+" : rounded < 0 ? "−" : "";
  return `${sign}${new Intl.NumberFormat("en-US").format(Math.abs(rounded))}`;
}

/** Search Console returns CTR as a 0–1 ratio, not a percentage. */
export function formatCtr(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

export function formatPosition(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value.toFixed(1);
}

/** KPI score is a 0–100 band; a member with nothing scoreable shows "—", not 0. */
export function formatScore(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return Math.round(value).toString();
}

export const SCORE_STATE_LABELS: Record<string, string> = {
  normal: "Scored",
  new_grace: "New (grace period)",
  excluded: "Excluded",
  no_data: "No data",
};

export const PROJECT_TYPE_LABELS: Record<string, string> = {
  new: "New",
  growth: "Growth",
  stable: "Stable",
};

export const RANGE_LABELS: Record<string, string> = {
  last_1_month: "Last 1 month",
  last_3_months: "Last 3 months",
  last_6_months: "Last 6 months",
  all_time: "All time",
  custom: "Custom",
};

/** Compact labels for tight controls like the range tabs. */
export const RANGE_SHORT_LABELS: Record<string, string> = {
  last_1_month: "1M",
  last_3_months: "3M",
  last_6_months: "6M",
  all_time: "All time",
  custom: "Custom",
};

export const DATA_STATUS_LABELS: Record<string, string> = {
  ok: "OK",
  no_data: "No data",
  not_eligible: "Not eligible yet",
  error: "Config error",
};

export const GROWTH_STATUS_LABELS: Record<string, string> = {
  growing: "Growing",
  declining: "Declining",
  stable: "Stable",
  new_signal: "New signal",
  no_data: "No data",
};
