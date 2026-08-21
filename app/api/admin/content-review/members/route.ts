import { NextResponse } from "next/server";
import { listDistinctMembers } from "@/lib/repositories/content-urls";
import { listMemberAliases } from "@/lib/repositories/member-aliases";
import { listDistinctBatchMembers } from "@/lib/repositories/content-review";

/**
 * Names for the member picker, written the way the Sheet writes them — that is
 * the identity content_review_batches is keyed on.
 *
 * Three sources, merged: whoever currently owns URLs, whoever has an alias, and
 * whoever already has a batch. The last one matters most: a member who left the
 * URL sheet still has months on record, and dropping them from the list would
 * make those months unreachable.
 */
export async function GET() {
  const [fromUrls, aliases, fromBatches] = await Promise.all([
    listDistinctMembers(),
    listMemberAliases(),
    listDistinctBatchMembers(),
  ]);

  const memberNames = [
    ...new Set([...fromUrls, ...aliases.map((alias) => alias.member_name), ...fromBatches]),
  ]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  return NextResponse.json({ memberNames });
}
