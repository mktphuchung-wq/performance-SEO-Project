export type RangeKey = "current_month" | "previous_month" | "last_3_months" | "last_6_months" | "all_time" | "custom";

export const RANGE_KEYS: RangeKey[] = [
  "current_month",
  "previous_month",
  "last_3_months",
  "last_6_months",
  "all_time",
  "custom",
];

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

function startOfMonth(iso: string): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  return toIso(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)));
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

  if (rangeKey === "current_month") {
    const startDate = startOfMonth(cutoff);
    const endDate = cutoff;
    return { rangeKey, startDate, endDate, ...previousPeriodOf(startDate, endDate) };
  }

  if (rangeKey === "previous_month") {
    const endDate = addDays(startOfMonth(cutoff), -1);
    const startDate = startOfMonth(endDate);
    return { rangeKey, startDate, endDate, ...previousPeriodOf(startDate, endDate) };
  }

  if (rangeKey === "last_3_months") {
    const endDate = cutoff;
    const startDate = addMonths(endDate, -3);
    return { rangeKey, startDate, endDate, ...previousPeriodOf(startDate, endDate) };
  }

  if (rangeKey === "last_6_months") {
    const endDate = cutoff;
    const startDate = addMonths(endDate, -6);
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
