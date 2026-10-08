// Arithmetic self-check for the Member × Range opposite-sign rule — the cases in
// docs/specs/DAC_TA_KPI_THANH_VIEN_CHI_SO_TRAI_DAU.md §4.3 and §9-P0.6, run against the real
// functions rather than a transcription of them. No database, no network:
// `node scripts/verify-member-score.mjs`.
//
// The question this file exists to answer is not "does the new rule work?" but
// "did adding it move a single number that was not supposed to move?" — so most
// of it is parity, not novelty.
import {
  MEMBER_FORMULA_VERSION,
  OPPOSITE_SIGN_FACTOR,
  aggregateMemberScore,
  aggregateScore,
  computeUrlScore,
  directionAdjustmentOf,
  effectiveWeightsFor,
  urlContributions,
} from "../lib/performance/score.ts";
import { growthPct, periodTotals } from "../lib/performance/period-totals.ts";

const DEFAULTS = {
  targetGrowthPct: { new: 50, growth: 50, stable: 15 },
  smoothingConstant: 1,
  clickWeight: 0.7,
  impressionWeight: 0.3,
  urlWeightCapPct: 40,
};

const scored = (clickScore, impressionScore, weight) => ({
  state: "normal",
  clickRatio: null,
  impressionRatio: null,
  clickScore,
  impressionScore,
  score: clickScore * DEFAULTS.clickWeight + impressionScore * DEFAULTS.impressionWeight,
  weight,
  baselineClicks: null,
  baselineImpressions: null,
});
const unscored = (state) => ({
  state,
  clickRatio: null,
  impressionRatio: null,
  clickScore: null,
  impressionScore: null,
  score: null,
  weight: 0,
  baselineClicks: null,
  baselineImpressions: null,
});

const growth = (click, impression) => ({ clickGrowthPct: click, impressionGrowthPct: impression });
const near = (a, b, tol = 1e-9) => a !== null && b !== null && Math.abs(a - b) < tol;
const round = (v, d = 4) => (v === null || v === undefined ? "null" : Number(v.toFixed(d)));

let failures = 0;
function check(label, condition, detail) {
  const status = condition ? "PASS" : "FAIL";
  if (!condition) failures += 1;
  console.log(`  [${status}] ${label}${detail ? ` — ${detail}` : ""}`);
}

console.log("kpi_settings:", JSON.stringify(DEFAULTS), "· d =", OPPOSITE_SIGN_FACTOR);

// --- §4.3: the two effective weight pairs the spec names ---------------------
console.log("\n§4.3 — effective weights at wc=0.7, wi=0.3, d=0.5");
{
  const up = effectiveWeightsFor(DEFAULTS, "click_up_impression_down", OPPOSITE_SIGN_FACTOR);
  const down = effectiveWeightsFor(DEFAULTS, "impression_up_click_down", OPPOSITE_SIGN_FACTOR);
  const none = effectiveWeightsFor(DEFAULTS, "none", OPPOSITE_SIGN_FACTOR);
  console.log(`   click up / impr down: ${round(up.clickWeight * 100, 2)}% / ${round(up.impressionWeight * 100, 2)}%`);
  console.log(`   impr up / click down: ${round(down.clickWeight * 100, 2)}% / ${round(down.impressionWeight * 100, 2)}%`);
  check(
    "click up, impression down → 82.35% / 17.65%",
    near(up.clickWeight, 0.8235294117647058, 1e-12) && near(up.impressionWeight, 0.17647058823529413, 1e-12),
  );
  check(
    "impression up, click down → 53.85% / 46.15%",
    near(down.clickWeight, 0.5384615384615385, 1e-12) && near(down.impressionWeight, 0.46153846153846156, 1e-12),
  );
  check("no adjustment → the configured pair, untouched", none.clickWeight === 0.7 && none.impressionWeight === 0.3);
  for (const [name, w] of [["click up", up], ["impr up", down], ["none", none]]) {
    check(`${name}: weights sum to 1`, near(w.clickWeight + w.impressionWeight, 1, 1e-12));
  }
  check(
    "the declining metric always loses share, never gains",
    up.impressionWeight < DEFAULTS.impressionWeight && down.clickWeight < DEFAULTS.clickWeight,
  );
}

