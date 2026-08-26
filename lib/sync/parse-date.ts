export interface ParsedSheetDate {
  value: string | null;
  error: string | null;
}

function validDate(year: number, month: number, day: number): boolean {
  if (year < 1900 || year > 9999 || month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

function formatDate(year: number, month: number, day: number): string | null {
  if (!validDate(year, month, day)) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function fromSheetSerial(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2958465) return null;
  const epoch = Date.UTC(1899, 11, 30);
  const date = new Date(epoch + Math.floor(serial) * 86400000);
  return formatDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

export function parseSheetDate(raw: unknown, hint: "dmy" | "mdy" = "dmy"): ParsedSheetDate {
  if (raw === null || raw === undefined || String(raw).trim() === "") return { value: null, error: null };

  if (typeof raw === "number") {
    const value = fromSheetSerial(raw);
    return value ? { value, error: null } : { value: null, error: `unparseable date "${raw}"` };
  }

  const text = String(raw).trim();
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const value = fromSheetSerial(Number(text));
    return value ? { value, error: null } : { value: null, error: `unparseable date "${text}"` };
  }

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (iso) {
    const value = formatDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    return value ? { value, error: null } : { value: null, error: `unparseable date "${text}"` };
  }

  const numeric = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/.exec(text);
  if (numeric) {
    const first = Number(numeric[1]);
    const second = Number(numeric[2]);
    const month = hint === "dmy" ? second : first;
    const day = hint === "dmy" ? first : second;
    const value = formatDate(Number(numeric[3]), month, day);
    return value ? { value, error: null } : { value: null, error: `unparseable date "${text}"` };
  }

  const english = /^([a-z]+)\s+(\d{1,2}),?\s+(\d{4})$/i.exec(text);
  if (english) {
    const value = formatDate(Number(english[3]), MONTHS[english[1].toLowerCase()] ?? 0, Number(english[2]));
    return value ? { value, error: null } : { value: null, error: `unparseable date "${text}"` };
  }

  return { value: null, error: `unparseable date "${text}"` };
}
