import { listDistinctMembers } from "@/lib/repositories/content-urls";
import { listMemberAliases } from "@/lib/repositories/member-aliases";
import { listDistinctBatchMembers } from "@/lib/repositories/content-review";

/**
 * Names for anything Content Review keys on, written the way the Sheet writes
 * them — that is the identity content_review_batches and content_review_criteria
 * both store.
 *
 * Three sources, merged: whoever currently owns URLs, whoever has an alias, and
 * whoever already has a batch. The last one matters most: a member who left the
 * URL sheet still has months on record, and dropping them from the list would
 * make those months unreachable and quietly remove them from the summary tables.
 *
 * Shared between the member picker and the summary endpoint on purpose — a
 * member the picker can review has to be a member the summary has a row for, or
 * one screen would show someone the other cannot explain.
 */
export async function listReviewableMemberNames(): Promise<string[]> {
  const [fromUrls, aliases, fromBatches] = await Promise.all([
    listDistinctMembers(),
    listMemberAliases(),
    listDistinctBatchMembers(),
  ]);

  return [...new Set([...fromUrls, ...aliases.map((alias) => alias.member_name), ...fromBatches])]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}
