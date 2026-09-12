import {
  ApiRouteError,
  jsonError,
} from "@/lib/api/route-response";
import { getCompleteMemberReportSnapshot } from "@/lib/repositories/member-report-snapshots";
import {
  MEMBER_REPORT_MONTH_RE,
  memberReportFilename,
  serializeMemberReportCsv,
} from "@/lib/reports/member-csv";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const month = url.searchParams.get("month") ?? "";
    const memberEmail = url.searchParams.get("memberEmail") ?? "";
    if (!MEMBER_REPORT_MONTH_RE.test(month)) {
      throw new ApiRouteError(400, "INVALID_REPORT_MONTH", "The report month must be in YYYY-MM format.");
    }
    if (!memberEmail.trim()) {
      throw new ApiRouteError(400, "MEMBER_EMAIL_REQUIRED", "A member email is required.");
    }
    const snapshot = await getCompleteMemberReportSnapshot(memberEmail.trim().toLowerCase(), month);
    if (!snapshot) {
      throw new ApiRouteError(404, "REPORT_SNAPSHOT_NOT_FOUND", "Report snapshot is not available for this member and month.");
    }
    if (snapshot.report.completion_state !== "complete") {
      throw new ApiRouteError(409, "REPORT_SNAPSHOT_INCOMPLETE", "Report snapshot is still being generated.");
    }
    if (snapshot.urls.length === 0) {
      throw new ApiRouteError(409, "REPORT_SNAPSHOT_EMPTY", "Report snapshot contains no URL rows to export.");
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