import { NextResponse } from "next/server";
import { createCriterion, listCriteria } from "@/lib/repositories/content-review";

// Everything under /api/admin is already gated on token.isAdmin by proxy.ts, so
// no route here repeats that check — see the matcher in proxy.ts.

/**
 * One member's checklist. `member` is required rather than optional-with-a-
 * team-wide-fallback: since migration 008 there is no such thing as a team
 * checklist, and a route that answered without knowing whose list it was asked
 * for could only answer wrongly.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const memberName = (searchParams.get("member") ?? "").trim();
  if (!memberName) {
    return NextResponse.json({ error: "member is required" }, { status: 400 });
  }

  const criteria = await listCriteria(memberName);
  return NextResponse.json({ memberName, criteria });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const memberName = String(body.memberName ?? "").trim();
  if (!memberName) {
    return NextResponse.json({ error: "memberName is required" }, { status: 400 });
  }

  const name = String(body.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  // Weight is optional and defaults to 1 — a checklist where every item counts
  // the same is the normal case, not something an admin should have to type.
  let weight: number | undefined;
  if (body.weight !== undefined && body.weight !== null && body.weight !== "") {
    weight = Number(body.weight);
    if (!Number.isFinite(weight) || weight <= 0) {
      return NextResponse.json({ error: "weight must be greater than 0" }, { status: 400 });
    }
  }

  try {
    const criterion = await createCriterion({ memberName, name, weight });
    return NextResponse.json({ criterion });
  } catch (error) {
    // (member_name, name) is unique — the same criterion twice on one checklist
    // would give it double weight without anyone asking for that.
    if ((error as { code?: string }).code === "23505") {
      return NextResponse.json({ error: `${memberName} already has a criterion called "${name}".` }, { status: 409 });
    }
    throw error;
  }
}
