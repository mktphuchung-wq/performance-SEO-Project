// Arithmetic self-check for lib/performance/composite-score.ts — Layer 3.
//
// Same shape as verify-score.mjs: no database, no network, run against the real
// functions rather than a transcription of them.
//
//   node scripts/verify-composite-score.mjs
import {
  DEFAULT_TREND_TOLERANCE,
  KPI_STRATEGY_PRESETS,
  MEMBER_KPI_WEIGHTS,
  averageOfficialKpi,
  buildMemberCompositeKpi,
  computeOfficialKpi,
  computeTrend,
  normalizeWeights,
  strategyForWeights,
  validateWeights,
} from "../lib/performance/composite-score.ts";

let failures = 0;
function check(label, condition, detail) {
  const status = condition ? "PASS" : "FAIL";
  if (!condition) failures += 1;
  console.log(`  [${status}] ${label}${detail ? ` — ${detail}` : ""}`);
}

const show = (v) => (v === null || v === undefined ? "null" : String(v));

// --- The table the spec makes mandatory --------------------------------------
console.log("Official KPI + Trend — 25 / 50 / 25, tolerance 5");

const CASES = [
  { in: [80, 80, 80], kpi: 80.0, trend: "stable" },
  { in: [90, 75, 65], kpi: 76.25, trend: "improving" },
  { in: [60, 75, 85], kpi: 73.75, trend: "declining" },
  { in: [80, 60, 75], kpi: 68.75, trend: "recovering" },
  { in: [70, 85, 70], kpi: 77.5, trend: "cooling" },
  { in: [76, 74, 72], kpi: 74.0, trend: "stable" },
  { in: [80, 70, null], kpi: 73.33, trend: "improving" },
  { in: [80, null, null], kpi: 80.0, trend: "insufficient_data" },
  { in: [null, null, null], kpi: null, trend: "insufficient_data" },
  { in: [0, 0, 0], kpi: 0.0, trend: "stable" },
];

for (const testCase of CASES) {
  const [score1m, score3m, score6m] = testCase.in;
  const scores = { score1m, score3m, score6m };
  const { officialKpi } = computeOfficialKpi(scores);
  const trend = computeTrend(scores);
  const label = `1M=${show(score1m)} 3M=${show(score3m)} 6M=${show(score6m)}`;

  check(
    `${label} → KPI ${show(testCase.kpi)}`,
    officialKpi === testCase.kpi,
    `got ${show(officialKpi)}`,
  );
  check(`${label} → ${testCase.trend}`, trend === testCase.trend, `got ${trend}`);
}

// --- Missing periods renormalize, they do not zero ---------------------------
console.log("\nMissing data");
const partial = computeOfficialKpi({ score1m: 78, score3m: 72, score6m: null });
check("78 / 72 / null → 74 (not 55.5)", partial.officialKpi === 74, `got ${show(partial.officialKpi)}`);
check("coverage reported as 2", partial.availablePeriodCount === 2, `got ${partial.availablePeriodCount}`);

const none = computeOfficialKpi({ score1m: null, score3m: null, score6m: null });
check("no period → null, never 0", none.officialKpi === null, `got ${show(none.officialKpi)}`);

const zeroes = computeOfficialKpi({ score1m: 0, score3m: 0, score6m: 0 });
check("a real 0 stays 0", zeroes.officialKpi === 0 && zeroes.availablePeriodCount === 3);

// --- Bounds ------------------------------------------------------------------
console.log("\nBounds");
const extremes = [
  [100, 100, 100],
  [0, 100, 0],
  [100, 0, 100],
  [0, 0, 100],
];
for (const [a, b, c] of extremes) {
  const { officialKpi } = computeOfficialKpi({ score1m: a, score3m: b, score6m: c });
  check(`${a}/${b}/${c} stays inside 0–100`, officialKpi >= 0 && officialKpi <= 100, `got ${officialKpi}`);
}

// --- Tolerance ---------------------------------------------------------------
console.log("\nTrend tolerance");
check("default tolerance is 5", DEFAULT_TREND_TOLERANCE === 5, `got ${DEFAULT_TREND_TOLERANCE}`);
check(
  "76 / 74 / 72 is Stable at tolerance 5",
  computeTrend({ score1m: 76, score3m: 74, score6m: 72 }) === "stable",
);
check(
  "76 / 74 / 72 is Improving at tolerance 1",
  computeTrend({ score1m: 76, score3m: 74, score6m: 72, tolerance: 1 }) === "improving",
);
check(
  "two periods never produce Recovering",
  computeTrend({ score1m: 80, score3m: 60, score6m: null }) === "improving",
);
check(
  "two non-adjacent periods still read newest-first",
  computeTrend({ score1m: 60, score3m: null, score6m: 80 }) === "declining",
);

