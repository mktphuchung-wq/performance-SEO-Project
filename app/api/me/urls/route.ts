import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { listPerformanceByMemberEmail } from "@/lib/repositories/performance-cache";
import { ApiRouteError, runJson } from "@/lib/api/route-response";
import { readSelectableRange } from "@/lib/api/ranges";

export async function GET(req: Request) {
  return runJson("GET /api/me/urls", async () => {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) throw new ApiRouteError(401, "UNAUTHORIZED", "Please sign in to continue.");
    const rangeKey = readSelectableRange(req);
    const rows = await listPerformanceByMemberEmail(session.user.email, rangeKey);
    return { rows };
  });
}
