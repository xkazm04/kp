// The Background-tasks search predicate. Pure — no DB, no next-intl runtime.
import { test } from "node:test";
import assert from "node:assert/strict";
import { taskMatchesSearch, taskSearchNeedle } from "./taskSearch.ts";

const matches = (label: string, kind: string, typed: string) =>
  taskMatchesSearch(label, kind, taskSearchNeedle(typed));

test("an empty or blank needle is the no-filter state", () => {
  assert.equal(matches("Screening the board", "batch_screen", ""), true);
  assert.equal(matches("Screening the board", "batch_screen", "   "), true);
});

test("the RENDERED label is the haystack, so search speaks the reader's language", () => {
  // The column holds `kp.tl:{"k":"batchScreen"}`; the row shows the resolved sentence.
  assert.equal(matches("Prověřování kandidátů", "batch_screen", "kandid"), true);
  assert.equal(matches("Prověřování kandidátů", "batch_screen", "kp.tl"), false);
});

test("diacritics are folded on both sides", () => {
  // The whole point for cs/de/fr: typing the unaccented form finds the accented label,
  // and the accented form still finds it too.
  assert.equal(matches("Průběh náboru", "lifecycle", "prubeh"), true);
  assert.equal(matches("Průběh náboru", "lifecycle", "PRŮBĚH"), true);
  assert.equal(matches("Übernahme der Rolle", "jd_build", "ubernahme"), true);
  assert.equal(matches("Évaluation du rendu", "evaluate_submission", "evaluation"), true);
  // Folding must not turn everything into a match.
  assert.equal(matches("Průběh náboru", "lifecycle", "zaverecny"), false);
});

test("case is folded and surrounding whitespace on the needle is ignored", () => {
  assert.equal(matches("Drafting 8 letters", "batch_outreach", "  DRAFTING "), true);
});

test("the raw kind stays a second haystack for operators who know it", () => {
  assert.equal(matches("Drafting 8 letters", "batch_outreach", "batch_outreach"), true);
  assert.equal(matches("Drafting 8 letters", "batch_outreach", "outreach"), true);
  // A row whose label fell back to the kind is still findable by either.
  assert.equal(matches("repo_scan", "repo_scan", "scan"), true);
});

test("a needle matching neither haystack filters the row out", () => {
  assert.equal(matches("Drafting 8 letters", "batch_outreach", "interview"), false);
});

test("the needle is prepared once and reused across rows", () => {
  const needle = taskSearchNeedle("  NÁBORU ");
  assert.equal(needle, "naboru", "folded and trimmed exactly once");
  assert.equal(taskMatchesSearch("Průběh náboru", "lifecycle", needle), true);
  assert.equal(taskMatchesSearch("Drafting 8 letters", "batch_outreach", needle), false);
});
