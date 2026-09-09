import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { getMemberScoreByEmail } from "@/lib/repositories/kpi-score-rollups";
import { ApiRouteError, runJson } from "@/lib/api/route-response";
import { readSelectableRange } from "@/lib/api/ranges";

export async function GET(req: Request) {
  return runJson("GET /api/me/kpi", async () => {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) throw new ApiRouteError(401, "UNAUTHORIZED", "Please sign in to continue.");
    return { score: await getMemberScoreByEmail(session.user.email, readSelectableRange(req)) };
  });
}