// --- §4.2: which pairs of percentages count as opposite signs ----------------
console.log("\n§4.2 — direction detection (zero and null are never opposite)");
{
  const cases = [
    [growth(12.4, -5.1), "click_up_impression_down"],
    [growth(-5.1, 12.4), "impression_up_click_down"],
    // Unrounded on purpose: the sign is the whole question, rounding is display.
    [growth(0.0001, -0.0001), "click_up_impression_down"],
    [growth(12.4, 5.1), "none"],
    [growth(-12.4, -5.1), "none"],
    [growth(0, -5.1), "none"],
    [growth(12.4, 0), "none"],
    [growth(0, 0), "none"],
    [growth(null, -5.1), "none"],
    [growth(12.4, null), "none"],
    [growth(null, null), "none"],
    [growth(NaN, -5.1), "none"],
    [growth(Infinity, -5.1), "none"],
  ];
  for (const [g, want] of cases) {
    const got = directionAdjustmentOf(g);
    check(`click=${g.clickGrowthPct} impr=${g.impressionGrowthPct} → ${want}`, got === want, got);
  }
}

// --- §9-P0.6: an adjusted member score, end to end --------------------------
console.log("\n§9-P0.6 — an adjusted member score, end to end");
{
  const results = [scored(80, 20, 1000), scored(60, 40, 500), scored(90, 10, 250)];
  const base = aggregateScore(results, DEFAULTS.urlWeightCapPct);
  const up = aggregateMemberScore(results, DEFAULTS, growth(18.2, -6.4));
  const down = aggregateMemberScore(results, DEFAULTS, growth(-6.4, 18.2));
  console.log(`   C=${round(up.clickComponentScore, 3)} I=${round(up.impressionComponentScore, 3)} base=${round(base.kpiScore, 3)}`);
  console.log(`   click up: ${round(up.kpiScore, 3)} · impr up: ${round(down.kpiScore, 3)}`);

  check("base is aggregateScore's own number, bit for bit", up.baseKpiScore === base.kpiScore);
  check(
    "wc·C + wi·I reproduces the base score",
    near(0.7 * up.clickComponentScore + 0.3 * up.impressionComponentScore, base.kpiScore, 1e-9),
  );
  check(
    "click up uses 82.35% / 17.65%",
    near(up.effectiveClickWeight, 0.8235294117647058, 1e-12)
      && near(up.effectiveImpressionWeight, 0.17647058823529413, 1e-12),
  );
  check(
    "click up score is the effective blend",
    near(
      up.kpiScore,
      up.effectiveClickWeight * up.clickComponentScore + up.effectiveImpressionWeight * up.impressionComponentScore,
      1e-9,
    ),
  );
  check(
    "click up moves the score towards Click, the metric that grew",
    up.kpiScore > base.kpiScore && up.kpiScore < up.clickComponentScore,
  );
  check(
    "impression up moves the score towards Impression",
    down.kpiScore < base.kpiScore && down.kpiScore > down.impressionComponentScore,
  );
  check(
    "the factor is recorded only when a rule fired",
    up.oppositeSignFactor === OPPOSITE_SIGN_FACTOR && down.oppositeSignFactor === OPPOSITE_SIGN_FACTOR,
  );
  check("the formula version travels with the row", up.formulaVersion === MEMBER_FORMULA_VERSION);
  check(
    "counts and weights are untouched by the adjustment",
    up.eligibleUrlCount === base.eligibleUrlCount
      && up.totalWeight === base.totalWeight
      && up.cappedUrlCount === base.cappedUrlCount,
  );
}

