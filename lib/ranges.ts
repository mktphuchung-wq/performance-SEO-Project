export type RangeKey = "last_1_month" | "last_3_months" | "last_6_months" | "all_time" | "custom";

export const RANGE_KEYS: RangeKey[] = ["last_1_month", "last_3_months", "last_6_months", "all_time", "custom"];

/**
 * The ranges a user can pick and a refresh can fill. `custom` is excluded: it
 * has no fixed window, so it is only ever computed on demand.
 */
export const SELECTABLE_RANGE_KEYS: RangeKey[] = ["last_1_month", "last_3_months", "last_6_months", "all_time"];

/** What every page and API route falls back to when no range is given. */
export const DEFAULT_RANGE_KEY: RangeKey = "last_1_month";

/** Rolling windows, in months, keyed by range. */
const ROLLING_MONTHS: Partial<Record<RangeKey, number>> = {
  last_1_month: 1,
  last_3_months: 3,
  last_6_months: 6,
};

export interface RangeDates {
  rangeKey: RangeKey;
  startDate: string;
  endDate: string;
  previousStartDate: string | null;
  previousEndDate: string | null;
}

const GSC_DATA_LAG_DAYS = 3;
const ALL_TIME_START = "2015-01-01";

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return toIso(date);
}

function addMonths(iso: string, months: number): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  return toIso(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate())));
}

function dataCutoff(): string {
  return addDays(toIso(new Date()), -GSC_DATA_LAG_DAYS);
}

function previousPeriodOf(startDate: string, endDate: string): { previousStartDate: string; previousEndDate: string } {
  const days =
    Math.round(
      (new Date(`${endDate}T00:00:00Z`).getTime() - new Date(`${startDate}T00:00:00Z`).getTime()) / 86_400_000,
    ) + 1;
  const previousEndDate = addDays(startDate, -1);
  const previousStartDate = addDays(previousEndDate, -(days - 1));
  return { previousStartDate, previousEndDate };
}

export function computeRangeDates(rangeKey: RangeKey, custom?: { startDate: string; endDate: string }): RangeDates {
  const cutoff = dataCutoff();

  const months = ROLLING_MONTHS[rangeKey];
  if (months) {
    // Rolling window ending at the latest date Search Console has data for,
    // compared against the window of equal length immediately before it. 1M/3M/6M
    // all share this shape so their growth numbers mean the same thing.
    const endDate = cutoff;
    const startDate = addMonths(endDate, -months);
    return { rangeKey, startDate, endDate, ...previousPeriodOf(startDate, endDate) };
  }

  if (rangeKey === "all_time") {
    return { rangeKey, startDate: ALL_TIME_START, endDate: cutoff, previousStartDate: null, previousEndDate: null };
  }

  if (rangeKey === "custom") {
    if (!custom?.startDate || !custom?.endDate) {
      throw new Error("custom range requires startDate and endDate");
    }
    return {
      rangeKey,
      startDate: custom.startDate,
      endDate: custom.endDate,
      ...previousPeriodOf(custom.startDate, custom.endDate),
    };
  }

  throw new Error(`Unknown range key: ${rangeKey}`);
}
