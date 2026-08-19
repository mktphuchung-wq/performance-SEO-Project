// Arithmetic self-check for lib/performance/score.ts — the cases the KPI formula
// has to get right, run against the real function rather than a transcription of
// it. No database, no network: `node scripts/verify-score.mjs`.
//
// Node strips the TypeScript types on import (Node >= 22.18), so this stays a
// plain .mjs file and the repo needs no test runner to answer "is the formula
// still doing what we agreed it does?".
import { aggregateScore, computeUrlScore } from "../lib/performance/score.ts";

const DEFAULTS = {
  targetGrowthPct: { new: 50, growth: 50, stable: 15 },
  smoothingConstant: 1,
  clickWeight: 0.7,
  impressionWeight: 0.3,
  urlWeightCapPct: 40,
};

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

const round = (v, d = 2) => (v === null || v === undefined ? "null" : Number(v.toFixed(d)));
const show = (r) =>
  `state=${r.state} clickRatio=${round(r.clickRatio, 4)} clickScore=${round(r.clickScore)} ` +
  `imprScore=${round(r.impressionScore)} score=${round(r.score)} weight=${round(r.weight)}`;

let failures = 0;
function check(label, condition, detail) {
  const status = condition ? "PASS" : "FAIL";
  if (!condition) failures += 1;
  console.log(`  [${status}] ${label}${detail ? ` — ${detail}` : ""}`);
}

console.log("kpi_settings:", JSON.stringify(DEFAULTS));

// --- Case 1: previous = 0 with real data, current = 2 clicks -----------------
console.log("\nCase 1 — previous=0 (measured), current=2 clicks");
const c1 = computeUrlScore(url({ currentClicks: 2, currentImpressions: 30, previousImpressions: 10 }), DEFAULTS);
console.log("  ", show(c1));
check("score is a number, not null", c1.score !== null);
check("clickScore > 50 (growth from 0 is rewarded)", c1.clickScore > 50, `clickScore=${round(c1.clickScore)}`);
check("clickScore <= 100 (clamped, never explosive)", c1.clickScore <= 100);

// --- Case 2: previous = null behaves exactly like previous = 0 ---------------
console.log("\nCase 2 — previous=null vs previous=0, current=5 clicks");
const c2null = computeUrlScore(
  url({ currentClicks: 5, previousClicks: null, currentImpressions: 40, previousImpressions: null }),
  DEFAULTS,
);
const c2zero = computeUrlScore(
  url({ currentClicks: 5, previousClicks: 0, currentImpressions: 40, previousImpressions: 0 }),
  DEFAULTS,
);
console.log("   null:", show(c2null));
console.log("   zero:", show(c2zero));
check("identical result", JSON.stringify(c2null) === JSON.stringify(c2zero));

// --- Case 3: a real +50% at a large baseline lands on the target -------------
console.log("\nCase 3 — previous=1000 → current=1500 clicks (+50%, the configured target)");
const c3 = computeUrlScore(
  url({ currentClicks: 1500, previousClicks: 1000, currentImpressions: 15000, previousImpressions: 10000 }),
  DEFAULTS,
);
console.log("  ", show(c3));
check("clickScore ≈ 100 (within 0.5)", Math.abs(c3.clickScore - 100) < 0.5, `clickScore=${round(c3.clickScore, 3)}`);

console.log("\nCase 3b — the low-baseline region the linear formula got wrong (previous=1000, sub-target growth)");
for (const current of [1000, 1050, 1100, 1250, 1400, 1500]) {
  const r = computeUrlScore(url({ currentClicks: current, previousClicks: 1000 }), DEFAULTS);
  console.log(`   1000 → ${String(current).padStart(4)} (+${String(((current - 1000) / 10).toFixed(0)).padStart(2)}%): clickScore=${round(r.clickScore)}`);
}

// --- Case 4: two URLs from the same previous=0 baseline ---------------------
console.log("\nCase 4 — two URLs, both previous=0: current=1 vs current=50");
for (const smoothing of [1, 10, 50]) {
  const settings = { ...DEFAULTS, smoothingConstant: smoothing };
  const a = computeUrlScore(url({ currentClicks: 1, currentImpressions: 1 }), settings);
  const b = computeUrlScore(url({ currentClicks: 50, currentImpressions: 50 }), settings);
  console.log(
    `   smoothing=${String(smoothing).padStart(2)}: A(current=1) score=${round(a.score)} · B(current=50) score=${round(b.score)}` +
      (b.score > a.score ? "  → differentiated" : "  → both at the ceiling"),
  );
  check(`smoothing=${smoothing}: B >= A`, b.score >= a.score);
  check(`smoothing=${smoothing}: neither is null`, a.score !== null && b.score !== null);
  if (smoothing > 1) {
    check(`smoothing=${smoothing}: B > A strictly`, b.score > a.score);
  }
}

// --- Case 5: no eligible URL means null, not 0 ------------------------------
console.log("\nCase 5 — a member holding only excluded / no-data URLs");
const c5 = aggregateScore(
  [
    computeUrlScore(url({ kpiExcluded: true, currentClicks: 100 }), DEFAULTS),
    computeUrlScore(url({ dataStatus: "no_data" }), DEFAULTS),
    computeUrlScore(url({ dataStatus: "error" }), DEFAULTS),
  ],
  DEFAULTS.urlWeightCapPct,
);
console.log("  ", JSON.stringify(c5));
check("kpiScore is null, not 0", c5.kpiScore === null);
check("counts explain why", c5.excludedUrlCount === 1 && c5.noDataUrlCount === 2 && c5.eligibleUrlCount === 0);

// --- Extra: the weight cap keeps one big URL from owning the average --------
console.log("\nExtra — per-URL weight cap (40%)");
const big = computeUrlScore(
  url({ currentClicks: 100, previousClicks: 100, currentImpressions: 100000, previousImpressions: 100000 }),
  DEFAULTS,
); // flat → 50
const smalls = [1, 2, 3].map(() =>
  computeUrlScore(url({ currentClicks: 30, previousClicks: 10, currentImpressions: 300, previousImpressions: 100 }), DEFAULTS),
); // strong growth → 100
const capped = aggregateScore([big, ...smalls], DEFAULTS.urlWeightCapPct);
const uncapped = aggregateScore([big, ...smalls], 100);
console.log(`   capped at 40%: kpiScore=${round(capped.kpiScore)} (cappedUrlCount=${capped.cappedUrlCount})`);
console.log(`   no cap (100%): kpiScore=${round(uncapped.kpiScore)}`);
check("the cap lifts the small-but-growing URLs' influence", capped.kpiScore > uncapped.kpiScore);

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
process.exit(failures === 0 ? 0 : 1);
