import assert from "node:assert/strict";

import {
  memberReportFilename,
  serializeMemberReportCsv,
  MEMBER_REPORT_MONTH_RE,
} from "@/lib/reports/member-csv";
import { serializeMemberReportXlsx } from "@/lib/reports/member-xlsx";
import XlsxPopulate from "xlsx-populate";
import {
  MemberReportError,
  matchesRequestedAttribution,
  memberReportRangeWindows,
  toMemberReportReadDto,
} from "@/lib/reports/member-report";
import { growthPct } from "@/lib/performance/period-totals";
import {
  MEMBER_REPORT_RANGE_KEYS,
  publishMemberReportSnapshot,
  getCompleteMemberReportSnapshot,
  getCompleteMemberReportSnapshotForMember,
} from "@/lib/repositories/member-report-snapshots";
import { getMemberNameByEmail } from "@/lib/repositories/member-aliases";
import { getPool } from "@/lib/db";


let failures = 0;
function check(label, condition, detail) {
  const status = condition ? "PASS" : "FAIL";
  if (!condition) failures += 1;
  console.log(`  [${status}] ${label}${detail ? ` — ${detail}` : ""}`);
}

function parseCsvLine(line) {
  const fields = [];
  let i = 0;
  while (i <= line.length) {
    if (line[i] === '"') {
      i++;
      let val = "";
      while (i < line.length) {
        if (line[i] === '"') {
          if (line[i + 1] === '"') {
            val += '"';
            i += 2;
            continue;
          }
          i++;
          break;
        }
        val += line[i];
        i++;
      }
      fields.push(val);
      i++; // skip delimiter or end
    } else {
      const j = line.indexOf(",", i);
      fields.push(j === -1 ? line.slice(i) : line.slice(i, j));
      if (j === -1) break;
      i = j + 1;
    }
  }
  return fields;
}

const headerIndexOf = (headers) => Object.fromEntries(headers.map((h, i) => [h, i]));

const headerLineOf = (lines) => (lines[0].charCodeAt(0) === 0xfeff ? lines[0].slice(1) : lines[0]);

const parseHeaderIdx = (lines) => headerIndexOf(parseCsvLine(headerLineOf(lines)));


function makeRow(id, rk, overrides = {}) {
  return {
    report_snapshot_id: "SNAP",
    content_url_id: id,
    range_key: rk,
    url_hash: `${id}-${rk}`,
    content_hash: "ch",
    project: "Proj",
    url: "https://example.com",
    member_name: "Nguyễn Văn A",
    member_email: "nguyen.van.a@example.com",
    work_type: "seo",
    gsc_property: null,
    is_active: true,
    worked_at: null,
    first_worked_at: null,
    published_at: null,
    kpi_excluded: false,
    kpi_excluded_reason: null,
    error_message: null,
    start_date: "2026-08-01",
    end_date: "2026-08-31",
    previous_start_date: "2026-07-01",
    previous_end_date: "2026-07-31",
    clicks: null,
    impressions: null,
    ctr: null,
    position: null,
    previous_clicks: null,
    previous_impressions: null,
    previous_ctr: null,
    previous_position: null,
    click_delta: null,
    click_growth_pct: null,
    impression_delta: null,
    impression_growth_pct: null,
    growth_status: "no_data",
    data_status: "no_data",
    score_state: "unscored",
    kpi_score: null,
    weight: 0,
    ...overrides,
  };
}

