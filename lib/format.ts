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

export function formatPosition(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value.toFixed(1);
}

export const RANGE_LABELS: Record<string, string> = {
  current_month: "This month",
  previous_month: "Previous month",
  last_3_months: "Last 3 months",
  last_6_months: "Last 6 months",
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
