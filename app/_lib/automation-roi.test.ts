import { test } from "node:test";
import assert from "node:assert/strict";
import { automationRoi, DEFAULT_RECRUITER_HOURLY_CZK } from "./automation-roi.ts";

test("aggregates minutes/hours/CZK from the per-kind estimates", () => {
  // 10 scored (8 min) + 5 outreach (6 min) + 2 prep (25 min) = 80+30+50 = 160 min
  const roi = automationRoi({ scored: 10, outreach_sent: 5, interview_prep_generated: 2 }, 600);
  assert.equal(roi.minutesSaved, 160);
  assert.equal(roi.totalActions, 17);
  assert.equal(roi.hoursSaved, 2.7); // 160/60 = 2.666… → 2.7
  assert.equal(roi.czkSaved, 1600); // 160/60 * 600
  assert.equal(roi.hourlyRateCzk, 600);
});

test("the breakdown is sorted by time saved, highest first", () => {
  const roi = automationRoi({ scored: 10, interview_prep_generated: 2, advanced: 1 });
  // scored 80, prep 50, advanced 3
  assert.deepEqual(roi.actions.map((a) => a.kind), ["scored", "interview_prep_generated", "advanced"]);
  assert.equal(roi.actions[0].minutesTotal, 80);
});

test("only mapped automated kinds contribute — human/failure kinds are ignored", () => {
  const roi = automationRoi({ applied: 50, rejected: 20, onboarding_failed: 5, advanced: 3 });
  // Only `advanced` (3 × 3 min) counts; the rest aren't saved recruiter labor.
  assert.equal(roi.totalActions, 3);
  assert.equal(roi.minutesSaved, 9);
});

test("a non-positive rate falls back to the default", () => {
  const roi = automationRoi({ scored: 60 }, 0);
  assert.equal(roi.hourlyRateCzk, DEFAULT_RECRUITER_HOURLY_CZK);
  // 60 × 8 = 480 min = 8 h × 600 = 4800
  assert.equal(roi.czkSaved, 4800);
});

test("an empty trail is all zeros", () => {
  const roi = automationRoi({});
  assert.deepEqual(roi.actions, []);
  assert.equal(roi.minutesSaved, 0);
  assert.equal(roi.hoursSaved, 0);
  assert.equal(roi.czkSaved, 0);
});
