/*
 * The report's tab taxonomy, pinned.
 *
 * Three rules lived inline in ResultPanel.tsx and none of them was reachable by
 * a test: the id list, the "the selected tab just disappeared" fallback, and —
 * new here — the URL hash a recruiter can send a colleague. A deep link is a
 * round trip (write the hash, read it back on the other machine), and a round
 * trip that only exists inside a component is a round trip nobody checks.
 *
 * Non-vacuity: written before resultTabs.ts existed; the whole file was red on
 * a missing module.
 *
 * Runner: node:test — `npm run test:unit`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RESULT_TAB_IDS,
  isResultTab,
  parseResultTabHash,
  resolveActiveTab,
  resultTabHash,
  type ResultTab,
} from "./resultTabs.ts";

test("every tab id round-trips through its hash", () => {
  for (const id of RESULT_TAB_IDS) {
    assert.equal(parseResultTabHash(resultTabHash(id), RESULT_TAB_IDS), id, id);
  }
});

test("the hash is namespaced, so it can never collide with an in-page anchor", () => {
  for (const id of RESULT_TAB_IDS) {
    assert.match(resultTabHash(id), /^#report-/);
  }
  assert.equal(parseResultTabHash("#salary", RESULT_TAB_IDS), null, "a bare id is not our hash");
  assert.equal(parseResultTabHash("#report-nope", RESULT_TAB_IDS), null, "an unknown tab is not a tab");
  assert.equal(parseResultTabHash("", RESULT_TAB_IDS), null);
  assert.equal(parseResultTabHash("#", RESULT_TAB_IDS), null);
});

test("a hash for a tab this report does not have resolves to null, not a blank panel", () => {
  // The Compare and GitHub tabs are conditional: a link to #report-compare that
  // lands on a single-CV report must fall through to the default, not select a
  // tab with nothing behind it.
  const available: ResultTab[] = ["extraction", "jobFit", "salary", "interview"];
  assert.equal(parseResultTabHash("#report-compare", available), null);
  assert.equal(parseResultTabHash("#report-github", available), null);
  assert.equal(parseResultTabHash("#report-salary", available), "salary");
});

test("a leading '#' is optional — location.hash carries it, a stored value may not", () => {
  assert.equal(parseResultTabHash("report-jobFit", RESULT_TAB_IDS), "jobFit");
});

test("resolveActiveTab keeps a live tab and falls back to the first when it vanished", () => {
  const ids: ResultTab[] = ["extraction", "jobFit", "salary"];
  assert.equal(resolveActiveTab("salary", ids), "salary");
  // The panel instance survives across analyses: running a multi-variant compare
  // (which defaults to "compare") and then a single-CV analysis drops the tab the
  // state still points at. Without the fallback the panel renders blank.
  assert.equal(resolveActiveTab("compare", ids), "extraction");
  assert.equal(resolveActiveTab("extraction", []), null, "no tabs at all has no answer to give");
});

test("isResultTab is the runtime guard for the derived union", () => {
  assert.equal(isResultTab("salary"), true);
  assert.equal(isResultTab("Salary"), false);
  assert.equal(isResultTab(null), false);
  assert.equal(isResultTab(undefined), false);
});