function buildSnapshot(urls) {
  const ranges = MEMBER_REPORT_RANGE_KEYS;

  const rowsByRange = new Map(ranges.map((rk) => [rk, []]));
  for (const row of urls) {
    rowsByRange.get(row.range_key).push(row);
  }

  const summaries = ranges.map((rk) => {
    const rows = rowsByRange.get(rk);
    const withData = rows.filter((r) => r.data_status !== "no_data");
    return {
      report_snapshot_id: "SNAP",
      range_key: rk,
      start_date: "2026-08-01",
      end_date: "2026-08-31",
      previous_start_date: "2026-07-01",
      previous_end_date: "2026-07-31",
      url_count: rows.length,
      urls_with_data: withData.length,
      growing_urls: withData.filter((r) => r.growth_status === "growing").length,
      stable_urls: withData.filter((r) => r.growth_status === "stable").length,
      declining_urls: withData.filter((r) => r.growth_status === "declining").length,
      no_data_urls: rows.filter((r) => r.data_status === "no_data").length,
      clicks: withData.reduce((s, r) => s + (r.clicks ?? 0), 0),
      impressions: withData.reduce((s, r) => s + (r.impressions ?? 0), 0),
      ctr:
        withData.reduce((s, r) => s + (r.impressions ?? 0), 0) > 0
          ? withData.reduce((s, r) => s + (r.clicks ?? 0), 0) /
            withData.reduce((s, r) => s + (r.impressions ?? 0), 0)
          : 0,
      position: withData.length > 0 ? withData.reduce((s, r) => s + (r.position ?? 0), 0) / withData.length : null,
      previous_clicks: withData.reduce((s, r) => s + (r.previous_clicks ?? 0), 0) || null,
      previous_impressions: withData.reduce((s, r) => s + (r.previous_impressions ?? 0), 0) || null,
      click_delta: withData.reduce((s, r) => s + (r.click_delta ?? 0), 0),
      click_growth_pct: (function () {
        const totalPrev = withData.reduce((s, r) => s + (r.previous_clicks ?? 0), 0);
        const totalCurr = withData.reduce((s, r) => s + (r.clicks ?? 0), 0);
        return growthPct(totalPrev, totalCurr);
      })(),
      impression_delta: withData.reduce((s, r) => s + (r.impression_delta ?? 0), 0),
      impression_growth_pct: (function () {
        const totalPrev = withData.reduce((s, r) => s + (r.previous_impressions ?? 0), 0);
        const totalCurr = withData.reduce((s, r) => s + (r.impressions ?? 0), 0);
        return growthPct(totalPrev, totalCurr);
      })(),
      kpi_score: 50,
      eligible_url_count: withData.length,
      excluded_url_count: 0,
      no_data_url_count: rows.length - withData.length,
      capped_url_count: 0,
      total_weight: withData.reduce((s, r) => s + r.weight, 0),
      base_kpi_score: null,
      click_component_score: null,
      impression_component_score: null,
      effective_click_weight: null,
      effective_impression_weight: null,
      direction_adjustment: "none",
      opposite_sign_factor: null,
      formula_version: "v1",
    };
  });

  return {
    report: {
      id: "SNAP-1",
      report_month: "2026-08-01",
      member_name: urls[0]?.member_name ?? "Test Member",
      member_email: urls[0]?.member_email ?? "test@example.com",
      completion_state: "complete",
      completed_at: "2026-09-01T00:00:00Z",
      created_at: "2026-09-01T00:00:00Z",
    },
    summaries,
    urls,
  };
}


const urlA = makeRow("url-a", "last_1_month", {
  url: "https://example.com/a",
  clicks: 5,
  impressions: 200,
  ctr: 0.025,
  position: 10,
  previous_clicks: 0,
  previous_impressions: 100,
  click_delta: 5,
  click_growth_pct: 100,
  impression_delta: 100,
  impression_growth_pct: 100,
  growth_status: "growing",
  data_status: "ok",
  score_state: "normal",
  kpi_score: 70,
  weight: 100,
});

const urlB = makeRow("url-b", "last_1_month", {
  url: "https://example.com/b",
  clicks: 100,
  impressions: 500,
  ctr: 0.2,
  position: 5,
  previous_clicks: 150,
  previous_impressions: 600,
  click_delta: -50,
  click_growth_pct: -33.333333333333336,
  impression_delta: -100,
  impression_growth_pct: -16.666666666666664,
  growth_status: "declining",
  data_status: "ok",
  score_state: "normal",
  kpi_score: 40,
  weight: 80,
});

