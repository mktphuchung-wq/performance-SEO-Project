// Arithmetic and rule self-check for the Warning/Audit layer, run against the
// real functions rather than a transcription of them. No database, no network:
// `node scripts/verify-warning-audit.mjs`.
//
// The single most important property here is the last section: nothing in this
// feature may change a KPI. aggregateScore has to return exactly what it did
// before urlContributions was carved out of it.
import { aggregateScore, urlContributions } from "../lib/performance/score.ts";
import { clickDropPct, clickLoss, evaluateWarning, pendingAuditExposure, totalDragPoints } from "../lib/performance/warning.ts";
import { checkTransition, slaBreached, statusAfter, EXTERNAL_SHARE_BY_CONCLUSION } from "../lib/performance/audit-workflow.ts";

const THRESHOLDS = {
  clickDropPct: 20,
  minClickLoss: 30,
  urlScoreCeiling: 40,
  dragPoints1m: 0.5,
  dragPoints3m: 1,
  consecutiveMonths: 2,
  auditSlaDays: 14,
  exposureEscalationPct: 25,
};

const scored = (score, weight) => ({
  state: "normal",
  clickRatio: null, impressionRatio: null, clickScore: null, impressionScore: null,
  score, weight, baselineClicks: null, baselineImpressions: null,
});
const unscored = (state) => ({
  state, clickRatio: null, impressionRatio: null, clickScore: null, impressionScore: null,
  score: null, weight: 0, baselineClicks: null, baselineImpressions: null,
});

const candidate = (over) => ({
  rangeKey: "last_1_month",
  dataStatus: "ok",
  score: 10,
  currentClicks: 100,
  baselineClicks: 500,
  dragPoints: 2,
  priorConsecutiveCount: 0,
  ...over,
});

const near = (a, b, tol = 1e-9) => a !== null && b !== null && Math.abs(a - b) < tol;

