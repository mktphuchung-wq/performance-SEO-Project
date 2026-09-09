import { getServerSession } from "next-auth/next";
import { ApiRouteError, runJson } from "@/lib/api/route-response";
import { authOptions } from "@/lib/auth";
import { getMemberNameByEmail } from "@/lib/repositories/member-aliases";
import { listWarningsForMember } from "@/lib/repositories/url-kpi-warnings";

export async function GET() {
  return runJson("GET /api/me/warnings", async () => {
    const email = (await getServerSession(authOptions))?.user?.email;
    if (!email) throw new ApiRouteError(401, "UNAUTHORIZED", "Please sign in to continue.");
    const memberName = await getMemberNameByEmail(email);
    if (!memberName) return { memberName: null, rows: [] };
    return { memberName, rows: await listWarningsForMember(memberName) };
  });
}