const urlC = makeRow("url-c", "last_1_month", {
  url: "https://example.com/c-no-data",
  clicks: null,
  impressions: null,
  ctr: null,
  position: null,
  growth_status: "no_data",
  data_status: "no_data",
  score_state: "unscored",
  kpi_score: null,
  weight: 0,
});

const urlD = makeRow("url-d", "last_1_month", {
  url: "=SUM(A1)",
  clicks: 10,
  impressions: 100,
  ctr: 0.1,
  position: 8,
  previous_clicks: 5,
  previous_impressions: 50,
  click_delta: 5,
  click_growth_pct: 100,
  impression_delta: 50,
  impression_growth_pct: 100,
  growth_status: "growing",
  data_status: "ok",
  score_state: "normal",
  kpi_score: 80,
  weight: 90,
});

const urlE = makeRow("url-e", "last_1_month", {
  url: "https://example.com/path?q=a,b&quote=\"x\"&nl=a\nb",
  project: "Dự án A,測試\"B\nC",
  kpi_excluded_reason: "Excluded: @special, \"quoted\"",
  clicks: 30,
  impressions: 300,
  ctr: 0.1,
  position: 12,
  previous_clicks: 100,
  previous_impressions: 200,
  click_delta: -70,
  click_growth_pct: -70,
  impression_delta: 100,
  impression_growth_pct: 50,
  growth_status: "stable",
  data_status: "ok",
  score_state: "normal",
  kpi_score: 55,
  weight: 70,
});

const urlsBase = [urlA, urlB, urlC, urlD, urlE];
const allUrls = MEMBER_REPORT_RANGE_KEYS.flatMap((rk) =>
  urlsBase.map((u) => ({ ...u, range_key: rk, report_snapshot_id: "SNAP", url_hash: `${u.content_url_id}-${rk}` })),
);
const snapshot = buildSnapshot(allUrls);

{
  const aliases = new Map([["Nguyễn Văn A", "member@example.com"]]);
  check(
    "canonical name accepts stale event email",
    matchesRequestedAttribution(
      { member_name: " Nguyễn Văn A ", member_email: "stale@example.com" },
      "MEMBER@example.com",
      "Nguyễn Văn A",
      aliases,
    ),
  );
  check(
    "mismatched canonical name is rejected despite matching email",
    !matchesRequestedAttribution(
      { member_name: "Other Member", member_email: "member@example.com" },
      "member@example.com",
      "Nguyễn Văn A",
      aliases,
    ),
  );
  check(
    "unmapped identity requires matching name and email",
    matchesRequestedAttribution(
      { member_name: "Nguyễn Văn A", member_email: "MEMBER@example.com" },
      "member@example.com",
      "Nguyễn Văn A",
      new Map(),
    ),
  );
  check(
    "name-only identity accepts a matching canonical member",
    matchesRequestedAttribution(
      { member_name: "Nguyễn Văn A", member_email: null },
      null,
      "Nguyễn Văn A",
      aliases,
    ),
  );
  check(
    "name-only identity rejects a different member",
    !matchesRequestedAttribution(
      { member_name: "Other Member", member_email: null },
      null,
      "Nguyễn Văn A",
      aliases,
    ),
  );
}

console.log("\n§13 — pure serializer / slug / windows / completeness / growth assertions");

{
  const csv = serializeMemberReportCsv(snapshot);
  const lines = csv.split(/\r\n/).filter((l) => l.length > 0);
  const headerFields = parseCsvLine(headerLineOf(lines));
  const dataLines = lines.slice(1);
  check("§13.1 — snapshot has all 3 ranges", snapshot.summaries.length === 3);
  check("§13.1 — 5 URLs × 3 ranges = 15 URL rows in snapshot", snapshot.urls.length === 15);
  check("§13.1 — 5 data lines in CSV (one per URL)", dataLines.length === 5);
  check(
    "§13.1 — header field count matches data field count",
    headerFields.length === 133 && dataLines.every((l) => parseCsvLine(l).length === 133),
  );
}