// --- Trend never touches the KPI ---------------------------------------------
console.log("\nTrend is diagnostic only");
const improving = buildMemberCompositeKpi({
  memberName: "A",
  memberEmail: null,
  score1m: 84,
  score3m: 73,
  score6m: 66,
});
const declining = buildMemberCompositeKpi({
  memberName: "B",
  memberEmail: null,
  score1m: 66,
  score3m: 73,
  score6m: 84,
});
check("A is Improving", improving.trend === "improving");
check("B is Declining", declining.trend === "declining");
check(
  "both KPIs are the plain weighted mean, unadjusted by direction",
  improving.officialKpi === 74 && declining.officialKpi === 74,
  `A=${improving.officialKpi} B=${declining.officialKpi}`,
);

// --- Personal strategy weights ------------------------------------------------
console.log("\nPersonal strategy weights");
const scores = { score1m: 90, score3m: 70, score6m: 50 };
const balanced = computeOfficialKpi(scores, MEMBER_KPI_WEIGHTS).officialKpi;
const momentum = computeOfficialKpi(scores, KPI_STRATEGY_PRESETS.momentum).officialKpi;
const sustain = computeOfficialKpi(scores, KPI_STRATEGY_PRESETS.sustainability).officialKpi;
console.log(`   balanced=${balanced} momentum=${momentum} sustainability=${sustain}`);
check("momentum rewards the recent months more", momentum > balanced);
check("sustainability rewards the older months more", sustain < balanced);

for (const [name, preset] of Object.entries(KPI_STRATEGY_PRESETS)) {
  check(`preset ${name} is a valid mix`, validateWeights(preset) === null, validateWeights(preset) ?? "");
  check(`preset ${name} round-trips through strategyForWeights`, strategyForWeights(preset) === name);
}

const uniform = { last_1_month: 1 / 3, last_3_months: 1 / 3, last_6_months: 1 / 3 };
check(
  "equal weights make Official KPI the plain mean",
  computeOfficialKpi({ score1m: 90, score3m: 60, score6m: 30 }, normalizeWeights(uniform)).officialKpi === 60,
);

const zeroSixMonth = { last_1_month: 0.5, last_3_months: 0.5, last_6_months: 0 };
const ignoring = computeOfficialKpi({ score1m: 80, score3m: 60, score6m: 0 }, zeroSixMonth);
check("a zero-weight period contributes nothing", ignoring.officialKpi === 70, `got ${ignoring.officialKpi}`);
check("and is not counted as contributing", ignoring.contributingPeriodCount === 2);

const onlyUnweighted = computeOfficialKpi({ score1m: null, score3m: null, score6m: 90 }, zeroSixMonth);
check("only unweighted data → null, not an invented score", onlyUnweighted.officialKpi === null);

// --- Weight validation / normalization ----------------------------------------
console.log("\nWeight validation");
check("25 / 50 / 25 is valid", validateWeights(MEMBER_KPI_WEIGHTS) === null);
check(
  "a mix that does not sum to 1 is rejected",
  validateWeights({ last_1_month: 0.5, last_3_months: 0.5, last_6_months: 0.5 }) !== null,
);
check(
  "a negative weight is rejected",
  validateWeights({ last_1_month: -0.1, last_3_months: 0.6, last_6_months: 0.5 }) !== null,
);
const fromPercent = normalizeWeights({ last_1_month: 50, last_3_months: 30, last_6_months: 20 });
check(
  "percentages normalize to fractions summing to 1",
  validateWeights(fromPercent) === null && fromPercent.last_1_month === 0.5,
  JSON.stringify(fromPercent),
);
const rescaled = normalizeWeights({ last_1_month: 1, last_3_months: 1, last_6_months: 1 });
check("an unnormalized mix is rescaled, not rejected", validateWeights(rescaled) === null, JSON.stringify(rescaled));

// --- Team average --------------------------------------------------------------
console.log("\nTeam average");
check(
  "a null member is excluded, not counted as 0",
  averageOfficialKpi([{ officialKpi: 80 }, { officialKpi: 60 }, { officialKpi: null }]) === 70,
);
check("all-null team averages to null", averageOfficialKpi([{ officialKpi: null }]) === null);

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
process.exit(failures === 0 ? 0 : 1);
