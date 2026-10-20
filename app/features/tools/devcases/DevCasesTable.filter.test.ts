import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { EMPTY_CASE_FILTERS, caseFiltersActive } from "./DevCasesTable.filter.ts";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(path.join(DIR, file), "utf8");

test("a filter counts as active only when it would narrow the query", () => {
  assert.equal(caseFiltersActive(EMPTY_CASE_FILTERS), false);
  assert.equal(caseFiltersActive({ title: "   ", stage: "", seniority: "" }), false);
  assert.equal(caseFiltersActive({ title: "api", stage: "", seniority: "" }), true);
  assert.equal(caseFiltersActive({ title: "", stage: "collecting", seniority: "" }), true);
  assert.equal(caseFiltersActive({ title: "", stage: "", seniority: "senior" }), true);
});

// challenge-r03 devcase-workspace/A, case 8. The table used to derive each row's stage,
// submission count and stall from the lifecycle list (the 50 newest) and every posting
// with every submission. Those numbers now arrive ON the row, computed by the store over
// the whole workspace - so the table must not reach for the lists again.
test("the Cases table reads stage, submissions and stall inputs from the ledger row", () => {
  const table = read("DevCasesTable.tsx");
  assert.doesNotMatch(table, /\bcaseStage\b|\bfilterCases\b/, "the client-side stage join is gone");
  assert.doesNotMatch(table, /lifecycles\.find|postings\.filter/, "no per-row join against the side lists");
  assert.doesNotMatch(table, /\blifecycles\s*[:?]|\bpostings\s*[:?]/, "the table takes no lifecycle or posting list");
  assert.match(table, /c\.stage/);
  assert.match(table, /c\.submissionCount/);
  assert.match(table, /c\.lifecycleUpdatedAt/);
  const filter = read("DevCasesTable.filter.ts");
  assert.doesNotMatch(filter, /export function (caseStage|filterCases)\b/, "the in-memory filter is replaced by the server query");
});

test("opening a row fetches the full record by id for the detail reader", () => {
  const view = read("DevTabCasesView.tsx");
  assert.match(view, /\/api\/devcase\/\$\{encodeURIComponent\(/, "the detail is read from GET /api/devcase/[id]");
  const tab = read("DevTab.tsx");
  assert.doesNotMatch(tab, /cases\.find\(/, "the detail no longer resolves from the loaded ledger page");
});
