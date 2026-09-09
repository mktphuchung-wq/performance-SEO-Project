import { listProjectRollups } from "@/lib/repositories/rollups";
import { runJson } from "@/lib/api/route-response";
import { readSelectableRange } from "@/lib/api/ranges";

export async function GET(req: Request) {
  return runJson("GET /api/admin/projects", async () => ({ rows: await listProjectRollups(readSelectableRange(req)) }));
}