// --- §9-P0.6: same-sign / zero / null must not move a single number ----------
console.log("\n§9-P0.6 — unadjusted members are bit-identical to the previous formula");
{
  const results = [scored(80, 20, 1000), scored(60, 40, 500), scored(30, 70, 90)];
  const base = aggregateScore(results, DEFAULTS.urlWeightCapPct);
  const unchanged = [
    ["both up", growth(12.4, 5.1)],
    ["both down", growth(-12.4, -5.1)],
    ["click flat", growth(0, -5.1)],
    ["impression flat", growth(12.4, 0)],
    ["both flat", growth(0, 0)],
    ["click null", growth(null, -5.1)],
    ["both null", growth(null, null)],
  ];
  for (const [name, g] of unchanged) {
    const got = aggregateMemberScore(results, DEFAULTS, g);
    check(
      `${name}: kpiScore === the previous formula's, exactly`,
      got.kpiScore === base.kpiScore && got.baseKpiScore === base.kpiScore,
      `${round(got.kpiScore, 6)} vs ${round(base.kpiScore, 6)}`,
    );
    check(`${name}: nothing is stamped as adjusted`, got.directionAdjustment === "none" && got.oppositeSignFactor === null);
  }
}

// --- No eligible URL: null, never 0 -----------------------------------------
console.log("\n§4.1 — a member with nothing scoreable");
{
  const empty = aggregateMemberScore([unscored("excluded"), unscored("no_data")], DEFAULTS, growth(12.4, -5.1));
  check("kpiScore is null, not 0", empty.kpiScore === null);
  check(
    "base and both components are null too",
    empty.baseKpiScore === null && empty.clickComponentScore === null && empty.impressionComponentScore === null,
  );
  check(
    "the weights it would have been scored at are still recorded",
    near(empty.effectiveClickWeight + empty.effectiveImpressionWeight, 1, 1e-12),
  );
  check("no URL at all behaves the same", aggregateMemberScore([], DEFAULTS, growth(1, -1)).kpiScore === null);
}

// --- The zero-weight fallback still mirrors aggregateScore -------------------
console.log("\n§4.1 — the plain-mean fallback when no URL has traffic to rank by");
{
  const results = [scored(80, 20, 0), scored(40, 60, 0)];
  const base = aggregateScore(results, DEFAULTS.urlWeightCapPct);
  const got = aggregateMemberScore(results, DEFAULTS, growth(9, -3));
  check("base still matches the previous formula", got.baseKpiScore === base.kpiScore);
  check("components are the plain means", got.clickComponentScore === 60 && got.impressionComponentScore === 40);
  check(
    "wc·C + wi·I still reproduces the base",
    near(0.7 * got.clickComponentScore + 0.3 * got.impressionComponentScore, base.kpiScore, 1e-9),
  );
}

// --- Project scores must be untouched ---------------------------------------
console.log("\n§2 — the project aggregator is not the member aggregator");
{
  const results = [scored(90, 10, 400), scored(20, 80, 1200), unscored("no_data")];
  const project = aggregateScore(results, DEFAULTS.urlWeightCapPct);
  const member = aggregateMemberScore(results, DEFAULTS, growth(14, -9));
  check(
    "the same URLs score differently for a member than for a project",
    project.kpiScore !== member.kpiScore,
    `project=${round(project.kpiScore, 3)} member=${round(member.kpiScore, 3)}`,
  );
  check("and the project number is exactly the member's base", project.kpiScore === member.baseKpiScore);
}

