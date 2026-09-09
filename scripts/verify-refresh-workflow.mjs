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

const preflight = await loadTsModule("../lib/performance/refresh-preflight.ts");
const publication = await loadTsModule("../lib/performance/refresh-publication.ts");
const properties = await loadTsModule("../lib/gsc-property.ts");

const baseUrl = {
  id: "00000000-0000-0000-0000-000000000001",
  url_hash: "hash", content_hash: null, project: "Project A", url: "https://shop.example.com/one",
  member_name: "Member", member_email: null, work_type: "audit", gsc_property: "https://legacy.example/",
  is_active: true, worked_at: null, first_worked_at: null, published_at: null,
  kpi_excluded: false, kpi_excluded_reason: null, kpi_excluded_at: null,
  first_seen_at: "2026-01-01", last_seen_at: "2026-01-01",
};

assert.throws(
  () => preflight.preflightRefreshUrls([baseUrl, { ...baseUrl, id: "00000000-0000-0000-0000-000000000002", project: "Project B" }], "2026-09-01", new Map(), new Set()),
  (error) => error.code === "MISSING_GSC_MAPPING" && error.projects.length === 2 && error.projects[0].affectedUrlCount === 1,
);

assert.throws(
  () => preflight.preflightRefreshUrls([baseUrl], "2026-09-01", new Map([["Project A", "sc-domain:example.com"]]), new Set()),
  (error) => error.code === "PROPERTY_ACCESS_DENIED" && error.projects[0].gscProperty === "sc-domain:example.com",
);

const resolved = preflight.preflightRefreshUrls(
  [baseUrl, { ...baseUrl, id: "00000000-0000-0000-0000-000000000003", project: "Future", published_at: "2026-10-01" }],
  "2026-09-01",
  new Map([["Project A", "sc-domain:example.com"]]),
  new Set(["sc-domain:example.com"]),
);
assert.equal(resolved[0].gsc_property, "sc-domain:example.com");
assert.equal(resolved[1].gsc_property, null);

assert.deepEqual(publication.refreshPublicationOutcome(238, 0), { status: "success", publish: true });
assert.deepEqual(publication.refreshPublicationOutcome(238, 1), { status: "partial", publish: false });
assert.deepEqual(publication.refreshPublicationOutcome(238, 238), { status: "failed", publish: false });

assert.equal(properties.gscPropertyCoversUrl("sc-domain:example.com", "https://shop.example.com/a"), true);
assert.equal(properties.gscPropertyCoversUrl("https://shop.example.com/blog/", "https://shop.example.com/blog/a"), true);
assert.equal(properties.gscPropertyCoversUrl("https://shop.example.com/blog/", "https://shop.example.com/products/a"), false);
assert.equal(properties.gscPropertyCoversUrl("https://shop.example.com/", "http://shop.example.com/a"), false);

console.log("Refresh workflow verification passed.");
