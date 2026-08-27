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

const google = await loadTsModule("../lib/google-errors.ts");
const growth = await loadTsModule("../lib/performance/growth.ts");

assert.equal(google.classifyGoogleApiError({ response: { status: 429 } }), "rate_limited");
assert.equal(google.classifyGoogleApiError({ response: { status: 503 } }), "transient");
assert.equal(google.classifyGoogleApiError({ code: "ECONNRESET" }), "transient");
assert.equal(google.classifyGoogleApiError({ name: "AbortError" }), "transient");
assert.equal(google.classifyGoogleApiError({ response: { status: 403 } }), "permission_denied");
assert.equal(google.isWideQueryUnsupported({ response: { status: 400 }, message: "Invalid dimension query" }), true);
assert.equal(google.isWideQueryUnsupported({ response: { status: 429 }, message: "rate limited" }), false);

assert.equal(growth.computeGrowth(null, null, true).dataStatus, "no_data");
assert.equal(growth.computeGrowth(null, null, false).dataStatus, "not_eligible");
assert.equal(growth.computeGrowth({ clicks: 0, impressions: 0, ctr: 0, position: 0 }, null, true).dataStatus, "ok");

console.log("Refresh range verification passed.");