// --- The linearity the base score relies on, over a randomised corpus --------
console.log("\nregression — wc·C + wi·I is the previous formula, over a randomised corpus");
{
  // Deterministic PRNG, so a failure here is always reproducible.
  let seed = 20260903;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };

  // The branches chance alone will not reach often enough to trust: every URL
  // with no impressions at all (the plain-mean fallback), a lone URL whose share
  // exceeds the cap, and a member with nothing eligible.
  const fixed = [
    [[scored(80, 20, 0), scored(40, 60, 0)], 40, growth(9, -3)],
    [[scored(0, 100, 0), scored(100, 0, 0), scored(50, 50, 0)], 100, growth(-4, 11)],
    [[scored(50, 50, 0)], 40, growth(3, 3)],
    [[scored(90, 10, 10)], 40, growth(12, -12)],
    [[unscored("excluded"), unscored("no_data")], 40, growth(12, -12)],
    [[], 40, growth(12, -12)],
    [[scored(30, 70, 100), scored(70, 30, 100)], 100, growth(-1, 1)],
  ];

  let mismatches = 0;
  let adjustedMismatches = 0;
  let cappedCases = 0;
  let zeroWeightCases = 0;
  let adjustedCases = 0;
  const random = 400;
  const total = fixed.length + random;

  for (let i = 0; i < total; i += 1) {
    const preset = fixed[i];
    const n = 1 + Math.floor(rand() * 8);
    const results = preset ? preset[0] : Array.from({ length: n }, () => {
      const roll = rand();
      if (roll < 0.15) return unscored(roll < 0.075 ? "excluded" : "no_data");
      return scored(Math.round(rand() * 100), Math.round(rand() * 100), Math.floor(rand() * rand() * 5000));
    });
    const cap = preset ? preset[1] : 5 + Math.floor(rand() * 96);
    const settings = { ...DEFAULTS, urlWeightCapPct: cap };
    const g = preset ? preset[2] : growth((rand() - 0.5) * 200, (rand() - 0.5) * 200);

    const got = aggregateMemberScore(results, settings, g);
    const want = aggregateScore(results, cap);
    if (want.cappedUrlCount > 0) cappedCases += 1;
    if (want.totalWeight === 0 && want.eligibleUrlCount > 0) zeroWeightCases += 1;
    if (got.directionAdjustment !== "none") adjustedCases += 1;

    if (got.baseKpiScore !== want.kpiScore) mismatches += 1;
    if (want.kpiScore === null) continue;

    const rebuiltBase =
      DEFAULTS.clickWeight * got.clickComponentScore + DEFAULTS.impressionWeight * got.impressionComponentScore;
    if (!near(rebuiltBase, want.kpiScore, 1e-9)) mismatches += 1;

    const rebuilt =
      got.effectiveClickWeight * got.clickComponentScore + got.effectiveImpressionWeight * got.impressionComponentScore;
    if (!near(Math.max(0, Math.min(100, rebuilt)), got.kpiScore, 1e-9)) adjustedMismatches += 1;
  }

  check(`base score is the previous formula's over ${total} cases`, mismatches === 0, `${mismatches} mismatch(es)`);
  check("effective score is always the effective blend", adjustedMismatches === 0, `${adjustedMismatches} mismatch(es)`);
  check("the corpus exercised the weight cap", cappedCases > 0, `${cappedCases} cases`);
  check("the corpus exercised the zero-weight fallback", zeroWeightCases > 0, `${zeroWeightCases} cases`);
  check("the corpus exercised the adjustment", adjustedCases > 0, `${adjustedCases} of ${total} adjusted`);
}

// --- §7: drag from effective URL scores rebuilds the member's own KPI --------
console.log("\n§7 — effective URL scores reconstruct member_performance_score.kpi_score");
{
  let seed = 771102;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };

  let reconstructionFailures = 0;
  let cases = 0;
  for (let i = 0; i < 200; i += 1) {
    const n = 1 + Math.floor(rand() * 6);
    const results = Array.from({ length: n }, () =>
      scored(Math.round(rand() * 100), Math.round(rand() * 100), Math.floor(rand() * rand() * 4000)));
    const cap = 5 + Math.floor(rand() * 96);
    const settings = { ...DEFAULTS, urlWeightCapPct: cap };
    const member = aggregateMemberScore(results, settings, growth(20, -8));
    if (member.kpiScore === null) continue;
    cases += 1;

    const contributions = urlContributions(results, cap, (r) =>
      member.effectiveClickWeight * r.clickScore + member.effectiveImpressionWeight * r.impressionScore);
    const rebuilt = contributions.reduce((sum, c) => sum + c.effectiveScore * c.weightShare, 0);
    if (!near(Math.max(0, Math.min(100, rebuilt)), member.kpiScore, 1e-9)) reconstructionFailures += 1;
  }
  check(
    `sum of effectiveScore × weightShare equals kpi_score over ${cases} members`,
    reconstructionFailures === 0,
    `${reconstructionFailures} failure(s)`,
  );

  // And without an accessor, contributions are what they always were.
  const plain = [scored(80, 20, 100), scored(30, 70, 300)];
  const before = urlContributions(plain, 40);
  check("with no accessor, effectiveScore is the published score", before.every((c) => c.effectiveScore === c.score));
  check(
    "with no accessor, drag is measured off the published score",
    before.every((c) => near(c.dragPoints, Math.max(0, 50 - c.score) * c.weightShare, 1e-12)),
  );
}