let failures = 0;
function check(label, condition, detail) {
  if (!condition) failures += 1;
  console.log(`  [${condition ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
}

console.log("\nurlContributions — shares and drag");
{
  const results = [scored(20, 100), scored(80, 300), scored(45, 100)];
  const contributions = urlContributions(results, 40);
  const shareSum = contributions.reduce((s, c) => s + c.weightShare, 0);
  check("weight shares sum to 1", near(shareSum, 1), `sum=${shareSum}`);

  const agg = aggregateScore(results, 40);
  const cappedSum = contributions.reduce((s, c) => s + c.cappedWeight, 0);
  check("capped weights sum to the aggregate's totalWeight", near(cappedSum, agg.totalWeight),
    `contributions=${cappedSum} aggregate=${agg.totalWeight}`);

  // The aggregate is the share-weighted mean of the same scores.
  const rebuilt = contributions.reduce((s, c) => s + c.score * c.weightShare, 0);
  check("shares reproduce the aggregate kpiScore", near(rebuilt, agg.kpiScore, 1e-9),
    `rebuilt=${rebuilt.toFixed(6)} kpiScore=${agg.kpiScore.toFixed(6)}`);

  check("a URL at or above neutral drags nothing", contributions[1].dragPoints === 0);
  const first = contributions[0];
  check("drag is max(0, 50 - score) × share", near(first.dragPoints, 30 * first.weightShare),
    `drag=${first.dragPoints.toFixed(4)}`);
  check("indexes point back at the input array", contributions.map((c) => c.index).join(",") === "0,1,2");
}

console.log("\nurlContributions — the cap and the zero-weight fallback");
{
  const results = [scored(10, 900), scored(90, 50), scored(50, 50)];
  const contributions = urlContributions(results, 40);
  const agg = aggregateScore(results, 40);
  check("the dominant URL is capped", contributions[0].cappedWeight < contributions[0].weight,
    `weight=${contributions[0].weight} capped=${contributions[0].cappedWeight}`);
  check("capping matches the aggregate's count", agg.cappedUrlCount === 1);
  check("capped weights still sum to totalWeight",
    near(contributions.reduce((s, c) => s + c.cappedWeight, 0), agg.totalWeight));

  // Every URL has zero impressions: traffic cannot rank them, so drag falls back
  // to an equal share — the same branch aggregateScore takes.
  const flat = [scored(20, 0), scored(30, 0), scored(0, 0)];
  const flatContributions = urlContributions(flat, 40);
  check("zero total weight gives every URL an equal share",
    flatContributions.every((c) => near(c.weightShare, 1 / 3)));
  check("zero-weight drag is max(0, 50 - score) ÷ eligibleUrlCount",
    near(flatContributions[0].dragPoints, 30 / 3) && near(flatContributions[2].dragPoints, 50 / 3),
    `${flatContributions[0].dragPoints.toFixed(4)}, ${flatContributions[2].dragPoints.toFixed(4)}`);

  check("no normal URL yields no contributions",
    urlContributions([unscored("excluded"), unscored("no_data")], 40).length === 0);
  check("empty input yields no contributions", urlContributions([], 40).length === 0);

  const mixed = urlContributions([unscored("excluded"), scored(10, 100), unscored("no_data")], 40);
  check("unscored URLs are skipped but indexes stay true",
    mixed.length === 1 && mixed[0].index === 1, `index=${mixed[0]?.index}`);
}

console.log("\nclickDropPct / clickLoss");
{
  check("a 60% fall reads as 60", near(clickDropPct(200, 500), 60));
  check("growth reads as a negative drop", clickDropPct(600, 500) < 0);
  check("no baseline gives null, not a division by zero", clickDropPct(0, 0) === null && clickDropPct(5, null) === null);
  check("loss is the absolute clicks given up", clickLoss(200, 500) === 300);
  check("loss never goes negative", clickLoss(600, 500) === 0);
}

console.log("\nevaluateWarning — 1M early warning");
{
  const base = candidate({});
  check("all conditions met fires an early warning", evaluateWarning(base, THRESHOLDS)?.level === "early_warning");
  check("data_status other than ok never fires",
    evaluateWarning(candidate({ dataStatus: "no_data" }), THRESHOLDS) === null
    && evaluateWarning(candidate({ dataStatus: "error" }), THRESHOLDS) === null);
  check("a null score never fires", evaluateWarning(candidate({ score: null }), THRESHOLDS) === null);
  check("a score at the ceiling does not fire", evaluateWarning(candidate({ score: 40 }), THRESHOLDS) === null);
  check("a score just under the ceiling does fire", evaluateWarning(candidate({ score: 39.9 }), THRESHOLDS) !== null);
  check("a drop under the threshold does not fire",
    evaluateWarning(candidate({ currentClicks: 410, baselineClicks: 500 }), THRESHOLDS) === null, "18% drop");
  check("a drop exactly at the threshold does fire",
    evaluateWarning(candidate({ currentClicks: 400, baselineClicks: 500 }), THRESHOLDS) !== null, "20% drop");
  check("a big percentage on tiny traffic is held back by the absolute floor",
    evaluateWarning(candidate({ currentClicks: 1, baselineClicks: 20 }), THRESHOLDS) === null, "95% but only 19 clicks");
  check("drag under the 1M threshold does not fire",
    evaluateWarning(candidate({ dragPoints: 0.49 }), THRESHOLDS) === null);
  check("drag exactly at the 1M threshold does fire",
    evaluateWarning(candidate({ dragPoints: 0.5 }), THRESHOLDS) !== null);
  check("no baseline to fall from never fires",
    evaluateWarning(candidate({ baselineClicks: 0 }), THRESHOLDS) === null);
}

console.log("\nevaluateWarning — escalation and 3M");
{
  const first = evaluateWarning(candidate({ priorConsecutiveCount: 0 }), THRESHOLDS);
  check("a first month is an early warning", first?.level === "early_warning" && first.consecutiveCount === 1);
  const second = evaluateWarning(candidate({ priorConsecutiveCount: 1 }), THRESHOLDS);
  check("a second consecutive closed month escalates to a mandatory audit",
    second?.level === "mandatory_audit" && second.consecutiveCount === 2);

  const m3 = { rangeKey: "last_3_months", dataStatus: "ok", score: 20, currentClicks: 100,
    baselineClicks: 500, dragPoints: 1, priorConsecutiveCount: 0 };
  check("3M drag at the threshold is a mandatory audit",
    evaluateWarning(m3, THRESHOLDS)?.level === "mandatory_audit");
  check("3M drag under the threshold does not fire",
    evaluateWarning({ ...m3, dragPoints: 0.99 }, THRESHOLDS) === null);
  check("3M does not need a click-drop percentage",
    evaluateWarning({ ...m3, currentClicks: 500, baselineClicks: 500 }, THRESHOLDS)?.level === "mandatory_audit");
  check("3M still respects the score ceiling",
    evaluateWarning({ ...m3, score: 45 }, THRESHOLDS) === null);
}

console.log("\nexposure and totals");
{
  // Raw weights 100 and 300; the 40% cap pulls the second down to 160, so the
  // denominator is the capped 260 rather than the raw 400. Exposure is measured
  // over the weights the KPI was actually taken over.
  const contributions = urlContributions([scored(10, 100), scored(80, 300)], 40);
  check("pending exposure is the pending share of capped weight",
    near(pendingAuditExposure(contributions, (c) => c.index === 0), 100 / 260),
    String(pendingAuditExposure(contributions, (c) => c.index === 0)));
  check("nothing pending is 0, not null", pendingAuditExposure(contributions, () => false) === 0);
  check("zero total weight is null, never a division by zero",
    pendingAuditExposure(urlContributions([scored(10, 0), scored(20, 0)], 40), () => true) === null);
  check("no contributions at all is null", pendingAuditExposure([], () => true) === null);
  check("total drag adds the per-URL drags",
    near(totalDragPoints(contributions), contributions.reduce((s, c) => s + c.dragPoints, 0)));
}

console.log("\naudit workflow — transitions");
{
  const state = (over) => ({ status: "in_progress", conclusion: null, proposedBy: null,
    hasEvidence: false, hasConfidenceNote: false, ...over });
  const approver = { canApprove: true };
  const auditor = { canApprove: false };

  check("claim is legal from needs_audit",
    checkTransition(state({ status: "needs_audit" }), "claim", "a@x.com", auditor) === null);
  check("claim is illegal from resolved",
    checkTransition(state({ status: "resolved" }), "claim", "a@x.com", auditor) !== null);
  check("claim moves to in_progress", statusAfter("claim", "needs_audit") === "in_progress");
  check("updating evidence leaves the status where it was",
    statusAfter("update_evidence", "needs_audit") === "needs_audit");

  check("proposing without a conclusion is refused",
    checkTransition(state({}), "propose", "a@x.com", auditor) !== null);
  check("proposing controllable needs no evidence",
    checkTransition(state({ conclusion: "controllable" }), "propose", "a@x.com", auditor) === null);
  check("proposing external_verified without evidence is refused",
    checkTransition(state({ conclusion: "external_verified", hasConfidenceNote: true }), "propose", "a@x.com", auditor) !== null);
  check("proposing external_verified without a confidence note is refused",
    checkTransition(state({ conclusion: "external_verified", hasEvidence: true }), "propose", "a@x.com", auditor) !== null);
  check("proposing mixed with a full package is allowed",
    checkTransition(state({ conclusion: "mixed", hasEvidence: true, hasConfidenceNote: true }), "propose", "a@x.com", auditor) === null);

  const proposed = state({ conclusion: "controllable", proposedBy: "a@x.com" });
  check("approving with nothing proposed is refused",
    checkTransition(state({}), "approve", "b@x.com", approver) !== null);
  check("the proposer cannot approve their own conclusion",
    checkTransition(proposed, "approve", "a@x.com", approver) !== null);
  check("case and whitespace do not let the proposer approve",
    checkTransition(proposed, "approve", " A@X.com ", approver) !== null);
  check("an auditor without the approver role cannot approve",
    checkTransition(proposed, "approve", "b@x.com", auditor) !== null);
  check("a distinct approver can approve",
    checkTransition(proposed, "approve", "b@x.com", approver) === null);
  check("approving resolves the case", statusAfter("approve", "in_progress") === "resolved");
  check("rejecting returns it to in_progress", statusAfter("reject", "in_progress") === "in_progress");
  check("reopening a resolved case needs the approver role",
    checkTransition(state({ status: "resolved" }), "reopen", "b@x.com", auditor) !== null
    && checkTransition(state({ status: "resolved" }), "reopen", "b@x.com", approver) === null);
  check("a resolved case cannot be approved again",
    checkTransition(state({ status: "resolved", conclusion: "controllable", proposedBy: "a@x.com" }), "approve", "b@x.com", approver) !== null);
}

console.log("\naudit workflow — conclusions and SLA");
{
  check("controllable and insufficient_evidence both neutralise nothing",
    EXTERNAL_SHARE_BY_CONCLUSION.controllable === 0 && EXTERNAL_SHARE_BY_CONCLUSION.insufficient_evidence === 0);
  check("external_verified is 1 and mixed is 0.5",
    EXTERNAL_SHARE_BY_CONCLUSION.external_verified === 1 && EXTERNAL_SHARE_BY_CONCLUSION.mixed === 0.5);
  check("there are exactly three distinct share levels",
    new Set(Object.values(EXTERNAL_SHARE_BY_CONCLUSION)).size === 3);

  const past = new Date("2026-01-01T00:00:00Z");
  const future = new Date("2027-01-01T00:00:00Z");
  const now = new Date("2026-06-01T00:00:00Z");
  check("an open case past its deadline is breached", slaBreached(past, null, now) === true);
  check("an open case inside its deadline is not", slaBreached(future, null, now) === false);
  check("a case resolved before the deadline is not breached",
    slaBreached(future, new Date("2026-05-01T00:00:00Z"), now) === false);
  check("a case resolved after the deadline stays breached",
    slaBreached(past, new Date("2026-03-01T00:00:00Z"), now) === true);
  check("an unparseable deadline does not invent a breach", slaBreached("not-a-date", null, now) === false);
}

console.log("\nregression — the KPI must not have moved");
{
  // aggregateScore had its cap loop lifted into a helper that urlContributions
  // also calls. This is the pre-refactor body, transcribed verbatim, run against
  // the live one over randomised inputs: if the extraction changed any number,
  // this feature has broken the one thing it promised not to touch.
  function aggregateScoreBefore(results, urlWeightCapPct) {
    const normal = results.filter((r) => r.state === "normal");
    const counts = {
      eligibleUrlCount: normal.length,
      excludedUrlCount: results.filter((r) => r.state === "excluded").length,
      noDataUrlCount: results.filter((r) => r.state === "no_data").length,
    };
    if (normal.length === 0) return { kpiScore: null, ...counts, cappedUrlCount: 0, totalWeight: 0 };

    const rawTotal = normal.reduce((sum, r) => sum + r.weight, 0);
    const capValue = rawTotal > 0 ? (urlWeightCapPct / 100) * rawTotal : 0;
    let cappedUrlCount = 0;
    const cappedWeights = normal.map((r) => {
      if (capValue > 0 && r.weight > capValue) { cappedUrlCount += 1; return capValue; }
      return r.weight;
    });
    const totalWeight = cappedWeights.reduce((a, b) => a + b, 0);
    const kpiScore = totalWeight > 0
      ? normal.reduce((sum, r, i) => sum + (r.score ?? 0) * cappedWeights[i], 0) / totalWeight
      : normal.reduce((sum, r) => sum + (r.score ?? 0), 0) / normal.length;
    return { kpiScore: Math.max(0, Math.min(100, kpiScore)), ...counts, cappedUrlCount, totalWeight };
  }

  // Deterministic PRNG, so a failure here is always reproducible.
  let seed = 20260829;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

  const fixed = [
    [[scored(20, 100), scored(80, 300), scored(45, 100)], 40],
    [[scored(10, 900), scored(90, 50), scored(50, 50)], 40],
    [[scored(0, 0), scored(100, 0)], 40],   // zero-weight fallback
    [[scored(50, 10)], 40],                  // one URL: effective share exceeds the cap, by design
    [[unscored("excluded"), unscored("no_data")], 40],
    [[], 40],
    [[scored(30, 100), scored(70, 100)], 100],
  ];

  const random = Array.from({ length: 300 }, () => {
    const n = 1 + Math.floor(rand() * 8);
    const results = Array.from({ length: n }, () => {
      const roll = rand();
      if (roll < 0.15) return unscored(roll < 0.075 ? "excluded" : "no_data");
      return scored(Math.round(rand() * 100), Math.floor(rand() * rand() * 5000));
    });
    return [results, 5 + Math.floor(rand() * 96)];
  });

  let mismatches = 0;
  let zeroWeightCases = 0;
  let cappedCases = 0;
  for (const [results, cap] of [...fixed, ...random]) {
    const got = aggregateScore(results, cap);
    const want = aggregateScoreBefore(results, cap);
    if (want.totalWeight === 0 && want.eligibleUrlCount > 0) zeroWeightCases += 1;
    if (want.cappedUrlCount > 0) cappedCases += 1;
    const same = JSON.stringify(got) === JSON.stringify(want);
    if (!same) {
      mismatches += 1;
      if (mismatches === 1) console.log(`        first mismatch: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
    }
  }
  check(`aggregateScore is identical to its pre-refactor self over ${fixed.length + random.length} cases`,
    mismatches === 0, `${mismatches} mismatch(es)`);
  check("the randomised set exercised the weight cap", cappedCases > 0, `${cappedCases} capped cases`);
  check("the randomised set exercised the zero-weight fallback", zeroWeightCases > 0, `${zeroWeightCases} cases`);

  // And the contributions must reconstruct the very score they explain.
  let reconstructionFailures = 0;
  for (const [results, cap] of random) {
    const agg = aggregateScore(results, cap);
    if (agg.kpiScore === null) continue;
    const contributions = urlContributions(results, cap);
    const rebuilt = contributions.reduce((s, c) => s + c.score * c.weightShare, 0);
    const clamped = Math.max(0, Math.min(100, rebuilt));
    if (!near(clamped, agg.kpiScore, 1e-6)) reconstructionFailures += 1;
  }
  check("contributions always reconstruct the aggregate kpiScore", reconstructionFailures === 0,
    `${reconstructionFailures} failure(s)`);
}

console.log(failures === 0 ? "\nAll warning/audit checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
