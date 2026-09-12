import type {
  CompleteMemberReportSnapshot,
  MemberReportRangeKey,
  MemberReportSummarySnapshotRow,
  MemberReportUrlSnapshotRow,
} from "@/lib/repositories/member-report-snapshots";

export const MEMBER_REPORT_MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const RANGE_KEYS: MemberReportRangeKey[] = [
  "last_1_month",
  "last_3_months",
  "last_6_months",
];

const RANGE_SUFFIX: Record<MemberReportRangeKey, string> = {
  last_1_month: "1m",
  last_3_months: "3m",
  last_6_months: "6m",
};

function slug(name: string): string {
  const normalized = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return normalized
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function memberReportFilename(
  memberName: string,
  reportMonth: string,
): string {
  return `seo-member-report-${slug(memberName)}-${reportMonth}.csv`;
}

export function memberReportXlsxFilename(
  memberName: string,
  reportMonth: string,
): string {
  return `seo-member-report-${slug(memberName)}-${reportMonth}.xlsx`;
}

const NEEDS_QUOTE_RE = /[",\r\n]/;

function csvEscape(value: string): string {
  if (NEEDS_QUOTE_RE.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function neutralize(value: string): string {
  if (
    value.startsWith("=") ||
    value.startsWith("+") ||
    value.startsWith("-") ||
    value.startsWith("@")
  ) {
    return `'${value}`;
  }
  return value;
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  return csvEscape(neutralize(String(value)));
}

function isoTimestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return String(value);
}

function csvRow(values: unknown[]): string {
  return values.map(cell).join(",");
}

type UrlRow = MemberReportUrlSnapshotRow;

function buildSummaryIndex(
  summaries: MemberReportSummarySnapshotRow[],
): Map<MemberReportRangeKey, MemberReportSummarySnapshotRow> {
  const map = new Map<MemberReportRangeKey, MemberReportSummarySnapshotRow>();
  for (const s of summaries) {
    map.set(s.range_key, s);
  }
  return map;
}

function buildUrlIndex(
  urls: UrlRow[],
): Map<string, UrlRow[]> {
  const map = new Map<string, UrlRow[]>();
  for (const row of urls) {
    const existing = map.get(row.content_url_id);
    if (existing) {
      existing.push(row);
    } else {
      map.set(row.content_url_id, [row]);
    }
  }
  return map;
}

const IDENTITY_HEADERS = [
  "report_month",
  "snapshot_created_at",
  "member_name",
  "member_email",
  "content_url_id",
  "project",
  "url",
  "work_type",
  "worked_at",
  "first_worked_at",
  "published_at",
  "kpi_excluded",
  "kpi_excluded_reason",
];

function memberSummaryHeaders(prefix: string): string[] {
  return [
    `${prefix}_range_start`,
    `${prefix}_range_end`,
    `${prefix}_previous_range_start`,
    `${prefix}_previous_range_end`,
    `${prefix}_performance_score`,
    `${prefix}_clicks`,
    `${prefix}_impressions`,
    `${prefix}_ctr`,
    `${prefix}_position`,
    `${prefix}_previous_clicks`,
    `${prefix}_previous_impressions`,
    `${prefix}_click_delta`,
    `${prefix}_click_growth_pct`,
    `${prefix}_impression_delta`,
    `${prefix}_impression_growth_pct`,
    `${prefix}_url_count`,
    `${prefix}_urls_with_data`,
    `${prefix}_growing_urls`,
    `${prefix}_stable_urls`,
    `${prefix}_declining_urls`,
    `${prefix}_no_data_urls`,
  ];
}

function urlRangeHeaders(prefix: string): string[] {
  return [
    `${prefix}_range_start`,
    `${prefix}_range_end`,
    `${prefix}_previous_range_start`,
    `${prefix}_previous_range_end`,
    `${prefix}_clicks`,
    `${prefix}_impressions`,
    `${prefix}_ctr`,
    `${prefix}_position`,
    `${prefix}_previous_clicks`,
    `${prefix}_previous_impressions`,
    `${prefix}_previous_ctr`,
    `${prefix}_previous_position`,
    `${prefix}_click_delta`,
    `${prefix}_click_growth_pct`,
    `${prefix}_impression_delta`,
    `${prefix}_impression_growth_pct`,
    `${prefix}_trend`,
    `${prefix}_data_status`,
    `${prefix}_error_message`,
  ];
}

function summaryValues(
  summariesByRange: Map<MemberReportRangeKey, MemberReportSummarySnapshotRow>,
  rangeKey: MemberReportRangeKey,
): unknown[] {
  const s = summariesByRange.get(rangeKey);
  return [
    s?.start_date ?? null,
    s?.end_date ?? null,
    s?.previous_start_date ?? null,
    s?.previous_end_date ?? null,
    s?.kpi_score ?? null,
    s?.clicks ?? null,
    s?.impressions ?? null,
    s?.ctr ?? null,
    s?.position ?? null,
    s?.previous_clicks ?? null,
    s?.previous_impressions ?? null,
    s?.click_delta ?? null,
    s?.click_growth_pct ?? null,
    s?.impression_delta ?? null,
    s?.impression_growth_pct ?? null,
    s?.url_count ?? null,
    s?.urls_with_data ?? null,
    s?.growing_urls ?? null,
    s?.stable_urls ?? null,
    s?.declining_urls ?? null,
    s?.no_data_urls ?? null,
  ];
}

function urlValues(
  rows: UrlRow[],
  rangeKey: MemberReportRangeKey,
): unknown[] {
  const r = rows.find((u) => u.range_key === rangeKey) ?? null;
  return [
    r?.start_date ?? null,
    r?.end_date ?? null,
    r?.previous_start_date ?? null,
    r?.previous_end_date ?? null,
    r?.clicks ?? null,
    r?.impressions ?? null,
    r?.ctr ?? null,
    r?.position ?? null,
    r?.previous_clicks ?? null,
    r?.previous_impressions ?? null,
    r?.previous_ctr ?? null,
    r?.previous_position ?? null,
    r?.click_delta ?? null,
    r?.click_growth_pct ?? null,
    r?.impression_delta ?? null,
    r?.impression_growth_pct ?? null,
    r?.growth_status ?? null,
    r?.data_status ?? null,
    r?.error_message ?? null,
  ];
}

export function serializeMemberReportCsv(
  snapshot: CompleteMemberReportSnapshot,
): string {
  const reportMonth = snapshot.report.report_month.slice(0, 7);
  const memberName = snapshot.report.member_name;
  const memberEmail = snapshot.report.member_email;
  const createdAt = isoTimestamp(snapshot.report.created_at);

  const summaryIndex = buildSummaryIndex(snapshot.summaries);
  const urlIndex = buildUrlIndex(snapshot.urls);

  const urlEntries = [...urlIndex.entries()];
  urlEntries.sort((a, b) => {
    const aFirst = a[1][0];
    const bFirst = b[1][0];
    const projCmp = aFirst.project.localeCompare(bFirst.project);
    if (projCmp !== 0) return projCmp;
    const urlCmp = aFirst.url.localeCompare(bFirst.url);
    if (urlCmp !== 0) return urlCmp;
    return aFirst.content_url_id.localeCompare(bFirst.content_url_id);
  });

  const headers: string[] = [
    ...IDENTITY_HEADERS,
    ...RANGE_KEYS.flatMap((rk) => memberSummaryHeaders(`member_${RANGE_SUFFIX[rk]}`)),
    ...RANGE_KEYS.flatMap((rk) => urlRangeHeaders(`url_${RANGE_SUFFIX[rk]}`)),
  ];

  const lines: string[] = [headers.join(",")];

  for (const [, rows] of urlEntries) {
    const anchor = RANGE_KEYS.map((rangeKey) => rows.find((row) => row.range_key === rangeKey)).find(Boolean) ?? rows[0];
    const identity = [
      reportMonth,
      createdAt,
      memberName,
      memberEmail,
      anchor.content_url_id,
      anchor.project,
      anchor.url,
      anchor.work_type,
      anchor.worked_at,
      anchor.first_worked_at,
      anchor.published_at,
      anchor.kpi_excluded,
      anchor.kpi_excluded_reason,
    ];

    const memberValues = RANGE_KEYS.flatMap((rk) =>
      summaryValues(summaryIndex, rk),
    );

    const urlColumnValues = RANGE_KEYS.flatMap((rk) =>
      urlValues(rows, rk),
    );

    lines.push(csvRow([...identity, ...memberValues, ...urlColumnValues]));
  }

  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