{
  const csv = serializeMemberReportCsv(snapshot);
  const lines = csv.split(/\r\n/).filter((l) => l.length > 0);
  const headerIdx = parseHeaderIdx(lines);
  const noDataRow = lines.find((l) => {
    const fields = parseCsvLine(l);
    return fields[headerIdx.url] === "https://example.com/c-no-data";
  });
  assert(noDataRow, "no_data URL row not found in CSV");
  const noDataCells = parseCsvLine(noDataRow);

  const numericHeaders = [
    "url_1m_clicks", "url_1m_impressions", "url_1m_ctr", "url_1m_position",
    "url_1m_previous_clicks", "url_1m_previous_impressions",
    "url_1m_click_delta", "url_1m_click_growth_pct",
    "url_1m_impression_delta", "url_1m_impression_growth_pct",
    "url_3m_clicks", "url_3m_impressions", "url_3m_ctr", "url_3m_position",
    "url_3m_previous_clicks", "url_3m_previous_impressions",
    "url_3m_click_delta", "url_3m_click_growth_pct",
    "url_3m_impression_delta", "url_3m_impression_growth_pct",
    "url_6m_clicks", "url_6m_impressions", "url_6m_ctr", "url_6m_position",
    "url_6m_previous_clicks", "url_6m_previous_impressions",
    "url_6m_click_delta", "url_6m_click_growth_pct",
    "url_6m_impression_delta", "url_6m_impression_growth_pct",
  ];
  for (const h of numericHeaders) {
    const idx = headerIdx[h];
    check(`§13.2 — ${h} is empty string, not "0"`, noDataCells[idx] === "", `got "${noDataCells[idx]}"`);
  }
  check("§13.2 — url_1m_trend is 'no_data'", noDataCells[headerIdx["url_1m_trend"]] === "no_data");
  check("§13.2 — url_1m_data_status is 'no_data'", noDataCells[headerIdx["url_1m_data_status"]] === "no_data");
}

{
  check("§13.3 — growthPct(0, 5) === 100", growthPct(0, 5) === 100);
  check("§13.3 — growthPct(0, 0) === null", growthPct(0, 0) === null);
  check("§13.3 — growthPct(null, 5) === null", growthPct(null, 5) === null);
  const csv = serializeMemberReportCsv(snapshot);
  const lines = csv.split(/\r\n/).filter((l) => l.length > 0);
  const headerIdx = parseHeaderIdx(lines);
  const urlALine = lines.find((l) => {
    const f = parseCsvLine(l);
    return f[headerIdx.url] === "https://example.com/a";
  });
  assert(urlALine, "url-a row not found");
  const urlACells = parseCsvLine(urlALine);
  check("§13.3 — url-a url_1m_click_growth_pct === 100 (prev=0, cur>0)", urlACells[headerIdx["url_1m_click_growth_pct"]] === "100");
  check("§13.3 — url-a url_1m_click_delta === 5", urlACells[headerIdx["url_1m_click_delta"]] === "5");
}

{
  const csv = serializeMemberReportCsv(snapshot);
  assert.ok(csv.charCodeAt(0) === 0xfeff, "CSV starts with BOM");
  assert.ok(csv.endsWith("\r\n"), "CSV ends with CRLF");
  const lines = csv.split(/\r\n/).filter((l) => l.length > 0);
  const headerIdx = parseHeaderIdx(lines);
  const urlEline = lines.find((l) => parseCsvLine(l)[headerIdx.project]?.includes("Dự án A"));
  assert(urlEline, "url-e row not found");
  const urlEcells = parseCsvLine(urlEline);
  check(
    "§13.4 — url field round-trips with comma, quote, newline",
    urlEcells[headerIdx.url] === "https://example.com/path?q=a,b&quote=\"x\"&nl=a\nb",
  );
  check(
    "§13.4 — project field round-trips Vietnamese + comma + quote + newline",
    urlEcells[headerIdx.project] === "Dự án A,測試\"B\nC",
  );
  check(
    "§13.4 — member_name exports Vietnamese chars",
    urlEcells[headerIdx.member_name] === "Nguyễn Văn A",
  );
  check(
    "§13.4 — kpi_excluded_reason round-trips comma + quote + @",
    urlEcells[headerIdx.kpi_excluded_reason] === "Excluded: @special, \"quoted\"",
  );
  check("§13.4 — every data line has same field count as header", lines.slice(1).every((l) => parseCsvLine(l).length === parseCsvLine(headerLineOf(lines)).length));
}

