import { test } from "node:test";
import assert from "node:assert/strict";
import { meterCta, meterWarnAt } from "./billingMeterCta.ts";

test("depleted interview_minutes offers the pack, not an upgrade", () => {
  assert.equal(meterCta("interview_minutes", 0, 30), "pack");
});

test("depleted outcome/compute meters offer Upgrade", () => {
  assert.equal(meterCta("job_posts", 0, 1), "upgrade");
  assert.equal(meterCta("hires", 0, 1), "upgrade");
  assert.equal(meterCta("ai_candidates", 0, 25), "upgrade");
  assert.equal(meterCta("case_designs", 0, 1), "upgrade");
});

test("job_posts remaining 1 of 3 is approaching-limit, not depleted", () => {
  assert.equal(meterCta("job_posts", 1, 3), "warn");
  assert.equal(meterWarnAt(3), 1);
});

test("unlimited never warns and never CTAs", () => {
  assert.equal(meterCta("ai_candidates", 0, null), null);
  assert.equal(meterCta("ai_candidates", 12, null), null);
  assert.equal(meterWarnAt(null), 0);
});

test("comfortable remaining is silent", () => {
  assert.equal(meterCta("ai_candidates", 200, 300), null);
  assert.equal(meterCta("interview_minutes", 20, 30), null);
});
