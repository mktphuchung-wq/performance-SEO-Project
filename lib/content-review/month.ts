/**
 * Content Review runs on the calendar, not on the rolling windows Official KPI
 * uses, so a month is stored as its first day (`2026-08-01`). Keeping one
 * canonical form is what makes the unique (member, month) key hold: `2026-08`
 * and `2026-08-31` have to become the same row.
 */

const MONTH_INPUT = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/;

/** Returns `YYYY-MM-01`, or null when the input is not a month at all. */
export function normalizeMonth(value: string | null | undefined): string | null {
  const match = (value ?? "").trim().match(MONTH_INPUT);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;

  return `${year}-${String(month).padStart(2, "0")}-01`;
}

/** The `YYYY-MM` form an `<input type="month">` expects. */
export function toMonthInputValue(value: string): string {
  return value.slice(0, 7);
}

/** Current month in the browser or server local calendar, as `YYYY-MM`. */
export function currentMonthInputValue(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

const MONTH_LABEL = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

/** "Aug 2026" — read-only display, never parsed back. */
export function formatMonthLabel(value: string): string {
  const normalized = normalizeMonth(value);
  if (!normalized) return value;
  return MONTH_LABEL.format(new Date(`${normalized}T00:00:00Z`));
}
