import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { canRaiseCaseLimit, casesListUrl, nextCaseLimit } from "./casesPage.ts";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, "..", "..", "..", "..");

test("the load-more ladder is 50 → 150 → 500 and then sticks", () => {
  assert.equal(nextCaseLimit(50), 150);
  assert.equal(nextCaseLimit(150), 500);
  assert.equal(nextCaseLimit(500), 500);
  assert.equal(canRaiseCaseLimit(50), true);
  assert.equal(canRaiseCaseLimit(500), false);
  assert.equal(casesListUrl(150), "/api/devcase?limit=150");
});

test("truncated true shows a load-more control and the next fetch uses a higher limit", () => {
  const dataSrc = readFileSync(path.join(DIR, "useDevTabData.ts"), "utf8");
  assert.match(dataSrc, /casesListUrl\(caseLimit\)/);
  assert.match(dataSrc, /setCaseLimit\(\(n\) => nextCaseLimit\(n\)\)/);
  const tableSrc = readFileSync(path.join(DIR, "DevCasesTable.tsx"), "utf8");
  assert.match(tableSrc, /onLoadMore/);
  assert.match(tableSrc, /t\("loadMore"\)/);
});

test("loadMore exists in all four catalogs", () => {
  for (const locale of ["en", "cs", "de", "fr"]) {
    const table = JSON.parse(readFileSync(path.join(ROOT, "messages", `${locale}.json`), "utf8")).devcase.casesTable;
    assert.ok(String(table.loadMore ?? "").trim(), `${locale} casesTable.loadMore`);
  }
});
