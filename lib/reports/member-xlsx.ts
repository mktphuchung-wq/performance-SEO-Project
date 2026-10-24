import type {
  CompleteMemberReportSnapshot,
  MemberReportRangeKey,
  MemberReportSummarySnapshotRow,
  MemberReportUrlSnapshotRow,
} from "@/lib/repositories/member-report-snapshots";
import XlsxPopulate from "xlsx-populate";

type XlsxSheet = any;
type XlsxWorkbook = any;

const xlsxPopulate = XlsxPopulate as { fromBlankAsync(): Promise<XlsxWorkbook> };

const RANGE_KEYS: MemberReportRangeKey[] = [
  "last_1_month",
  "last_3_months",
  "last_6_months",
];

const RANGE_LABELS: Record<MemberReportRangeKey, string> = {
  last_1_month: "Last 1 month",
  last_3_months: "Last 3 months",
  last_6_months: "Last 6 months",
};

const SUMMARY_METRICS: Array<{
  label: string;
  value: (summary: MemberReportSummarySnapshotRow) => unknown;
  numberFormat?: string;
}> = [
  { label: "KPI score", value: (s) => s.kpi_score, numberFormat: "0.0" },
  { label: "Clicks", value: (s) => s.clicks, numberFormat: "#,##0" },
  { label: "Impressions", value: (s) => s.impressions, numberFormat: "#,##0" },
  { label: "CTR", value: (s) => s.ctr, numberFormat: "0.0%" },
  { label: "Position", value: (s) => s.position, numberFormat: "0.0" },
  { label: "Previous clicks", value: (s) => s.previous_clicks, numberFormat: "#,##0" },
  { label: "Previous impressions", value: (s) => s.previous_impressions, numberFormat: "#,##0" },
  { label: "Click delta", value: (s) => s.click_delta, numberFormat: "#,##0;[Red]-#,##0" },
  { label: "Click growth", value: (s) => s.click_growth_pct, numberFormat: "0.0\"%\";[Red]-0.0\"%\"" },
  { label: "Impression delta", value: (s) => s.impression_delta, numberFormat: "#,##0;[Red]-#,##0" },
  { label: "Impression growth", value: (s) => s.impression_growth_pct, numberFormat: "0.0\"%\";[Red]-0.0\"%\"" },
  { label: "URLs", value: (s) => s.url_count, numberFormat: "#,##0" },
  { label: "With data", value: (s) => s.urls_with_data, numberFormat: "#,##0" },
  { label: "Growing", value: (s) => s.growing_urls, numberFormat: "#,##0" },
  { label: "Stable", value: (s) => s.stable_urls, numberFormat: "#,##0" },
  { label: "Declining", value: (s) => s.declining_urls, numberFormat: "#,##0" },
  { label: "No data", value: (s) => s.no_data_urls, numberFormat: "#,##0" },
  { label: "Range", value: (s) => `${formatDate(s.start_date)} - ${formatDate(s.end_date)}` },
  { label: "Previous range", value: (s) => `${formatDate(s.previous_start_date)} - ${formatDate(s.previous_end_date)}` },
];

const URL_HEADERS = [
  "Content URL ID",
  "Project",
  "URL",
  "Type",
  "Worked",
  "First worked",
  "Published",
  "KPI excluded",
  "KPI excluded reason",
  ...RANGE_KEYS.flatMap((rangeKey) => [
    `${RANGE_LABELS[rangeKey]} clicks`,
    `${RANGE_LABELS[rangeKey]} impressions`,
    `${RANGE_LABELS[rangeKey]} CTR`,
    `${RANGE_LABELS[rangeKey]} position`,
    `${RANGE_LABELS[rangeKey]} previous clicks`,
    `${RANGE_LABELS[rangeKey]} previous impressions`,
    `${RANGE_LABELS[rangeKey]} previous CTR`,
    `${RANGE_LABELS[rangeKey]} previous position`,
    `${RANGE_LABELS[rangeKey]} click delta`,
    `${RANGE_LABELS[rangeKey]} click growth`,
    `${RANGE_LABELS[rangeKey]} impression delta`,
    `${RANGE_LABELS[rangeKey]} impression growth`,
    `${RANGE_LABELS[rangeKey]} trend`,
    `${RANGE_LABELS[rangeKey]} status`,
    `${RANGE_LABELS[rangeKey]} error message`,
  ]),
];

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function isoTimestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return String(value);
}

function formatDate(value: unknown): string {
  if (!value) return "";
  const text = String(value).slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return String(value);
  const [, year, month, day] = match;
  return `${day}/${month}/${year}`;
}

