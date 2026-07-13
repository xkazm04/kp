import { test } from "node:test";
import assert from "node:assert/strict";
import { automationRoi, DEFAULT_RECRUITER_HOURLY_CZK, MANUAL_HOURS_PER_HIRE, MINUTES_SAVED_PER_KIND } from "./automation-roi.ts";
import { DECISION_META } from "./decision-attribution.ts";

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
  const roi = automationRoi({ scored: 10, interview_prep_generated: 2, auto_advanced: 1 });
  // scored 80, prep 50, auto_advanced 3
  assert.deepEqual(roi.actions.map((a) => a.kind), ["scored", "interview_prep_generated", "auto_advanced"]);
  assert.equal(roi.actions[0].minutesTotal, 80);
});

test("only mapped automated kinds contribute — human/failure kinds are ignored", () => {
  // The automation's OWN advance (`auto_advanced`) is saved labor; a recruiter's
  // gate click (`advanced`) is NOT — crediting it would count human work as
  // automation ROI (bug-ui-scan §hiring-automation #3).
  const roi = automationRoi({ applied: 50, rejected: 20, onboarding_failed: 5, advanced: 99, auto_advanced: 3 });
  // Only `auto_advanced` (3 × 3 min) counts; the human `advanced` and the rest don't.
  assert.equal(roi.totalActions, 3);
  assert.equal(roi.minutesSaved, 9);
  assert.equal(roi.actions.some((a) => a.kind === "advanced"), false, "a human `advanced` must never be credited to automation ROI");
});

test("credits the automation's OWN advance (auto_advanced), never the human advance", () => {
  assert.equal(automationRoi({ auto_advanced: 10 }).minutesSaved, 30); // 10 × 3 min — the machine's advances ARE saved labor
  assert.equal(automationRoi({ advanced: 10 }).minutesSaved, 0); // a recruiter's clicks are not automation ROI
});

test("every ROI-credited kind is an AUTO kind in DECISION_META (bug-ui-scan §hiring-automation #3)", () => {
  // Pin the ROI map's keys against DECISION_META's auto:true set so a future
  // actor split (like the advanced/auto_advanced one that caused #3) can't
  // silently re-key a credit onto human labor. If someone re-adds `advanced`
  // (auto:false) this fails — the credit map keys on the wrong side of the split.
  for (const kind of Object.keys(MINUTES_SAVED_PER_KIND)) {
    const meta = DECISION_META[kind];
    assert.ok(meta, `${kind} is credited by ROI but absent from DECISION_META`);
    assert.equal(meta.auto, true, `${kind} is credited as automation ROI but is not an AUTO kind`);
  }
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
