import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./alias-hooks.mjs", pathToFileURL("./scripts/"));

const { deriveTableView } = await import("../lib/table-view.ts");

const rows = [
  { id: "a", member: "Đức", project: "Alpha", clicks: 10, status: "ok" },
  { id: "b", member: "An", project: "Beta", clicks: null, status: "no_data" },
  { id: "c", member: "Bình", project: "Alpha", clicks: 30, status: "ok" },
];
const columns = [
  { id: "member", label: "Member", value: (row) => row.member },
  { id: "project", label: "Project", value: (row) => row.project, groupable: true },
  { id: "clicks", label: "Clicks", value: (row) => row.clicks, type: "number" },
  { id: "status", label: "Status", value: (row) => row.status, groupable: true },
];
const base = {
  query: "",
  sortColumn: "clicks",
  sortDirection: "desc",
  filterColumn: "",
  filterOperator: "contains",
  filterValue: "",
  groupColumn: "",
};

assert.deepEqual(deriveTableView(rows, columns, base).visibleRows.map((row) => row.id), ["c", "a", "b"]);
assert.deepEqual(
  deriveTableView(rows, columns, { ...base, query: "duc" }).visibleRows.map((row) => row.id),
  ["a"],
  "search should ignore Vietnamese diacritics",
);
assert.deepEqual(
  deriveTableView(rows, columns, {
    ...base,
    filterColumn: "clicks",
    filterOperator: "gte",
    filterValue: "20",
  }).visibleRows.map((row) => row.id),
  ["c"],
);
const grouped = deriveTableView(rows, columns, { ...base, groupColumn: "project" });
assert.deepEqual(grouped.groups.map((group) => [group.label, group.rows.map((row) => row.id)]), [
  ["Alpha", ["c", "a"]],
  ["Beta", ["b"]],
]);

console.log("table view verification passed");
