import { NextResponse } from "next/server";
import { copyCriteria, listCriteria } from "@/lib/repositories/content-review";

/**
 * Sets a new member up by cloning someone else's checklist.
 *
 * The copy is a duplicate, not a link. Two members who were set up from the same
 * source drift apart the moment either one is edited, which is what per-member
 * checklists are for — this route only saves the typing on day one.
 *
 * Criteria the target already has, by name, are left alone. Copying onto a
 * half-built checklist should fill in the gaps, not overwrite a weight someone
 * has already tuned.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const fromMember = String(body.fromMember ?? "").trim();
  const toMember = String(body.toMember ?? "").trim();

  if (!fromMember || !toMember) {
    return NextResponse.json({ error: "fromMember and toMember are both required" }, { status: 400 });
  }
  if (fromMember === toMember) {
    return NextResponse.json({ error: "Pick a different member to copy from" }, { status: 400 });
  }

  const source = await listCriteria(fromMember, false);
  if (source.length === 0) {
    return NextResponse.json({ error: `${fromMember} has no active criteria to copy.` }, { status: 400 });
  }

  const copied = await copyCriteria(fromMember, toMember);
  const criteria = await listCriteria(toMember);

  return NextResponse.json({
    copied,
    skipped: source.length - copied,
    memberName: toMember,
    criteria,
  });
}
