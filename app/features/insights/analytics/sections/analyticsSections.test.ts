// The ?sec= vocabulary. Small surface, but the guard is the thing that stops a
// stale or hand-edited link from resolving to a blank section — the exact bug
// tabs.ts documents for ?tab= (a deep link to a valid-looking id landing on the
// default with no error, or worse, on nothing).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ANALYTICS_SECTION_IDS,
  DEFAULT_ANALYTICS_SECTION,
  isAnalyticsSectionId,
  resolveAnalyticsSection,
} from "./analyticsSections.ts";

test("the guard accepts exactly the declared ids", () => {
  for (const id of ANALYTICS_SECTION_IDS) assert.ok(isAnalyticsSectionId(id), `${id} must be accepted`);
  assert.equal(isAnalyticsSectionId("pipeline"), false);
  assert.equal(isAnalyticsSectionId("Performance"), false, "ids are case-sensitive");
  assert.equal(isAnalyticsSectionId(""), false);
  assert.equal(isAnalyticsSectionId(null), false);
  assert.equal(isAnalyticsSectionId(undefined), false);
});

test("the default section is itself a declared id", () => {
  // Guards against a rename that leaves the default pointing at nothing — which
  // would blank the tab for every visitor arriving without a ?sec=.
  assert.ok(isAnalyticsSectionId(DEFAULT_ANALYTICS_SECTION));
});

test("resolve falls back to the default for anything unknown", () => {
  assert.equal(resolveAnalyticsSection(null), DEFAULT_ANALYTICS_SECTION);
  assert.equal(resolveAnalyticsSection(undefined), DEFAULT_ANALYTICS_SECTION);
  assert.equal(resolveAnalyticsSection(""), DEFAULT_ANALYTICS_SECTION);
  assert.equal(resolveAnalyticsSection("nope"), DEFAULT_ANALYTICS_SECTION);
  assert.equal(resolveAnalyticsSection("quality"), "quality", "a valid id passes through untouched");
});
