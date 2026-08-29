import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

async function loadTsModule(path) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`);
}

const anomaly = await loadTsModule("../lib/performance/anomaly.ts");
const score = await loadTsModule("../lib/performance/score.ts");
const ranges = await loadTsModule("../lib/ranges.ts");

const ANOMALY = { zscoreThreshold: 3.5, ratioThreshold: 2, minHistoryMonths: 3 };
const KPI = {
  targetGrowthPct: { new: 50, growth: 50, stable: 15 },
  smoothingConstant: 1,
  clickWeight: 0.7,
  impressionWeight: 0.3,
  urlWeightCapPct: 40,
};

// --- Detection: a month is judged against the URL's own past, not a constant --
const stable = [100, 98, 103, 99, 101];
assert.equal(anomaly.detectAnomaly(1000, stable, ANOMALY).direction, "spike");
assert.equal(anomaly.detectAnomaly(20, stable, ANOMALY).direction, "drop");

// Ordinary month-to-month movement is not an anomaly. Flagging it would empty the
// baseline of exactly the months it needs.
assert.equal(anomaly.detectAnomaly(115, stable, ANOMALY).direction, null);
assert.equal(anomaly.detectAnomaly(85, stable, ANOMALY).direction, null);

// Not enough history to know what normal is yet.
assert.equal(anomaly.detectAnomaly(1000, [100, 100], ANOMALY).direction, null);

// A perfectly flat history has a MAD of 0. The z-score is unbounded there, so the
// fold-change gate is the only thing standing between a quiet URL and a flag on
// every single month.
assert.equal(anomaly.detectAnomaly(6, [2, 2, 2, 2], ANOMALY).direction, "spike");
assert.equal(anomaly.detectAnomaly(3, [2, 2, 2, 2], ANOMALY).direction, null);

// A URL with no traffic at all has no normal to deviate from.
assert.equal(anomaly.detectAnomaly(50, [0, 0, 0, 0], ANOMALY).direction, null);

// --- Reconciliation: a blip and a step change look identical on arrival -------
// Traffic fell back to where it was, so the flagged month really was a one-off.
assert.equal(anomaly.reconcileAnomaly(1000, 100, 100, ANOMALY), "confirmed");
// The new level held. That was real growth and the month rejoins the baseline,
// otherwise every genuine step up would be discounted forever.
assert.equal(anomaly.reconcileAnomaly(1000, 980, 100, ANOMALY), "dismissed");

// --- Robust baseline ---------------------------------------------------------
// One sample passes through untouched: this is what makes a lookback of 1
// identical to the single-previous-period behaviour it replaced.
assert.equal(score.robustBaseline([137], 4), 137);
assert.equal(score.robustBaseline([], 4), null);
assert.equal(score.robustBaseline([null, null], 4), null);

// A spike among otherwise steady periods must not drag the baseline with it.
const withSpike = score.robustBaseline([1000, 100, 100, 100], 4);
assert.ok(withSpike < 200, `expected the spike to be pulled in, got ${withSpike}`);

// At two samples the winsorize clamp is the only protection there is — a median
// of two numbers is just their average.
const twoSamples = score.robustBaseline([5000, 100], 4);
assert.ok(twoSamples < 1000, `expected the outlier clamped, got ${twoSamples}`);

// --- Baseline windows --------------------------------------------------------
// Blocks stop short of the scored window's own month; overlapping it would
// compare the period against itself.
const oneMonth = ranges.baselineWindows("last_1_month", "2026-07-25", 3);
assert.deepEqual(oneMonth.map((w) => w.startDate), ["2026-06-01", "2026-05-01", "2026-04-01"]);
assert.deepEqual(oneMonth.map((w) => w.endDate), ["2026-06-30", "2026-05-31", "2026-04-30"]);

const threeMonths = ranges.baselineWindows("last_3_months", "2026-07-25", 2);
assert.deepEqual(threeMonths.map((w) => [w.startDate, w.endDate]), [
  ["2026-04-01", "2026-06-30"],
  ["2026-01-01", "2026-03-31"],
]);

// Ranges with no rolling width have nothing to compare against.
assert.deepEqual(ranges.baselineWindows("all_time", "2026-07-25", 3), []);

// A month is only "closed" once the GSC cutoff has passed its last day —
// recording a half month would freeze a phantom decline into the history.
assert.deepEqual(ranges.closedCalendarMonths(2, "2026-08-14").map((m) => m.startDate), ["2026-07-01", "2026-06-01"]);
assert.deepEqual(ranges.closedCalendarMonths(1, "2026-08-31")[0].startDate, "2026-08-01");

// --- The reported bug, end to end -------------------------------------------
// Six steady months, one spike, then a return to normal. Nothing about the URL
// got worse in that last month.
const scoreOf = (baselineClicks, baselineImpressions) => score.computeUrlScore({
  projectType: "growth",
  dataStatus: "ok",
  kpiExcluded: false,
  currentClicks: 100,
  previousClicks: 1000,
  currentImpressions: 1000,
  previousImpressions: 10000,
  baselineClicks,
  baselineImpressions,
}, KPI);

// Before: graded against the spike alone, floored at 0 — read as total failure.
const before = scoreOf(null, null);
assert.equal(before.score, 0);

// After: the spike is out of the baseline, so holding steady scores as holding
// steady. 50 is the "no growth" mark by construction.
const after = scoreOf(100, 1000);
assert.ok(after.score > 45 && after.score < 55, `expected a neutral score, got ${after.score}`);

// The weight follows the same baseline. Left on the raw previous period, the
// mis-scored URL would also have carried an inflated share of its member's
// average — the bad score pulling harder than an honest one.
assert.ok(after.weight < before.weight, "expected the anomalous period to stop inflating the weight");

// A URL that genuinely fell away still scores badly. The fix must not launder
// real declines into neutral ones.
const realDecline = score.computeUrlScore({
  projectType: "growth",
  dataStatus: "ok",
  kpiExcluded: false,
  currentClicks: 10,
  previousClicks: 100,
  currentImpressions: 100,
  previousImpressions: 1000,
  baselineClicks: 100,
  baselineImpressions: 1000,
}, KPI);
assert.ok(realDecline.score < 20, `expected a real decline to score low, got ${realDecline.score}`);

// --- Backward compatibility --------------------------------------------------
// With no history stored, every score must match the formula this replaced.
for (const [current, previous] of [[100, 80], [0, 50], [500, 500], [7, 0]]) {
  const legacy = score.computeUrlScore({
    projectType: "growth",
    dataStatus: "ok",
    kpiExcluded: false,
    currentClicks: current,
    previousClicks: previous,
    currentImpressions: current * 10,
    previousImpressions: previous * 10,
  }, KPI);
  const sensitivity = 50 / Math.log2(1.5);
  const clamp = (ratio) => Math.max(0, Math.min(100, 50 + Math.log2(ratio) * sensitivity));
  const expected = clamp((current + 1) / (previous + 1)) * 0.7 + clamp((current * 10 + 1) / (previous * 10 + 1)) * 0.3;
  assert.ok(Math.abs(legacy.score - expected) < 1e-9, `legacy score drifted at ${current}/${previous}`);
  assert.equal(legacy.weight, (previous * 10 + current * 10) / 2);
}

console.log("Anomaly detection and robust baseline verification passed.");
