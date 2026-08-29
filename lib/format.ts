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

/**
 * Official KPI keeps one decimal — it is a weighted blend of three scores, and
 * rounding 74.4 and 73.6 both to 74 hides real distance between two members.
 */
export function formatOfficialKpi(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value.toFixed(1);
}

/**
 * Content KPI — the manually reviewed score, on the same 0–100 scale and to the
 * same precision as Official KPI, but deliberately its own function: the two are
 * separate measurements and nothing should end up sharing a formatter by
 * accident. A month with no gradeable data reads "—", never 0.
 */
export function formatContentScore(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value.toFixed(1);
}

/**
 * A stored date, as a person reads it. Dates come out of Postgres already as
 * YYYY-MM-DD strings, so only the day is taken: building a Date from one would
 * parse it as UTC midnight and render as the day before in any timezone west of
 * Greenwich.
 */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const [year, month, day] = value.slice(0, 10).split("-");
  if (!year || !month || !day) return "—";
  return `${day}/${month}/${year}`;
}

/**
 * Trend never travels as colour alone — the label is the message, the glyph and
 * the tone only reinforce it.
 */
export const TREND_LABELS: Record<string, string> = {
  improving: "Improving",
  declining: "Declining",
  recovering: "Recovering",
  cooling: "Cooling",
  stable: "Stable",
  insufficient_data: "Insufficient data",
};

export const TREND_GLYPHS: Record<string, string> = {
  improving: "↑",
  declining: "↓",
  recovering: "↗",
  cooling: "↘",
  stable: "→",
  insufficient_data: "—",
};

export const TREND_HINTS: Record<string, string> = {
  improving: "Recent months are clearly above the mid-term.",
  declining: "Recent months are clearly below the mid-term.",
  recovering: "Performance dipped mid-term and is climbing back.",
  cooling: "Performance peaked mid-term and is easing off.",
  stable: "No period differs enough from the others to call a direction.",
  insufficient_data: "Fewer than two periods have a score, so no direction can be read.",
};

export const KPI_STRATEGY_LABELS: Record<string, string> = {
  balanced: "Balanced",
  momentum: "Momentum",
  sustainability: "Sustainability",
  custom: "Custom",
};

export const KPI_STRATEGY_HINTS: Record<string, string> = {
  balanced: "Team default — 3M anchors the score.",
  momentum: "Weights recent months hardest — for a turnaround or a new site.",
  sustainability: "Weights the half-year hardest — for holding an established site.",
  custom: "A mix set by hand for this member.",
};

export const SCORE_STATE_LABELS: Record<string, string> = {
  normal: "Scored",
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
  not_eligible: "Published after this window",
  error: "Config error",
};

export const GROWTH_STATUS_LABELS: Record<string, string> = {
  growing: "Growing",
  declining: "Declining",
  stable: "Stable",
  new_signal: "New signal",
  no_data: "No data",
};
