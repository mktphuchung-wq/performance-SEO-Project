/**
 * Turns a block pasted straight out of Google Sheets into review tasks.
 *
 * The clipboard format is TSV with no header row — an admin selects the data
 * cells, not the title row — and only five columns are used:
 *
 *   Ngày | Dự án - Web | Type | Task | URLs
 *
 * The Sheet itself has eight (Tháng, Ngày, Due date, Dự án, Type, Task, URLs,
 * Trạng thái). Rather than guess which layout arrived, the parser reports what
 * it saw per row and the UI shows a preview: a column shift is obvious to a
 * human at a glance and impossible to detect reliably in code, so the admin
 * confirms before anything is stored.
 */

export const EXPECTED_COLUMN_COUNT = 5;

export interface ParsedTaskRow {
  /** ISO `YYYY-MM-DD`, or null when the cell was empty or unparseable. */
  workedAt: string | null;
  /** The date exactly as pasted, so a preview can show what failed to parse. */
  workedAtRaw: string;
  project: string;
  workType: string;
  taskTitle: string;
  urls: string;
  /** 1-based position in the pasted text, kept for ordering and for the preview. */
  sourceRowNumber: number;
  columnCount: number;
}

export interface ParsePasteResult {
  rows: ParsedTaskRow[];
  /** Things worth showing before saving. Never fatal — the admin decides. */
  warnings: string[];
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * Accepts the two shapes a Sheet cell actually arrives in: an ISO date, or a
 * day-first `d/m/yyyy` (also with `-` or `.`). Day-first is the Vietnamese
 * locale the team works in, so `3/4/2026` is 3 April — the ambiguous case is
 * resolved that way deliberately rather than left to Date.parse, which would
 * read it as March.
 *
 * Anything else returns null instead of throwing: a task with an unreadable date
 * is still a task the member did, and blocking the whole import over it would
 * lose the count.
 */
export function parseWorkedAt(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;

  const iso = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const [, year, month, day] = iso;
    return isRealDate(Number(year), Number(month), Number(day)) ? `${year}-${pad(Number(month))}-${pad(Number(day))}` : null;
  }

  const dayFirst = value.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2}|\d{4})$/);
  if (dayFirst) {
    const day = Number(dayFirst[1]);
    const month = Number(dayFirst[2]);
    const rawYear = Number(dayFirst[3]);
    const year = dayFirst[3].length === 2 ? 2000 + rawYear : rawYear;
    return isRealDate(year, month, day) ? `${year}-${pad(month)}-${pad(day)}` : null;
  }

  return null;
}

function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function parsePastedTasks(text: string): ParsePasteResult {
  const warnings: string[] = [];
  const rows: ParsedTaskRow[] = [];

  const lines = text.replace(/\r\n?/g, "\n").split("\n");

  lines.forEach((line, index) => {
    // A row of nothing but separators is what a trailing selection looks like;
    // it is not a task and must not count toward the month.
    if (!line.trim()) return;

    const cells = line.split("\t");
    const value = (i: number) => (cells[i] ?? "").trim();

    rows.push({
      workedAt: parseWorkedAt(value(0)),
      workedAtRaw: value(0),
      project: value(1),
      workType: value(2),
      taskTitle: value(3),
      urls: value(4),
      sourceRowNumber: index + 1,
      columnCount: cells.length,
    });
  });

  if (rows.length === 0) {
    warnings.push("Nothing to import — the pasted text has no rows.");
    return { rows, warnings };
  }

  const wrongWidth = rows.filter((row) => row.columnCount !== EXPECTED_COLUMN_COUNT);
  if (wrongWidth.length > 0) {
    const widths = [...new Set(wrongWidth.map((row) => row.columnCount))].sort((a, b) => a - b);
    warnings.push(
      `${wrongWidth.length} of ${rows.length} rows have ${widths.join(" or ")} columns instead of ${EXPECTED_COLUMN_COUNT}. ` +
        "Check the preview: pasting all 8 Sheet columns shifts every field one across.",
    );
  }

  const undated = rows.filter((row) => row.workedAt === null && row.workedAtRaw !== "");
  if (undated.length > 0) {
    warnings.push(
      `${undated.length} rows have a date that could not be read (e.g. "${undated[0].workedAtRaw}"). ` +
        "They still import — the date is only shown, never scored.",
    );
  }

  const untitled = rows.filter((row) => !row.taskTitle);
  if (untitled.length > 0) {
    warnings.push(`${untitled.length} rows have an empty Task column — usually a sign the columns are shifted.`);
  }

  return { rows, warnings };
}