// --- The shared current/previous helper the direction is read from ----------
console.log("\n§5.1 — periodTotals, the one place current-vs-previous is summed");
{
  check("null previous has no percentage at all", growthPct(null, 500) === null);
  check("0 → positive is +100, not infinity", growthPct(0, 5) === 100);
  check("0 → 0 is null, not 0%", growthPct(0, 0) === null);
  check("an ordinary drop", near(growthPct(200, 150), -25, 1e-12));

  const rows = [
    { dataStatus: "ok", clicks: 100, impressions: 1000, previousClicks: 80, previousImpressions: 1200 },
    { dataStatus: "ok", clicks: 50, impressions: 500, previousClicks: 40, previousImpressions: 700 },
    { dataStatus: "no_data", clicks: 9999, impressions: 9999, previousClicks: 1, previousImpressions: 1 },
  ];
  const totals = periodTotals(rows);
  check(
    "rows without usable data are left out, not counted as zero",
    totals.clicks === 150 && totals.impressions === 1500 && totals.okRowCount === 2,
  );
  check(
    "clicks up, impressions down — the opposite-sign case",
    totals.clickGrowthPct > 0 && totals.impressionGrowthPct < 0,
    `click=${round(totals.clickGrowthPct, 2)}% impr=${round(totals.impressionGrowthPct, 2)}%`,
  );
  check("and that is exactly what the rule reads", directionAdjustmentOf(totals) === "click_up_impression_down");

  const noHistory = periodTotals([
    { dataStatus: "ok", clicks: 10, impressions: 20, previousClicks: null, previousImpressions: null },
  ]);
  check(
    "no previous measurement anywhere → no direction",
    noHistory.previousClicks === null && noHistory.clickGrowthPct === null
      && directionAdjustmentOf(noHistory) === "none",
  );
  check("no ok rows at all → no direction", directionAdjustmentOf(periodTotals([])) === "none");
}

// --- The real scorer feeds the real aggregator -------------------------------
console.log("\nend to end — computeUrlScore → aggregateMemberScore");
{
  const url = (over) => ({
    projectType: "growth",
    dataStatus: "ok",
    kpiExcluded: false,
    currentClicks: 0,
    previousClicks: 0,
    currentImpressions: 0,
    previousImpressions: 0,
    ...over,
  });
  const results = [
    computeUrlScore(url({ currentClicks: 900, previousClicks: 600, currentImpressions: 9000, previousImpressions: 12000 }), DEFAULTS),
    computeUrlScore(url({ currentClicks: 200, previousClicks: 180, currentImpressions: 4000, previousImpressions: 5000 }), DEFAULTS),
    computeUrlScore(url({ currentClicks: 5, previousClicks: 4, currentImpressions: 60, previousImpressions: 90 }), DEFAULTS),
  ];
  const totals = periodTotals([
    { dataStatus: "ok", clicks: 900, impressions: 9000, previousClicks: 600, previousImpressions: 12000 },
    { dataStatus: "ok", clicks: 200, impressions: 4000, previousClicks: 180, previousImpressions: 5000 },
    { dataStatus: "ok", clicks: 5, impressions: 60, previousClicks: 4, previousImpressions: 90 },
  ]);
  const member = aggregateMemberScore(results, DEFAULTS, totals);
  console.log(`   click ${round(totals.clickGrowthPct, 2)}% · impression ${round(totals.impressionGrowthPct, 2)}%`);
  console.log(`   base ${round(member.baseKpiScore, 2)} → effective ${round(member.kpiScore, 2)} (${member.directionAdjustment})`);
  check("a real click-up / impression-down member is adjusted", member.directionAdjustment === "click_up_impression_down");
  check("and scores higher than the 70/30 blend would have given them", member.kpiScore > member.baseKpiScore);
  check(
    "both stay on the 0–100 scale",
    member.kpiScore >= 0 && member.kpiScore <= 100 && member.baseKpiScore >= 0 && member.baseKpiScore <= 100,
  );
}

console.log(failures === 0 ? "\nAll member score checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
