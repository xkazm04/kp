/*
 * The two pure derivations the Compare tab renders from, pinned.
 *
 * `collidingLabelBadges` — variant labels are NOT unique (two CV variants can
 * both be "CV.pdf"), and duplicate columns are otherwise indistinguishable. The
 * rule is deliberately narrow: number only the colliding ones, so a report with
 * unique labels stays noise-free. Both halves were invisible to tests inside an
 * IIFE in CompareTab.tsx.
 *
 * `driverMessage` — the localizable descriptor for one structured driver
 * insight: a catalog key plus its ICU values. Splitting the key/values choice
 * from `t()` is what makes "does a `driver` insight name its component?"
 * answerable without a React renderer.
 *
 * Non-vacuity: written before compareView.ts existed — red on a missing module.
 * Runner: node:test — `npm run test:unit`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { collidingLabelBadges, driverMessage } from "./compareView.ts";

test("unique labels get no badges at all", () => {
  assert.deepEqual(collidingLabelBadges(["CV.pdf", "resume.docx"]), [null, null]);
});

test("colliding labels are numbered 1..n in column order, others left alone", () => {
  assert.deepEqual(collidingLabelBadges(["CV.pdf", "other.pdf", "CV.pdf", "CV.pdf"]), [1, null, 2, 3]);
});

test("an empty comparison has no badges", () => {
  assert.deepEqual(collidingLabelBadges([]), []);
});

// Identity resolvers: the test is about which key and which values, not about
// the wording, which lives in the four catalogs.
const labels = { component: (c: string) => `«${c}»`, metric: (m: "overall" | "jobFit") => `«${m}»` };

test("each driver kind picks its own catalog key", () => {
  assert.equal(driverMessage({ kind: "tie", best: "A", other: "B", metric: "overall", score: 71 }, labels).key, "compare.narrativeTie");
  assert.equal(
    driverMessage({ kind: "delta", best: "A", other: "B", dir: "lead", amount: 6, metric: "jobFit", bestScore: 80, otherScore: 74 }, labels).key,
    "compare.narrativeDelta"
  );
  assert.equal(driverMessage({ kind: "driver", component: "skills", dir: "win", amount: 9, other: "B" }, labels).key, "compare.narrativeDriver");
  assert.equal(driverMessage({ kind: "uniqueBest", best: "A", skills: ["Go"] }, labels).key, "compare.narrativeUniqueBest");
  assert.equal(driverMessage({ kind: "uniqueOther", other: "B", skills: ["Rust"] }, labels).key, "compare.narrativeUniqueOther");
});

test("the metric and component words go through the caller's localized resolvers", () => {
  const tie = driverMessage({ kind: "tie", best: "A", other: "B", metric: "overall", score: 71 }, labels);
  assert.equal(tie.values.metric, "«overall»", "a raw 'overall' would ship English into every locale");
  const driver = driverMessage({ kind: "driver", component: "roleSeniority", dir: "win", amount: 9, other: "B" }, labels);
  assert.equal(driver.values.component, "«roleSeniority»");
});

test("skill lists arrive joined, so the catalog line takes one placeholder", () => {
  const m = driverMessage({ kind: "uniqueBest", best: "A", skills: ["Go", "Rust"] }, labels);
  assert.equal(m.values.skills, "Go, Rust");
});
