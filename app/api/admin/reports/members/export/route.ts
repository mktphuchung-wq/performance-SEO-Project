import {
  ApiRouteError,
  jsonError,
} from "@/lib/api/route-response";
import { getCompleteMemberReportSnapshotForMember } from "@/lib/repositories/member-report-snapshots";
import {
  MEMBER_REPORT_MONTH_RE,
  memberReportFilename,
  memberReportXlsxFilename,
  serializeMemberReportCsv,
} from "@/lib/reports/member-csv";
import { serializeMemberReportXlsx } from "@/lib/reports/member-xlsx";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const month = url.searchParams.get("month") ?? "";
    const memberName = url.searchParams.get("memberName")?.trim() || null;
    const memberEmail = url.searchParams.get("memberEmail")?.trim().toLowerCase() || null;
    const format = url.searchParams.get("format") ?? "csv";
    if (!MEMBER_REPORT_MONTH_RE.test(month)) {
      throw new ApiRouteError(400, "INVALID_REPORT_MONTH", "The report month must be in YYYY-MM format.");
    }
    if (!memberName && !memberEmail) {
      throw new ApiRouteError(400, "MEMBER_REQUIRED", "A member name or email is required.");
    }
    if (format !== "csv" && format !== "xlsx") {
      throw new ApiRouteError(400, "INVALID_EXPORT_FORMAT", "The export format must be csv or xlsx.");
    }
    const snapshot = await getCompleteMemberReportSnapshotForMember({ memberName, memberEmail }, month);
    if (!snapshot) {
      throw new ApiRouteError(404, "REPORT_SNAPSHOT_NOT_FOUND", "Report snapshot is not available for this member and month.");
    }
    if (snapshot.report.completion_state !== "complete") {
      throw new ApiRouteError(409, "REPORT_SNAPSHOT_INCOMPLETE", "Report snapshot is still being generated.");
    }
    if (snapshot.urls.length === 0) {
      throw new ApiRouteError(409, "REPORT_SNAPSHOT_EMPTY", "Report snapshot contains no URL rows to export.");
    }
    if (format === "xlsx") {
      const xlsx = await serializeMemberReportXlsx(snapshot);
      return new Response(Uint8Array.from(xlsx).buffer, {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${memberReportXlsxFilename(snapshot.report.member_name, month)}"`,
        },
      });
    }

    const csv = serializeMemberReportCsv(snapshot);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${memberReportFilename(snapshot.report.member_name, month)}"`,
      },
    });
  } catch (unknownError) {
    const error = unknownError instanceof Error ? unknownError : new Error("Unknown route failure");
    if (error instanceof ApiRouteError) {
      return jsonError(error.status, error.code, error.message);
    }
    return jsonError(500, "INTERNAL_ERROR", "Could not load data. Please try again.");
  }
}