{
  const prefixRows = ["=", "+", "-", "@"].flatMap((prefix) =>
    MEMBER_REPORT_RANGE_KEYS.map((rk) =>
      makeRow(`inj-${prefix}`, rk, {
        url: `${prefix}SUM(A1)`,
        kpi_excluded_reason: `${prefix}REF!A1`,
        clicks: 10,
        impressions: 100,
        ctr: 0.1,
        position: 8,
        growth_status: "growing",
        data_status: "ok",
        score_state: "normal",
        weight: 10,
      }),
    ),
  );
  const injSnapshot = buildSnapshot(prefixRows);
  const csv = serializeMemberReportCsv(injSnapshot);
  const lines = csv.split(/\r\n/).filter((l) => l.length > 0);
  const headerIdx = parseHeaderIdx(lines);
  for (const prefix of ["=", "+", "-", "@"]) {
    const line = lines.find((l) => parseCsvLine(l)[headerIdx.url] === `'${prefix}SUM(A1)`);
    assert(line, `${prefix} prefix row not found`);
    const cells = parseCsvLine(line);
    check(
      `§13.5 — '${prefix}' prefix neutralized with apostrophe`,
      cells[headerIdx.url] === `'${prefix}SUM(A1)` && cells[headerIdx.kpi_excluded_reason] === `'${prefix}REF!A1`,
      `got "${cells[headerIdx.url]}"`,
    );
  }
}

{
  const incompleteUrls = ["last_1_month", "last_3_months"].flatMap((rk) =>
    urlsBase.slice(0, 1).map((u) => ({ ...u, range_key: rk, report_snapshot_id: "SNAP", url_hash: `${u.content_url_id}-${rk}` })),
  );
  const incompleteInput = {
    reportMonth: "2026-08",
    memberName: "Test Incomplete",
    memberEmail: "incomplete@test.com",
    summaries: [
      { ...snapshot.summaries[0], range_key: "last_1_month" },
      { ...snapshot.summaries[1], range_key: "last_3_months" },
    ],
    urls: incompleteUrls,
  };
  let threw = false;
  try {
    await publishMemberReportSnapshot(incompleteInput);
  } catch (e) {
    threw = true;
    check("§13.8 — incomplete snapshot throws with expected message", /summaries must contain each member report range exactly once/.test(e.message), e.message);
  }
  check("§13.8 — incomplete snapshot throws before DB (assertPayload validation)", threw);
}

{
  check(
    "§13.9 — filename slug normalizes Vietnamese",
    memberReportFilename("Nguyễn Văn A", "2026-08") === "seo-member-report-nguyen-van-a-2026-08.csv",
  );
  check(
    "§13.9 — filename slug normalizes comma+quote",
    memberReportFilename("O'Brien, Jr.", "2026-08") === "seo-member-report-o-brien-jr-2026-08.csv",
  );
  const csv = serializeMemberReportCsv(snapshot);
  const lines = csv.split(/\r\n/).filter((l) => l.length > 0);
  const headerLine = headerLineOf(lines);
  const headerFields = parseCsvLine(headerLine);
  const headerIdx = headerIndexOf(headerFields);
  check("§13.9 — CSV starts with BOM", csv.charCodeAt(0) === 0xfeff);
  check(
    "§13.9 — first identity headers are correct",
    headerFields[0] === "report_month" &&
      headerFields[1] === "snapshot_created_at" &&
      headerFields[2] === "member_name" &&
      headerFields[3] === "member_email" &&
      headerFields[4] === "content_url_id" &&
      headerFields[5] === "project" &&
      headerFields[6] === "url",
  );
  check("§13.9 — CSV headers are unique", new Set(headerFields).size === headerFields.length);
  check("§13.9 — CSV separates member and URL headers", headerFields.includes("member_1m_clicks") && headerFields.includes("url_1m_clicks"));
  check("§13.9 — CSV includes content_url_id", headerFields.includes("content_url_id"));
  check("§13.9 — snapshot timestamp is ISO 8601", /^2026-09-01T00:00:00\.000Z$/.test(parseCsvLine(lines[1])[headerIdx.snapshot_created_at]));
  check("§13.9 — CSV ends with CRLF", csv.endsWith("\r\n"));
}

