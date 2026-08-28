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

const workKind = await loadTsModule("../lib/sync/work-kind.ts");
const hash = await loadTsModule("../lib/hash.ts");

// --- Only an unambiguous "new post" creates a URL --------------------------
assert.equal(workKind.classifyWorkKind("new post"), "new");
assert.equal(workKind.classifyWorkKind("New Post"), "new");
assert.equal(workKind.classifyWorkKind("new-post"), "new");
assert.equal(workKind.classifyWorkKind("new_post"), "new");
assert.equal(workKind.classifyWorkKind("  new   post "), "new");
assert.equal(workKind.classifyWorkKind("newpost"), "new");
assert.equal(workKind.classifyWorkKind("bài mới"), "new");

// Everything else is work on a URL that already exists. This is the guarantee
// that an audit can never blank out real Search Console history.
assert.equal(workKind.classifyWorkKind("audit"), "existing");
assert.equal(workKind.classifyWorkKind("update"), "existing");
assert.equal(workKind.classifyWorkKind("optimize"), "existing");
assert.equal(workKind.classifyWorkKind(""), "existing");
assert.equal(workKind.classifyWorkKind("a type nobody has typed before"), "existing");

// --- Work identity ---------------------------------------------------------
const base = { urlHash: "abc", workedAt: "2026-01-05", workType: "new post", memberName: "An" };
assert.equal(hash.computeWorkHash(base), hash.computeWorkHash({ ...base }));
// The same URL audited later is a different work event, not an overwrite.
assert.notEqual(hash.computeWorkHash(base), hash.computeWorkHash({ ...base, workedAt: "2026-08-20", workType: "audit" }));
// Two members working the same URL on the same day are two events.
assert.notEqual(hash.computeWorkHash(base), hash.computeWorkHash({ ...base, memberName: "Binh" }));
// Reordering the Sheet must not re-create every event, so the row number is out.
assert.equal(hash.computeWorkHash(base), hash.computeWorkHash({ ...base, sourceRowNumber: 99 }));

// --- Rolling a URL's work events up into its content_urls row --------------
// Mirrors latestWork/publishedAtOf in lib/sync/sheet.ts.
const latestWork = (works) =>
  works.reduce((latest, work) => {
    const a = work.workedAt ?? "";
    const b = latest.workedAt ?? "";
    if (a !== b) return a > b ? work : latest;
    return (work.sourceRowNumber ?? 0) >= (latest.sourceRowNumber ?? 0) ? work : latest;
  });
const publishedAtOf = (works) => {
  const created = works.filter((w) => w.workKind === "new" && w.workedAt).map((w) => w.workedAt);
  return created.length > 0 ? created.reduce((earliest, d) => (d < earliest ? d : earliest)) : null;
};

const written = { workedAt: "2026-01-05", workType: "new post", workKind: "new", memberName: "An", sourceRowNumber: 2 };
const audited = { workedAt: "2026-08-20", workType: "audit", workKind: "existing", memberName: "Binh", sourceRowNumber: 40 };

// The auditor becomes the current owner, but the publish date stays in January.
assert.equal(latestWork([written, audited]).memberName, "Binh");
assert.equal(publishedAtOf([written, audited]), "2026-01-05");
// Re-audited a second time: still January, still not a birth date.
assert.equal(publishedAtOf([written, audited, { ...audited, workedAt: "2026-09-01" }]), "2026-01-05");
// A URL we have only ever seen audited has no publish date at all — "already live".
assert.equal(publishedAtOf([audited]), null);
// Same day, two rows: the row further down the Sheet speaks for the URL.
assert.equal(latestWork([{ ...written, sourceRowNumber: 7 }, { ...written, memberName: "Chi", sourceRowNumber: 9 }]).memberName, "Chi");

// --- Eligibility -----------------------------------------------------------
// Mirrors isEligible in lib/performance/refresh.ts.
const isEligible = (contentUrl, endDate) => !contentUrl.published_at || contentUrl.published_at <= endDate;
const endDate = "2026-08-25";

// The bug this whole change exists for: a URL audited two days ago still counts.
assert.equal(isEligible({ published_at: null }, endDate), true);
assert.equal(isEligible({ published_at: "2024-03-01" }, endDate), true);
assert.equal(isEligible({ published_at: endDate }, endDate), true);
// A post genuinely created after the window is still held back.
assert.equal(isEligible({ published_at: "2026-08-27" }, endDate), false);

console.log("Work event verification passed.");
