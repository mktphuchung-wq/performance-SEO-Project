import { ApiRouteError } from "@/lib/api/route-response";
import { DEFAULT_RANGE_KEY, SELECTABLE_RANGE_KEYS, type RangeKey } from "@/lib/ranges";

export function readSelectableRange(req: Request): RangeKey {
  const requested = new URL(req.url).searchParams.get("range");
  if (!requested) return DEFAULT_RANGE_KEY;
  if ((SELECTABLE_RANGE_KEYS as string[]).includes(requested)) return requested as RangeKey;
  throw new ApiRouteError(400, "INVALID_RANGE", "The selected date range is invalid.");
}
