import test from "node:test";
import assert from "node:assert/strict";
import { campaignPackKey, packSurvivingFailure } from "./jobsCampaignPackKey.ts";

// The Campaign tab fetches one pack per (job, language) pair. A failed load must
// not leave the PREVIOUS language's pack on screen under the newly-lit toggle:
// nothing in the pack names its language, so a recruiter who toggled cs -> de into
// a 500 could "Copy all" Czech ad copy onto a German job board.

const cs = { jobId: "jd-be", lang: "cs" as const, payload: {}, source: "llm", createdAt: "" };
const de = { jobId: "jd-be", lang: "de" as const, payload: {}, source: "llm", createdAt: "" };

test("the request key is the (job, lang) pair", () => {
  assert.equal(campaignPackKey("jd-be", "cs"), "jd-be|cs");
  assert.notEqual(campaignPackKey("jd-be", "cs"), campaignPackKey("jd-be", "de"));
  assert.notEqual(campaignPackKey("jd-be", "cs"), campaignPackKey("jd-fe", "cs"));
});

test("a failure under a DIFFERENT language drops the stale pack", () => {
  assert.equal(packSurvivingFailure(cs, campaignPackKey("jd-be", "de")), null);
});

test("a failure under a different JOB drops it too", () => {
  assert.equal(packSurvivingFailure(cs, campaignPackKey("jd-fe", "cs")), null);
});

test("a failed reload of the SAME pair keeps what is already correct on screen", () => {
  assert.equal(packSurvivingFailure(de, campaignPackKey("jd-be", "de")), de);
});

test("nothing on screen stays nothing", () => {
  assert.equal(packSurvivingFailure(null, campaignPackKey("jd-be", "de")), null);
});
