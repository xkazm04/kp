// The analytics goal key space, as ONE registry derived from the workspace's own
// stage axis plus the reserved keys.
//
// What was true before this module existed: three hand-kept vocabularies for one
// table. The save route validated against the SHIPPED five stage names
// (FUNNEL_STAGES) while the funnel and the goals editor spoke the workspace's own
// axis, so a team that added a column was shown a goal field it could never save;
// the ceilings were a route-local ternary; the store's read split turned every
// non-reserved row into a conversion goal with no axis check; and the client kept a
// third copy of the reserved keys by hand.
//
// Pure: no DB, no Next. The route-level half is app/api/analytics/targets/targets-axis.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  CONVERSION_TARGET_MAX,
  MANUAL_HOURS_TARGET_KEY,
  RECRUITER_HOURLY_TARGET_KEY,
  RESERVED_TARGET_KEYS,
  RESERVED_TARGET_SPECS,
  TIME_TO_HIRE_TARGET_KEY,
  liveConversionTargets,
  targetKeySpec,
  validateTargetWrite,
} from "./analytics-target-keys";
import { MANUAL_HOURS_KEY, RECRUITER_HOURLY_KEY, TIME_TO_HIRE_KEY } from "../features/insights/analytics/AnalyticsTypes";

// A customised board: "Tech round" ADDED between Interview and Offer (id minted from
// its label by pipelineAxisDraft.mintStageId), everything else shipped.
const CUSTOM_AXIS = [
  { id: "Accepted", role: "entry" },
  { id: "Screened", role: "screening" },
  { id: "Interview", role: "interview" },
  { id: "Tech round", role: "custom" },
  { id: "Offer", role: "offer" },
  { id: "Hired", role: "terminal" },
] as const;

// The same board after the team RETIRED "Interview" (it is no longer drawn).
const RETIRED_AXIS = CUSTOM_AXIS.filter((s) => s.id !== "Interview");

test("an added live column is a conversion goal key", () => {
  assert.deepEqual(targetKeySpec("Tech round", CUSTOM_AXIS), { kind: "conversion", max: CONVERSION_TARGET_MAX });
  assert.deepEqual(validateTargetWrite({ metric: "Tech round", value: 40 }, CUSTOM_AXIS), {
    ok: true,
    metric: "Tech round",
    value: 40,
  });
});

test("a retired column and an unknown metric are refused with ONE code", () => {
  assert.equal(targetKeySpec("Interview", RETIRED_AXIS), null);
  assert.deepEqual(validateTargetWrite({ metric: "Interview", value: 40 }, RETIRED_AXIS), {
    ok: false,
    code: "ANALYTICS_TARGET_UNKNOWN_METRIC",
  });
  assert.deepEqual(validateTargetWrite({ metric: "bogus", value: 40 }, CUSTOM_AXIS), {
    ok: false,
    code: "ANALYTICS_TARGET_UNKNOWN_METRIC",
  });
  assert.deepEqual(validateTargetWrite({ value: 40 }, CUSTOM_AXIS), { ok: false, code: "ANALYTICS_TARGET_UNKNOWN_METRIC" });
});

test("the entry column (no inbound conversion) is not a goal key", () => {
  assert.equal(targetKeySpec("Accepted", CUSTOM_AXIS), null);
  assert.deepEqual(validateTargetWrite({ metric: "Accepted", value: 40 }, CUSTOM_AXIS), {
    ok: false,
    code: "ANALYTICS_TARGET_UNKNOWN_METRIC",
  });
});

test("ceilings come from the registry, per kind", () => {
  const out = { ok: false, code: "ANALYTICS_TARGET_OUT_OF_RANGE" };
  assert.deepEqual(validateTargetWrite({ metric: "Offer", value: 140 }, CUSTOM_AXIS), out);
  assert.deepEqual(validateTargetWrite({ metric: TIME_TO_HIRE_TARGET_KEY, value: 4000 }, CUSTOM_AXIS), out);
  assert.deepEqual(validateTargetWrite({ metric: MANUAL_HOURS_TARGET_KEY, value: 1000 }, CUSTOM_AXIS), {
    ok: true,
    metric: MANUAL_HOURS_TARGET_KEY,
    value: 1000,
  });
  assert.deepEqual(validateTargetWrite({ metric: RECRUITER_HOURLY_TARGET_KEY, value: 1_000_001 }, CUSTOM_AXIS), out);
  // A value that is not a finite, non-negative number is the same refusal: there is
  // no range it could be inside.
  assert.deepEqual(validateTargetWrite({ metric: "Offer", value: -1 }, CUSTOM_AXIS), out);
  assert.deepEqual(validateTargetWrite({ metric: "Offer", value: "abc" }, CUSTOM_AXIS), out);
  // null / "" clear the goal and are always accepted for a known key.
  assert.deepEqual(validateTargetWrite({ metric: "Offer", value: null }, CUSTOM_AXIS), { ok: true, metric: "Offer", value: null });
  assert.deepEqual(validateTargetWrite({ metric: " Offer ", value: "" }, CUSTOM_AXIS), { ok: true, metric: "Offer", value: null });
});

test("read side: a goal for a column that is no longer drawn is withheld, and returns unchanged with it", () => {
  const stored = new Map<string, number>([
    ["Interview", 55],
    ["Tech round", 40],
    ["Accepted", 90], // an entry-column row nobody could have meant as a conversion goal
    [TIME_TO_HIRE_TARGET_KEY, 30],
    [RECRUITER_HOURLY_TARGET_KEY, 800],
    [MANUAL_HOURS_TARGET_KEY, 20],
  ]);
  assert.deepEqual(liveConversionTargets(stored, RETIRED_AXIS), { "Tech round": 40 });
  assert.deepEqual(liveConversionTargets(stored, CUSTOM_AXIS), { Interview: 55, "Tech round": 40 });
});

test("one vocabulary: the reserved set IS the spec table's keys, and the client re-exports them", () => {
  assert.deepEqual([...RESERVED_TARGET_KEYS].sort(), Object.keys(RESERVED_TARGET_SPECS).sort());
  assert.deepEqual([...RESERVED_TARGET_KEYS].sort(), [MANUAL_HOURS_TARGET_KEY, RECRUITER_HOURLY_TARGET_KEY, TIME_TO_HIRE_TARGET_KEY].sort());
  assert.equal(TIME_TO_HIRE_KEY, TIME_TO_HIRE_TARGET_KEY);
  assert.equal(RECRUITER_HOURLY_KEY, RECRUITER_HOURLY_TARGET_KEY);
  assert.equal(MANUAL_HOURS_KEY, MANUAL_HOURS_TARGET_KEY);
  const types = readFileSync(path.join(process.cwd(), "app", "features", "insights", "analytics", "AnalyticsTypes.ts"), "utf8");
  assert.doesNotMatch(
    types,
    /export const (TIME_TO_HIRE_KEY|RECRUITER_HOURLY_KEY|MANUAL_HOURS_KEY)\s*=\s*"/,
    "AnalyticsTypes.ts must re-export the reserved keys from the registry, not hand-mirror them"
  );
});