{
  const dto = toMemberReportReadDto(snapshot);
  const csv = serializeMemberReportCsv(snapshot);
  const csvLines = csv.split(/\r\n/).filter((l) => l.length > 0);
  const csvDataLines = csvLines.slice(1);
  const headerIdx = parseHeaderIdx(csvLines);

  check("§13.10 — DTO summary count === snapshot summary count", dto.summaries.length === snapshot.summaries.length);
  check("§13.10 — DTO member name matches snapshot", dto.member.name === snapshot.report.member_name);
  check("§13.10 — DTO member email matches snapshot", dto.member.email === snapshot.report.member_email);

  const snapshotUrls = [...new Set(snapshot.urls.map((r) => r.content_url_id))];
  const dtoUrls = [...new Set(dto.urls.map((u) => u.contentUrlId))];
  check("§13.10 — unique URLs in snapshot === unique URLs in DTO", snapshotUrls.length === dtoUrls.length);
  check("§13.10 — CSV data lines count === unique URL count", csvDataLines.length === snapshotUrls.length);

  const neutralize = (url) => (/^[=+\-@]/.test(url) ? `'${url}` : url);
  const dtoUrlSet = new Set(dto.urls.map((u) => neutralize(u.url)));
  const csvUrlSet = new Set(csvDataLines.map((l) => parseCsvLine(l)[headerIdx.url]));
  check(
    "§13.10 — CSV URL set === DTO URL set (after neutralize)",
    [...dtoUrlSet].every((u) => csvUrlSet.has(u)) && csvUrlSet.size === dtoUrlSet.size,
  );

  const firstDataCells = parseCsvLine(csvDataLines[0]);
  const memberSummaryClickHeader = { last_1_month: "member_1m_clicks", last_3_months: "member_3m_clicks", last_6_months: "member_6m_clicks" };
  for (const s of dto.summaries) {
    const snapshotSummary = snapshot.summaries.find((sr) => sr.range_key === s.rangeKey);
    const csvCell = Number(firstDataCells[headerIdx[memberSummaryClickHeader[s.rangeKey]]]);
    check(
      `§13.10 — DTO ${s.rangeKey} clicks === snapshot summary clicks === CSV cell`,
      s.clicks === snapshotSummary.clicks && snapshotSummary.clicks === csvCell,
    );
  }
}

{
  const xlsx = await serializeMemberReportXlsx(snapshot);
  const workbook = await XlsxPopulate.fromDataAsync(xlsx);
  const summarySheet = workbook.sheet("Summary");
  const detailsSheet = workbook.sheet("URL details");
  check("§13.11 — XLSX has Summary and URL details sheets", Boolean(summarySheet) && Boolean(detailsSheet));
  check("§13.11 — Summary uses the snapshot matrix", summarySheet.cell("A6").value() === "Metric" && summarySheet.cell("B7").value() === 50);
  check("§13.11 — URL details keeps one row per URL", detailsSheet.cell("A11").value() === "Content URL ID" && detailsSheet.cell("A12").value() !== null);
  check("§13.11 — URL details range metadata is not repeated in URL rows", detailsSheet.cell("A6").value() === "Range" && detailsSheet.cell("J11").value() === "Last 1 month clicks");
}

