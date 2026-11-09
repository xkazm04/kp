import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { showDomFooter } from "./windowing.ts";

// The "N rows in the DOM" footer is the DataTable default and hides only on an explicit opt-out.
test("the footer shows by default and hides only when domFooter is false", () => {
  assert.equal(showDomFooter(), true);
  assert.equal(showDomFooter(undefined), true);
  assert.equal(showDomFooter(true), true);
  assert.equal(showDomFooter(false), false);
});

test("DataTable forwards the opt-out and the pager gates the count on it", () => {
  const table = readFileSync(new URL("./DataTable.tsx", import.meta.url), "utf8");
  const pager = readFileSync(new URL("./DataTablePager.tsx", import.meta.url), "utf8");
  assert.match(table, /domFooter\?: boolean/);
  assert.match(table, /domFooter=\{domFooter\}/);
  assert.match(pager, /showDomFooter\(domFooter\) \? <DomCount/);
});

test("the Docket's role table shows the same count, reusing the existing message key", () => {
  const ov = readFileSync(new URL("../../features/hiring/decisions/docket/DocketRoleOverview.tsx", import.meta.url), "utf8");
  assert.match(ov, /<DomCount count=\{rows\.length\} \/>/);
  const dom = readFileSync(new URL("./DomCount.tsx", import.meta.url), "utf8");
  assert.match(dom, /useTranslations\("kit\.table"\)/);
  assert.match(dom, /t\("dom", \{ count \}\)/);
});
