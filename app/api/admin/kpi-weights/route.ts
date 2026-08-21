import { NextResponse } from "next/server";
import {
  KPI_STRATEGY_PRESETS,
  normalizeWeights,
  strategyForWeights,
  validateWeights,
  type KpiPeriodWeights,
  type KpiStrategy,
} from "@/lib/performance/composite-score";
import { listDistinctMembers } from "@/lib/repositories/content-urls";
import { getCompositeKpiSettings, updateKpiSettings } from "@/lib/repositories/kpi-settings";
import {
  deleteMemberKpiWeights,
  listMemberKpiWeights,
  upsertMemberKpiWeights,
} from "@/lib/repositories/member-kpi-weights";

/**
 * The Official KPI period mix — team default plus per-member strategies.
 *
 * Only the weights are configurable. The three periods themselves, and the fact
 * that a missing one is renormalized rather than zeroed, are not settings: they
 * are what makes two members' KPIs comparable at all.
 */
export async function GET() {
  const [settings, profiles, memberNames] = await Promise.all([
    getCompositeKpiSettings(),
    listMemberKpiWeights(),
    listDistinctMembers(),
  ]);

  return NextResponse.json({
    defaultWeights: settings.defaultWeights,
    defaultStrategy: strategyForWeights(settings.defaultWeights),
    trendTolerance: settings.trendTolerance,
    profiles,
    memberNames,
    presets: KPI_STRATEGY_PRESETS,
  });
}

const STRATEGIES: KpiStrategy[] = ["balanced", "momentum", "sustainability", "custom"];

/**
 * Reads a mix out of a request body. Percentages are accepted as well as
 * fractions — the admin form is in percent and "50 / 30 / 20" should not have to
 * be typed as "0.5 / 0.3 / 0.2" — then normalized so the stored row sums to 1
 * exactly. A body that names a preset needs no numbers at all.
 */
function weightsFromBody(body: Record<string, unknown>): KpiPeriodWeights | { error: string } {
  const strategy = body.strategy as KpiStrategy | undefined;
  if (strategy && strategy !== "custom") {
    const preset = KPI_STRATEGY_PRESETS[strategy as Exclude<KpiStrategy, "custom">];
    if (!preset) return { error: `Unknown strategy: ${strategy}` };
    return { ...preset };
  }

  const raw = {
    last_1_month: Number(body.weight1m),
    last_3_months: Number(body.weight3m),
    last_6_months: Number(body.weight6m),
  };
  for (const [key, value] of Object.entries(raw)) {
    if (!Number.isFinite(value)) return { error: `${key} must be a number` };
    if (value < 0) return { error: `${key} must not be negative` };
  }

  const sum = raw.last_1_month + raw.last_3_months + raw.last_6_months;
  if (!(sum > 0)) return { error: "at least one period must carry weight" };

  const weights = normalizeWeights(raw);
  const error = validateWeights(weights);
  return error ? { error } : weights;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const strategy = (body.strategy as KpiStrategy | undefined) ?? "custom";
  if (!STRATEGIES.includes(strategy)) {
    return NextResponse.json({ error: `strategy must be one of ${STRATEGIES.join(", ")}` }, { status: 400 });
  }

  const weights = weightsFromBody(body);
  if ("error" in weights) {
    return NextResponse.json({ error: weights.error }, { status: 400 });
  }

  const memberName = String(body.memberName ?? "").trim();

  // No member named → this is the team default every member without their own
  // strategy is graded on.
  if (!memberName) {
    const patch = {
      kpi_weight_1m: weights.last_1_month,
      kpi_weight_3m: weights.last_3_months,
      kpi_weight_6m: weights.last_6_months,
    } as Parameters<typeof updateKpiSettings>[0];

    if (body.trendTolerance !== undefined && body.trendTolerance !== null && body.trendTolerance !== "") {
      const tolerance = Number(body.trendTolerance);
      if (!(Number.isFinite(tolerance) && tolerance >= 0 && tolerance <= 50)) {
        return NextResponse.json({ error: "trendTolerance must be between 0 and 50" }, { status: 400 });
      }
      patch.trend_tolerance = tolerance;
    }

    await updateKpiSettings(patch);
    return NextResponse.json({ ok: true, scope: "default", weights });
  }

  await upsertMemberKpiWeights({
    memberName,
    // A custom mix that happens to match a preset is stored under the preset's
    // name, so the UI shows what it is rather than "custom".
    strategy: strategy === "custom" ? strategyForWeights(weights) : strategy,
    weights,
    note: body.note === undefined || body.note === null ? null : String(body.note).trim() || null,
  });

  return NextResponse.json({ ok: true, scope: "member", memberName, weights });
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const memberName = searchParams.get("memberName");
  if (!memberName) {
    return NextResponse.json({ error: "memberName is required" }, { status: 400 });
  }
  await deleteMemberKpiWeights(memberName);
  return NextResponse.json({ ok: true });
}
