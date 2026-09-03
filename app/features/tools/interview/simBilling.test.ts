// The panel and the gate must quote ONE number (wave 18b).
//
// `InterviewStartPanel` now tells the recruiter "bills up to N interview
// minutes" before they mint a real, billable voice session. N is only worth
// showing if it is the same N the route reserves and /complete debits — a
// reassuring wrong number is worse than none. The client cannot import
// `maxBillableInterviewMin` (its module reaches better-sqlite3), so this test is
// the seam: it imports both sides and compares them mode by mode.
//
// Runner: node --test with type stripping (npm run test:unit).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { maxBillableInterviewMin } from "../../../_lib/billing/enforce.ts";
import { QUICK_SCREEN_MIN } from "../../../_lib/interview-duration.mjs";
import { DEMO_CASE_SCENARIO, STUDENT_SCRIPT_MIN } from "../../../_lib/student-interview.ts";
import { simBillableCeilingMin, simDurationMin } from "./simBilling.ts";

const MODES = ["regular", "student", "student-case"] as const;

test("the ceiling the panel shows IS maxBillableInterviewMin, mode by mode", () => {
  for (const mode of MODES) {
    assert.equal(
      simBillableCeilingMin(mode),
      maxBillableInterviewMin(simDurationMin(mode)),
      `${mode}: the panel would quote a different allowance than the gate reserves`
    );
  }
});

test("each mode's booked length matches the one /api/interview/simulate mints", () => {
  assert.equal(simDurationMin("regular"), QUICK_SCREEN_MIN);
  assert.equal(simDurationMin("student"), STUDENT_SCRIPT_MIN);
  assert.equal(simDurationMin("student-case"), DEMO_CASE_SCENARIO.durationMin);

  // The route is the authority on which duration goes with which mode; read it so
  // a later re-assignment there cannot leave this table quietly stale.
  const route = readFileSync(fileURLToPath(new URL("../../../api/interview/simulate/route.ts", import.meta.url)), "utf8");
  assert.match(route, /durationMin = QUICK_SCREEN_MIN/);
  assert.match(route, /durationMin = STUDENT_SCRIPT_MIN/);
  assert.match(route, /durationMin = DEMO_CASE_SCENARIO\.durationMin/);
  assert.match(route, /maxBillableInterviewMin\(durationMin\)/, "the gate must still reserve the ceiling this panel quotes");
});
