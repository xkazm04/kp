// The corpus table's ordering contract. The rule under test is the one a
// hand-rolled accessor gets wrong every time: a MISSING value is not a small
// value, and the shared comparator can only honour that if the accessor hands it
// `null` rather than "" or 0.

import test from "node:test";
import assert from "node:assert/strict";
import { bandFloor, entryScore, JOB_SORT_ACCESSORS } from "./jobsTableView.ts";
import type { Job } from "./JobsTypes.ts";

const job = (over: Partial<Job>) => ({ id: "job-1", title: "Backend Engineer", ...over }) as Job;

test("a salary band sorts by its floor, and an absent band is missing, not zero", () => {
  assert.equal(bandFloor([80000, 110000]), 80000);
  assert.equal(bandFloor(undefined), null);
  assert.equal(bandFloor([]), null);
  // A one-ended band is not a band: the cell renders "—", so the sort must agree.
  assert.equal(bandFloor([80000]), null);
  assert.equal(JOB_SORT_ACCESSORS.salary(job({ salaryBand: [45000, 70000] })), 45000);
  assert.equal(JOB_SORT_ACCESSORS.salary(job({})), null);
});

test("entry score ranks only ELIGIBLE roles; not-eligible is missing, not 0%", () => {
  assert.equal(entryScore(job({ entryProfile: { isEntryEligible: true, graduateFriendliness: 0.84 } as never })), 0.84);
  // Eligible but unscored: still no number to rank by.
  assert.equal(entryScore(job({ entryProfile: { isEntryEligible: true } as never })), null);
  // NOT eligible must not sort as a 0% eligible role — different facts.
  assert.equal(entryScore(job({ entryProfile: { isEntryEligible: false, graduateFriendliness: 0.4 } as never })), null);
  assert.equal(entryScore(job({})), null);
});

test("empty text cells resolve to null so they sort last in both directions", () => {
  assert.equal(JOB_SORT_ACCESSORS.location(job({ location: "" })), null);
  assert.equal(JOB_SORT_ACCESSORS.location(job({ location: "Praha" })), "Praha");
  assert.equal(JOB_SORT_ACCESSORS.mode(job({})), null);
  assert.equal(JOB_SORT_ACCESSORS.seniority(job({ seniority: "senior" })), "senior");
  assert.equal(JOB_SORT_ACCESSORS.family(job({ roleFamily: "software" })), "software");
  assert.equal(JOB_SORT_ACCESSORS.title(job({ title: "" })), null);
});
