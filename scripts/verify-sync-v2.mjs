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

const dates = await loadTsModule("../lib/sync/parse-date.ts");
const urls = await loadTsModule("../lib/sync/normalize-url.ts");
const concurrency = await loadTsModule("../lib/concurrency.ts");

assert.deepEqual(dates.parseSheetDate("2026-01-05"), { value: "2026-01-05", error: null });
assert.deepEqual(dates.parseSheetDate("05/01/2026"), { value: "2026-01-05", error: null });
assert.deepEqual(dates.parseSheetDate("1/5/2026"), { value: "2026-05-01", error: null });
assert.deepEqual(dates.parseSheetDate("Jan 5, 2026"), { value: "2026-01-05", error: null });
assert.deepEqual(dates.parseSheetDate(46027), { value: "2026-01-05", error: null });
assert.deepEqual(dates.parseSheetDate(""), { value: null, error: null });
assert.match(dates.parseSheetDate("hom qua").error, /unparseable date/);
assert.match(dates.parseSheetDate("31/02/2026").error, /unparseable date/);

assert.equal(urls.normalizeForGscMatch("HTTPS://Ex.com/A/"), "https://ex.com/A");
assert.equal(
  urls.normalizeForGscMatch("https://ex.com/tin-t%E1%BB%A9c"),
  urls.normalizeForGscMatch("https://ex.com/tin-tức"),
);

let active = 0;
let peak = 0;
const ordered = await concurrency.mapWithConcurrency([...Array(10).keys()], 3, async (value) => {
  active += 1;
  peak = Math.max(peak, active);
  await new Promise((resolve) => setTimeout(resolve, (10 - value) * 2));
  active -= 1;
  return value * 2;
});
assert.deepEqual(ordered, [...Array(10).keys()].map((value) => value * 2));
assert.ok(peak <= 3);

let attempts = 0;
await assert.rejects(
  concurrency.withRetry(async () => {
    attempts += 1;
    throw Object.assign(new Error("forbidden"), { code: 403 });
  }, { baseDelayMs: 1 }),
  /forbidden/,
);
assert.equal(attempts, 1);

attempts = 0;
const retried = await concurrency.withRetry(async () => {
  attempts += 1;
  if (attempts < 3) throw Object.assign(new Error("rate limited"), { code: 429 });
  return "ok";
}, { baseDelayMs: 1 });
assert.equal(retried, "ok");
assert.equal(attempts, 3);

// A limiter is global to every caller sharing it. Nested property/URL schedulers
// must not multiply the configured concurrency.
active = 0;
peak = 0;
const limiter = concurrency.createLimiter(2);
await Promise.all([...Array(12).keys()].map((value) => limiter.run(async () => {
  active += 1;
  peak = Math.max(peak, active);
  await new Promise((resolve) => setTimeout(resolve, (value % 3) + 1));
  active -= 1;
})));
assert.equal(peak, 2);

assert.equal(concurrency.isRetryableHttpError(Object.assign(new Error("reset"), { code: "ECONNRESET" })), true);
assert.equal(concurrency.isRetryableHttpError({ response: { status: 503 } }), true);
assert.equal(concurrency.isRetryableHttpError({ response: { status: 403 } }), false);

console.log("Sync v2 verification passed.");