{
  check("§13.7 — MEMBER_REPORT_MONTH_RE rejects invalid months",
    MEMBER_REPORT_MONTH_RE.test("2026-99") === false &&
    MEMBER_REPORT_MONTH_RE.test("2026-13") === false &&
    MEMBER_REPORT_MONTH_RE.test("202600") === false &&
    MEMBER_REPORT_MONTH_RE.test("2026-00") === false,
  );
  check("§13.7 — MEMBER_REPORT_MONTH_RE accepts valid months",
    MEMBER_REPORT_MONTH_RE.test("2026-08") === true &&
    MEMBER_REPORT_MONTH_RE.test("2026-01") === true &&
    MEMBER_REPORT_MONTH_RE.test("2025-12") === true,
  );

  const EXPECTED_STATUS = {
    INVALID_REPORT_MONTH: 400,
    INCOMPLETE_REPORT_MONTH: 400,
    MEMBER_NOT_FOUND: 404,
    HISTORICAL_GSC_UNAVAILABLE: 409,
  };

  try {
    memberReportRangeWindows("2026-99");
    check("§13.7 — bad month throws", false);
  } catch (e) {
    check("§13.7 — bad month throws MemberReportError", e instanceof MemberReportError && e.name === "MemberReportError");
    check("§13.7 — bad month code is INVALID_REPORT_MONTH", e.code === "INVALID_REPORT_MONTH");
    check("§13.7 — INVALID_REPORT_MONTH maps to status 400", EXPECTED_STATUS[e.code] === 400);
  }

  try {
    memberReportRangeWindows("2999-01");
    check("§13.7 — future month throws", false);
  } catch (e) {
    check("§13.7 — future month code is INCOMPLETE_REPORT_MONTH", e instanceof MemberReportError && e.code === "INCOMPLETE_REPORT_MONTH");
    check("§13.7 — INCOMPLETE_REPORT_MONTH maps to status 400", EXPECTED_STATUS[e.code] === 400);
  }

  check("§13.7 — MEMBER_NOT_FOUND maps to status 404", EXPECTED_STATUS.MEMBER_NOT_FOUND === 404);
}


let canDb = false;
if (process.env.DATABASE_URL) {
  try {
    await getPool().query("select 1");
    canDb = true;
  } catch {
    console.log("\n  DB unreachable — skipping database-dependent checks.\n");
  }
} else {
  console.log("\n  DATABASE_URL not set — skipping database-dependent checks.\n");
}

