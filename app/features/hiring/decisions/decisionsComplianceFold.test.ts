// Pins the compliance posture's honesty: a failed read is never a saved choice,
// and an unanswered retention window is never a number.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { foldJurisdiction, foldRetentionMonths } from "./decisionsComplianceFold.ts";

test("a saved jurisdiction reads through as saved", () => {
  assert.deepEqual(foldJurisdiction(true, { configs: { compliance: { jurisdiction: "uk" } } }), { regime: "saved", jurisdiction: "uk" });
});

test("a read that landed with no jurisdiction is the DEFAULT, and says nobody confirmed it", () => {
  const f = foldJurisdiction(true, { configs: { compliance: {} } });
  assert.equal(f.regime, "default-unconfirmed");
  assert.equal(f.jurisdiction, "eu", "the default is still what the disclosure serves");
});

test("a failed read is 'failed', NOT the default silently presented as a choice", () => {
  assert.equal(foldJurisdiction(false, null).regime, "failed");
  assert.equal(foldJurisdiction(false, { configs: { compliance: { jurisdiction: "uk" } } }).regime, "failed", "a body from a failed read is not trusted");
});

test("a regime this build does not know is not honoured as saved", () => {
  assert.equal(foldJurisdiction(true, { configs: { compliance: { jurisdiction: "atlantis" } } }).regime, "default-unconfirmed");
  assert.equal(foldJurisdiction(true, { configs: { compliance: { jurisdiction: 7 } } }).regime, "default-unconfirmed");
});

test("the retention window is the server's number, or null — never a guessed 12", () => {
  assert.equal(foldRetentionMonths(true, { consentRetentionMonths: 6 }), 6);
  assert.equal(foldRetentionMonths(true, {}), null, "an absent window is unknown, not twelve");
  assert.equal(foldRetentionMonths(false, { consentRetentionMonths: 6 }), null, "a failed read carries no window");
  assert.equal(foldRetentionMonths(true, { consentRetentionMonths: 0 }), null);
  assert.equal(foldRetentionMonths(true, { consentRetentionMonths: "12" }), null);
  assert.equal(foldRetentionMonths(true, { consentRetentionMonths: Number.NaN }), null);
});

const src = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("the hook folds both reads and holds no hardcoded window", () => {
  const state = src("decisionsComplianceState.ts");
  assert.match(state, /foldJurisdiction\(/);
  assert.match(state, /foldRetentionMonths\(/);
  assert.doesNotMatch(state, /useState\(12\)/, "no default months are seeded");
  assert.doesNotMatch(state, /\.catch\(\(\) => \{\}\)/, "a failed read is recorded, not swallowed");
});

test("the section prints 'not confirmed' instead of an unanswered number", () => {
  const section = src("DecisionsComplianceSection.tsx");
  assert.match(section, /retentionMonths == null[\s\S]{0,200}covered5Unconfirmed/, "an unknown window gets its own line");
  assert.match(section, /regimeConfidence !== "saved"/, "an unconfirmed jurisdiction is disclosed");
});
