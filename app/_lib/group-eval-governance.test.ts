// P1-3: group-eval governance modes (committee / eligibility-list make the AI
// advisory; it never auto-seals a single lead).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildEligibilityList,
  governanceNote,
  normalizeGovernanceMode,
  sealsLead,
} from "./group-eval-governance.ts";

test("normalizeGovernanceMode accepts the three modes, defaults junk to recommendation", () => {
  assert.equal(normalizeGovernanceMode("committee"), "committee");
  assert.equal(normalizeGovernanceMode("eligibility_list"), "eligibility_list");
  assert.equal(normalizeGovernanceMode("recommendation"), "recommendation");
  assert.equal(normalizeGovernanceMode("nonsense"), "recommendation");
  assert.equal(normalizeGovernanceMode(null), "recommendation");
  assert.equal(normalizeGovernanceMode(undefined), "recommendation");
});

test("only recommendation mode may auto-seal a single lead", () => {
  assert.equal(sealsLead("recommendation"), true);
  assert.equal(sealsLead("committee"), false);
  assert.equal(sealsLead("eligibility_list"), false);
});

test("buildEligibilityList ranks 1..N in order and excludes ko-failed (not eligible)", () => {
  const list = buildEligibilityList([
    { entryId: "e1", label: "Ada", score: 88, koPassed: true },
    { entryId: "e2", label: "Ben", score: 71 }, // koPassed undefined → eligible
    { entryId: "e3", label: "Cara", score: 95, koPassed: false }, // excluded
    { entryId: "e4", label: "Dan", score: 60, koPassed: true },
  ]);
  assert.deepEqual(
    list,
    [
      { rank: 1, entryId: "e1", label: "Ada", score: 88 },
      { rank: 2, entryId: "e2", label: "Ben", score: 71 },
      { rank: 3, entryId: "e4", label: "Dan", score: 60 },
    ]
  );
});

test("governanceNote: none for recommendation; committee + eligibility carry guidance", () => {
  assert.equal(governanceNote("recommendation"), null);
  assert.match(governanceNote("committee") ?? "", /committee/i);
  const elig = governanceNote("eligibility_list") ?? "";
  assert.match(elig, /statutory|veterans/i); // names the demographic-data ceiling
});