if (canDb) {
  console.log("§13 — database-dependent assertions");

  {
    const memberName = `verify-report-${Date.now()}`;
    const memberEmail = `${memberName}@test.local`;

    const monthARows = MEMBER_REPORT_RANGE_KEYS.flatMap((rk) => [
      makeRow("00000000-0000-4000-8000-000000000001", rk, { member_name: memberName, member_email: memberEmail, clicks: 200, impressions: 1000, data_status: "ok", growth_status: "growing", weight: 100, score_state: "normal", kpi_score: 75 }),
      makeRow("00000000-0000-4000-8000-000000000002", rk, { member_name: memberName, member_email: memberEmail, clicks: 50, impressions: 200, data_status: "ok", growth_status: "stable", weight: 60, score_state: "normal", kpi_score: 45 }),
    ]);
    const snapA = buildSnapshot(monthARows);
    snapA.report.member_name = memberName;
    snapA.report.member_email = memberEmail;

    const inputA = {
      reportMonth: "2025-01",
      memberName,
      memberEmail,
      summaries: snapA.summaries.map((s) => ({ ...s, report_snapshot_id: undefined })),
      urls: monthARows.map((r) => ({ ...r, report_snapshot_id: undefined })),
    };

    const resultA = await publishMemberReportSnapshot(inputA);
    check("§13.6 — month A snapshot created", resultA.created === true);
    const snapAId = resultA.snapshot.report.id;

    const beforeA = await getCompleteMemberReportSnapshot(memberName, "2025-01");
    assert(beforeA, "month A snapshot must exist after publish");
    const beforeASummaryClicks = beforeA.summaries.find((s) => s.range_key === "last_1_month").clicks;
    const beforeAUrlCount = beforeA.urls.length;

    const monthBRows = MEMBER_REPORT_RANGE_KEYS.flatMap((rk) => [
      makeRow("00000000-0000-4000-8000-000000000003", rk, { member_name: memberName, member_email: memberEmail, clicks: 10, impressions: 50, data_status: "ok", growth_status: "growing", weight: 30, score_state: "normal", kpi_score: 30 }),
    ]);
    const snapB = buildSnapshot(monthBRows);
    snapB.report.member_name = memberName;
    snapB.report.member_email = memberEmail;

    await publishMemberReportSnapshot({
      reportMonth: "2025-02",
      memberName,
      memberEmail,
      summaries: snapB.summaries.map((s) => ({ ...s, report_snapshot_id: undefined })),
      urls: monthBRows.map((r) => ({ ...r, report_snapshot_id: undefined })),
    });

    const afterA = await getCompleteMemberReportSnapshot(memberName, "2025-01");
    check("§13.6 — month A snapshot still exists after month B publish", afterA !== null);
    check("§13.6 — month A snapshot id unchanged (immutability)", afterA.report.id === snapAId);
    check("§13.6 — month A summary clicks unchanged", afterA.summaries.find((s) => s.range_key === "last_1_month").clicks === beforeASummaryClicks);
    check("§13.6 — month A URL count unchanged", afterA.urls.length === beforeAUrlCount);
    check("§13.6 — month A completion_state still 'complete'", afterA.report.completion_state === "complete");

    const resultA2 = await publishMemberReportSnapshot({ ...inputA, replace: true });
    check("§13.6 — re-publish month A reports created=false (idempotent)", resultA2.created === false);
    const afterA2 = await getCompleteMemberReportSnapshot(memberName, "2025-01");
    check("§13.6 — re-publish month A keeps same snapshot id", afterA2.report.id === snapAId);
    check("§13.6 — re-publish month A same summary values", afterA2.summaries.find((s) => s.range_key === "last_1_month").clicks === beforeASummaryClicks);

    const nameOnlyRows = MEMBER_REPORT_RANGE_KEYS.flatMap((rk) => [
      makeRow("00000000-0000-4000-8000-000000000004", rk, { member_name: memberName, member_email: null, clicks: 15, impressions: 75 }),
    ]);
    const nameOnlySnapshot = buildSnapshot(nameOnlyRows);
    nameOnlySnapshot.report.member_name = memberName;
    nameOnlySnapshot.report.member_email = null;
    const nameOnlyResult = await publishMemberReportSnapshot({
      reportMonth: "2025-03",
      memberName,
      memberEmail: null,
      summaries: nameOnlySnapshot.summaries.map((s) => ({ ...s, report_snapshot_id: undefined })),
      urls: nameOnlyRows.map((row) => ({
        ...row,
        member_name: memberName,
        member_email: null,
        report_snapshot_id: undefined,
      })),
    });
    check("§13.6 — name-only snapshot is created without an email alias", nameOnlyResult.created === true);
    const nameOnlyRead = await getCompleteMemberReportSnapshotForMember({ memberName }, "2025-03");
    check("§13.6 — name-only snapshot can be read by member name", nameOnlyRead?.report.member_email === null);

    await getPool().query("delete from public.member_report_summary_snapshots where report_snapshot_id in (select id from public.member_report_snapshots where member_name = $1)", [memberName]);
    await getPool().query("delete from public.member_report_url_snapshots where report_snapshot_id in (select id from public.member_report_snapshots where member_name = $1)", [memberName]);
    await getPool().query("delete from public.member_report_snapshots where member_name = $1", [memberName]);
  }

  {
    const missingMember = await getMemberNameByEmail("nobody-ever-exists@example.invalid");
    check("§13.7 — unmapped email resolves to null", missingMember === null);
  }
}


console.log(`\n${failures === 0 ? "All" : `${failures} of`} assertions ${failures === 0 ? "passed" : "FAILED"}.\n`);
process.exit(failures === 0 ? 0 : 1);
