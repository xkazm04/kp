import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLASSIFICATION,
  DISCLAIMER,
  OBLIGATIONS,
  SUBPROCESSORS,
  byWeakestFirst,
  postureSummary,
} from "./trust-posture.ts";

// This page makes public claims about a regulated system. These tests exist so a future
// edit cannot quietly turn it into a badge — the failure mode being guarded is
// "everything is green", not a rendering bug.

test("every obligation states a checkable summary", () => {
  for (const r of OBLIGATIONS) {
    assert.ok(r.article.startsWith("Art."), `${r.title}: article must be cited, not paraphrased`);
    assert.ok(r.summary.length > 40, `${r.article}: summary too thin to be checked`);
  }
});

test("a non-enforced obligation must NAME its gap", () => {
  // The whole value of the page: partial and missing rows say what is missing. A row that
  // claims less than full enforcement without saying why is worse than no row.
  for (const r of OBLIGATIONS) {
    if (r.posture !== "enforced") {
      assert.ok(r.gap && r.gap.length > 20, `${r.article} is ${r.posture} but names no gap`);
    }
  }
});

test("the page is not all-green — it publishes real gaps", () => {
  const s = postureSummary();
  assert.ok(s.partial + s.not_yet >= 3, "a trust page with nothing outstanding is a badge, not evidence");
  assert.ok(s.enforced >= 1, "and it should still show what IS enforced");
});

test("weakest-first ordering leads with what is missing", () => {
  const ordered = byWeakestFirst();
  assert.equal(ordered[0].posture, "not_yet");
  assert.equal(ordered.at(-1)!.posture, "enforced");
  assert.equal(ordered.length, OBLIGATIONS.length);
});

test("classification does not hedge on high-risk or on the derogation", () => {
  assert.match(CLASSIFICATION.conclusion, /high-risk/);
  assert.match(CLASSIFICATION.annex, /Annex III/);
  // Art. 6(3) is the standard escape hatch; explicitly disclaiming it is the point.
  assert.match(CLASSIFICATION.derogation, /does not apply/);
  assert.match(CLASSIFICATION.providerRole, /deployer/);
});

test("the two articles kp leads on are the two it claims as enforced", () => {
  // Record-keeping and human oversight are the competitive claims (auditable decisions,
  // a human signs every call). If either ever drops below enforced, the marketing must
  // change with it — this test is the tripwire.
  const byArticle = Object.fromEntries(OBLIGATIONS.map((r) => [r.article, r.posture]));
  assert.equal(byArticle["Art. 12"], "enforced");
  assert.equal(byArticle["Art. 14"], "enforced");
});

test("every subprocessor is optional — the self-host path must stay real", () => {
  // kp advertises an air-gapped install. A mandatory external processor would make that
  // claim false, so the invariant is checked rather than trusted.
  for (const s of SUBPROCESSORS) {
    assert.equal(s.optional, true, `${s.name} is listed as mandatory`);
    assert.ok(s.purpose.length > 10, `${s.name} has no stated purpose`);
  }
});

test("the disclaimer refuses to claim certified conformance", () => {
  assert.match(DISCLAIMER, /not a claim of certified conformance/);
  assert.match(DISCLAIMER, /not legal advice/);
});