function dateValue(value: unknown): Date | null {
  if (!value) return null;
  const text = String(value).slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function safeText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function columnName(index: number): string {
  let value = "";
  let remaining = index;
  while (remaining > 0) {
    const remainder = (remaining - 1) % 26;
    value = String.fromCharCode(65 + remainder) + value;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return value;
}

function summaryIndex(
  summaries: MemberReportSummarySnapshotRow[],
): Map<MemberReportRangeKey, MemberReportSummarySnapshotRow> {
  return new Map(summaries.map((summary) => [summary.range_key, summary]));
}

function groupedUrls(urls: MemberReportUrlSnapshotRow[]): Array<{
  anchor: MemberReportUrlSnapshotRow;
  byRange: Map<MemberReportRangeKey, MemberReportUrlSnapshotRow>;
}> {
  const groups = new Map<string, MemberReportUrlSnapshotRow[]>();
  for (const row of urls) {
    const rows = groups.get(row.content_url_id) ?? [];
    rows.push(row);
    groups.set(row.content_url_id, rows);
  }
  return [...groups.values()]
    .map((rows) => ({
      anchor: RANGE_KEYS.map((key) => rows.find((row) => row.range_key === key)).find(Boolean) ?? rows[0],
      byRange: new Map(rows.map((row) => [row.range_key, row])),
    }))
    .sort((a, b) => {
      const project = a.anchor.project.localeCompare(b.anchor.project);
      if (project !== 0) return project;
      const url = a.anchor.url.localeCompare(b.anchor.url);
      if (url !== 0) return url;
      return a.anchor.content_url_id.localeCompare(b.anchor.content_url_id);
    });
}

function applyBaseStyle(sheet: XlsxSheet): void {
  sheet.gridLinesVisible(false);
  sheet.usedRange().style({ fontFamily: "Arial", verticalAlignment: "center" });
}

function applyHeaderStyle(sheet: XlsxSheet, range: string): void {
  sheet.range(range).style({
    fill: "1F2937",
    fontColor: "FFFFFF",
    bold: true,
    horizontalAlignment: "center",
    verticalAlignment: "center",
    wrapText: true,
    border: "thin",
    borderColor: "FFFFFF",
  });
}

export async function serializeMemberReportXlsx(
  snapshot: CompleteMemberReportSnapshot,
): Promise<Uint8Array> {
  const workbook = await xlsxPopulate.fromBlankAsync();
  const summary = workbook.sheet("Sheet1").name("Summary");
  const details = workbook.addSheet("URL details");
  const reportMonth = String(snapshot.report.report_month).slice(0, 7);
  const summaries = summaryIndex(snapshot.summaries);

  summary.cell("A2").value("Member performance report").style({ fontFamily: "Arial", fontSize: 14, bold: true, fontColor: "111827" });
  summary.range("A3:E4").value([
    ["Member", safeText(snapshot.report.member_name), "Report month", reportMonth, ""],
    ["Email", safeText(snapshot.report.member_email), "Snapshot completed", isoTimestamp(snapshot.report.completed_at ?? snapshot.report.created_at), ""],
  ]);
  summary.range("A3:A4").style({ bold: true, fill: "E5E7EB" });
  summary.range("C3:C4").style({ bold: true, fill: "E5E7EB" });
  summary.range("A6:D6").value([["Metric", ...RANGE_KEYS.map((key) => RANGE_LABELS[key])]]);
  applyHeaderStyle(summary, "A6:D6");
  summary.row(6).height(28);

  for (const [index, metric] of SUMMARY_METRICS.entries()) {
    const row = index + 7;
    summary.cell(`A${row}`).value(metric.label).style({ fontColor: "374151", bold: metric.label === "KPI score" });
    for (const [column, rangeKey] of RANGE_KEYS.entries()) {
      const value = summaries.get(rangeKey);
      const cell = summary.cell(row, column + 2);
      const metricValue = value ? metric.value(value) : null;
      cell.value(typeof metricValue === "string" ? metricValue : numberOrNull(metricValue));
      if (metric.numberFormat) cell.style("numberFormat", metric.numberFormat);
      cell.style({ horizontalAlignment: typeof metricValue === "string" ? "left" : "right" });
    }
  }
  summary.range(`A7:D${SUMMARY_METRICS.length + 6}`).style({ bottomBorder: "thin", bottomBorderColor: "E5E7EB" });
  summary.column("A").width(25);
  summary.column("B").width(18);
  summary.column("C").width(18);
  summary.column("D").width(18);
  summary.column("E").width(30);
  summary.freezePanes(1, 6);
  applyBaseStyle(summary);

  details.cell("A2").value("URL details").style({ fontFamily: "Arial", fontSize: 14, bold: true, fontColor: "111827" });
  details.range("A3:E3").value([["Member", safeText(snapshot.report.member_name), "Report month", reportMonth, "Snapshot completed"]]);
  details.range("A4:E4").value([["Email", safeText(snapshot.report.member_email), "", "", isoTimestamp(snapshot.report.completed_at ?? snapshot.report.created_at)]]);
  details.range("A3:A4").style({ bold: true, fill: "E5E7EB" });
  details.range("C3:C4").style({ bold: true, fill: "E5E7EB" });
  details.range("E3:E4").style({ bold: true, fill: "E5E7EB" });
  details.range("A6:E6").value([["Range", "Current start", "Current end", "Previous start", "Previous end"]]);
  applyHeaderStyle(details, "A6:E6");
  const rangeMetadata = RANGE_KEYS.map((rangeKey) => {
    const value = summaries.get(rangeKey);
    return [
      RANGE_LABELS[rangeKey],
      formatDate(value?.start_date),
      formatDate(value?.end_date),
      formatDate(value?.previous_start_date),
      formatDate(value?.previous_end_date),
    ];
  });
  details.range("A7:E9").value(rangeMetadata);
  details.range("A11:BB11").value([URL_HEADERS]);
  applyHeaderStyle(details, "A11:BB11");
  details.row(11).height(42);

  const detailRows = groupedUrls(snapshot.urls).map(({ anchor, byRange }) => [
    safeText(anchor.content_url_id),
    safeText(anchor.project),
    safeText(anchor.url),
    safeText(anchor.work_type),
    dateValue(anchor.worked_at),
    dateValue(anchor.first_worked_at),
    dateValue(anchor.published_at),
    anchor.kpi_excluded,
    safeText(anchor.kpi_excluded_reason),
    ...RANGE_KEYS.flatMap((rangeKey) => {
      const value = byRange.get(rangeKey);
      return [
        numberOrNull(value?.clicks),
        numberOrNull(value?.impressions),
        numberOrNull(value?.ctr),
        numberOrNull(value?.position),
        numberOrNull(value?.previous_clicks),
        numberOrNull(value?.previous_impressions),
        numberOrNull(value?.previous_ctr),
        numberOrNull(value?.previous_position),
        numberOrNull(value?.click_delta),
        numberOrNull(value?.click_growth_pct),
        numberOrNull(value?.impression_delta),
        numberOrNull(value?.impression_growth_pct),
        safeText(value?.growth_status),
        safeText(value?.data_status),
        safeText(value?.error_message),
      ];
    }),
  ]);

  if (detailRows.length > 0) {
    const lastRow = detailRows.length + 11;
    details.range(`A12:BB${lastRow}`).value(detailRows);
    details.range(`E12:G${lastRow}`).style("numberFormat", "yyyy-mm-dd");
    for (const rangeKeyIndex of RANGE_KEYS.keys()) {
      const startColumn = 10 + rangeKeyIndex * 15;
      details.range(`${columnName(startColumn)}12:${columnName(startColumn + 1)}${lastRow}`).style("numberFormat", "#,##0");
      details.range(`${columnName(startColumn + 2)}12:${columnName(startColumn + 2)}${lastRow}`).style("numberFormat", "0.0%");
      details.range(`${columnName(startColumn + 3)}12:${columnName(startColumn + 3)}${lastRow}`).style("numberFormat", "0.0");
      details.range(`${columnName(startColumn + 4)}12:${columnName(startColumn + 5)}${lastRow}`).style("numberFormat", "#,##0");
      details.range(`${columnName(startColumn + 6)}12:${columnName(startColumn + 6)}${lastRow}`).style("numberFormat", "0.0%");
      details.range(`${columnName(startColumn + 7)}12:${columnName(startColumn + 7)}${lastRow}`).style("numberFormat", "0.0");
      details.range(`${columnName(startColumn + 8)}12:${columnName(startColumn + 8)}${lastRow}`).style("numberFormat", "#,##0;[Red]-#,##0");
      details.range(`${columnName(startColumn + 9)}12:${columnName(startColumn + 9)}${lastRow}`).style("numberFormat", "0.0\"%\";[Red]-0.0\"%\"");
      details.range(`${columnName(startColumn + 10)}12:${columnName(startColumn + 10)}${lastRow}`).style("numberFormat", "#,##0;[Red]-#,##0");
      details.range(`${columnName(startColumn + 11)}12:${columnName(startColumn + 11)}${lastRow}`).style("numberFormat", "0.0\"%\";[Red]-0.0\"%\"");
    }
    details.autoFilter(details.range(`A11:BB${lastRow}`));
  }

  const widths = [36, 24, 50, 14, 12, 14, 12, 12, 26, ...Array(45).fill(14)];
  widths.forEach((width, index) => details.column(index + 1).width(width));
  details.freezePanes(3, 11);
  applyBaseStyle(details);

  const output = await workbook.outputAsync();
  return new Uint8Array(output as ArrayBuffer);
}
