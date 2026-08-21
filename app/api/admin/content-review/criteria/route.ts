import { NextResponse } from "next/server";
import { createCriterion, listCriteria } from "@/lib/repositories/content-review";

// Everything under /api/admin is already gated on token.isAdmin by proxy.ts, so
// no route here repeats that check — see the matcher in proxy.ts.

export async function GET() {
  const criteria = await listCriteria();
  return NextResponse.json({ criteria });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

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

  const criterion = await createCriterion({ name, weight });
  return NextResponse.json({ criterion });
}
