import { getServerSession } from "next-auth/next";
import { ApiRouteError, runJson } from "@/lib/api/route-response";
import { authOptions } from "@/lib/auth";
import { getCompleteMemberReportSnapshot } from "@/lib/repositories/member-report-snapshots";
import {
  generateMemberReport,
  MemberReportError,
  toMemberReportReadDto,
} from "@/lib/reports/member-report";
import { MEMBER_REPORT_MONTH_RE } from "@/lib/reports/member-csv";

function readReportQuery(url: URL): { month: string; memberEmail: string } {
  const month = url.searchParams.get("month") ?? "";
  const memberEmail = url.searchParams.get("memberEmail") ?? "";
  if (!MEMBER_REPORT_MONTH_RE.test(month)) {
    throw new ApiRouteError(400, "INVALID_REPORT_MONTH", "The report month must be in YYYY-MM format.");
  }
  if (!memberEmail.trim()) {
    throw new ApiRouteError(400, "MEMBER_EMAIL_REQUIRED", "A member email is required.");
  }
  return { month, memberEmail };
}

function mapMemberReportError(error: MemberReportError): ApiRouteError {
  switch (error.code) {
    case "MEMBER_NOT_FOUND":
      return new ApiRouteError(404, error.code, error.message);
    case "MEMBER_IDENTITY_AMBIGUOUS":
      return new ApiRouteError(409, error.code, error.message);
    case "HISTORICAL_GSC_UNAVAILABLE":
      return new ApiRouteError(409, error.code, error.message);
    case "INVALID_REPORT_MONTH":
    case "INCOMPLETE_REPORT_MONTH":
      return new ApiRouteError(400, error.code, error.message);
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  return runJson("GET /api/admin/reports/members", async () => {
    const { month, memberEmail } = readReportQuery(url);
    const snapshot = await getCompleteMemberReportSnapshot(memberEmail.trim().toLowerCase(), month);
    if (!snapshot) {
      throw new ApiRouteError(404, "REPORT_SNAPSHOT_NOT_FOUND", "Report snapshot is not available for this member and month.");
    }
    if (snapshot.report.completion_state !== "complete") {
      throw new ApiRouteError(409, "REPORT_SNAPSHOT_INCOMPLETE", "Report snapshot is still being generated.");
    }
    return toMemberReportReadDto(snapshot);
  });
}

export async function POST(req: Request) {
  return runJson("POST /api/admin/reports/members", async () => {
    const session = await getServerSession(authOptions);
    if (!session?.accessToken) {
      throw new ApiRouteError(401, "GOOGLE_AUTH_REQUIRED", "Google authentication is required.");
    }
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new ApiRouteError(400, "INVALID_BODY", "The request body must be valid JSON.");
    }
    if (!body || typeof body !== "object") {
      throw new ApiRouteError(400, "INVALID_BODY", "The request body must be an object.");
    }
    const { month, memberEmail } = body as {
      month?: unknown;
      memberEmail?: unknown;
    };
    if (typeof month !== "string" || !MEMBER_REPORT_MONTH_RE.test(month)) {
      throw new ApiRouteError(400, "INVALID_REPORT_MONTH", "The report month must be in YYYY-MM format.");
    }
    if (typeof memberEmail !== "string" || !memberEmail.trim()) {
      throw new ApiRouteError(400, "MEMBER_EMAIL_REQUIRED", "A member email is required.");
    }
    try {
      const { snapshot, created } = await generateMemberReport({
        accessToken: session.accessToken,
        reportMonth: month,
        memberEmail,
      });
      return { ...toMemberReportReadDto(snapshot), created };
    } catch (error) {
      if (error instanceof MemberReportError) {
        throw mapMemberReportError(error);
      }
      throw error;
    }
  });
}