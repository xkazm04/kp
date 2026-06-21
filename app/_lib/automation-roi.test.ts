import { test } from "node:test";
import assert from "node:assert/strict";
import { automationRoi, DEFAULT_RECRUITER_HOURLY_CZK, MANUAL_HOURS_PER_HIRE } from "./automation-roi.ts";

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

test("measures saved labor against the manual per-hire baseline (UAT M7)", () => {
  // 100 scored (8) + 50 matched (5) = 800 + 250 = 1050 min = 17.5 h, over 5 hires.
  const roi = automationRoi({ scored: 100, matched: 50 }, 600, 5);
  assert.equal(roi.hires, 5);
  assert.equal(roi.hoursSavedPerHire, 3.5); // 17.5 / 5
  assert.equal(roi.czkSavedPerHire, 2100); // 3.5 h × 600
  assert.equal(roi.manualBaselineHoursPerHire, MANUAL_HOURS_PER_HIRE);
  assert.equal(roi.pctOfManualBaseline, 8); // 3.5 / 42 = 8.33% → 8
});

test("per-hire figures are null without hires (no divide-by-zero lie)", () => {
  const roi = automationRoi({ scored: 100 }, 600);
  assert.equal(roi.hires, 0);
  assert.equal(roi.hoursSavedPerHire, null);
  assert.equal(roi.czkSavedPerHire, null);
  assert.equal(roi.pctOfManualBaseline, null);
});

test("pctOfManualBaseline caps at 100 — can't offset more than full", () => {
  // 1 hire, heavy automation: 1000 scored × 8 = 8000 min = 133 h vs the 42 h baseline.
  const roi = automationRoi({ scored: 1000 }, 600, 1);
  assert.equal(roi.pctOfManualBaseline, 100);
});

test("a custom baseline overrides the default", () => {
  // 24 prep × 25 = 600 min = 10 h over 1 hire, against a 20 h baseline → 50%.
  const roi = automationRoi({ interview_prep_generated: 24 }, 600, 1, 20);
  assert.equal(roi.manualBaselineHoursPerHire, 20);
  assert.equal(roi.hoursSavedPerHire, 10);
  assert.equal(roi.pctOfManualBaseline, 50);
});
