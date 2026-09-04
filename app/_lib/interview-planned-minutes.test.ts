// `debriefDurationMin` is the arithmetic behind a PROMISE, and nothing tested it.
//
// It is the single source for two things that must agree: the length the candidate
// brief announces ("we'll spend about N minutes on your submission") and the length
// the scheduling surfaces mint the calendar link for (plannedInterviewMinutes). When
// those two disagree the candidate is booked for one duration and steered through
// another — the exact failure interview-duration.mjs's header records as the reason
// that module exists. So the shape is pinned here, not just the current constants:
// monotonic in the number of minted questions (more to discuss is never shorter),
// never below the open walkthrough's own floor, and CAPPED, because a submission
// with a dozen authorship questions must still be a screen and not a workday.
//
// testing/unit-db.ts MUST be the first project import — interview-planned-minutes.ts
// transitively imports the db layer, and this sets KP_DB_PATH before db-path.ts is
// evaluated. The functions under test are pure; the DB is only along for the import.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";

import { debriefDurationMin } from "./interview-planned-minutes.ts";
import { QUICK_SCREEN_MIN, GROUNDED_MAX_MIN } from "./interview-duration.mjs";

after(() => cleanupUnitDb());

/** The documented shape: 8 minutes of open walkthrough + ~3 per minted question,
 *  capped at 25. Written out rather than re-derived from the formula, so a change
 *  to the formula has to be a deliberate change to these numbers too. */
const EXPECTED: Array<[followups: number, minutes: number]> = [
  [0, 8],
  [1, 11],
  [2, 14],
  [3, 17],
  [5, 23],
  [6, 25],
  [12, 25],
];

test("the debrief length is the documented 8 + 3 per question, capped at 25", () => {
  for (const [followups, minutes] of EXPECTED) {
    assert.equal(debriefDurationMin(followups), minutes, `${followups} follow-ups should book ${minutes} min`);
  }
});

test("it never shortens as questions are added (monotonic)", () => {
  // A candidate whose submission earned MORE authorship questions must never be
  // booked for LESS time than one who earned fewer — the promise would be broken
  // for precisely the candidates under the most scrutiny.
  let prev = -Infinity;
  for (let n = 0; n <= 20; n++) {
    const min = debriefDurationMin(n);
    assert.ok(min >= prev, `${n} follow-ups (${min} min) must not be shorter than ${n - 1} (${prev} min)`);
    prev = min;
  }
});

test("the walkthrough floor holds even with nothing minted", () => {
  // A promoted submission with zero follow-ups is still a real conversation about
  // the work, so the floor must clear the ungrounded quick screen — booking the
  // 5-minute slot for it is how a debrief gets cut off mid-walkthrough.
  assert.ok(
    debriefDurationMin(0) > QUICK_SCREEN_MIN,
    `the floor ${debriefDurationMin(0)} must exceed the quick screen ${QUICK_SCREEN_MIN}`,
  );
});

test("the cap keeps a debrief inside the grounded band the provider is sized for", () => {
  // One provider agent serves every mode and its hard cap is sized off
  // GROUNDED_MAX_MIN (interview-duration.mjs). An uncapped debrief could be minted
  // past that and be severed mid-answer, feeding the scorecard a stub.
  for (const n of [8, 20, 100, 10_000]) {
    assert.ok(
      debriefDurationMin(n) <= GROUNDED_MAX_MIN,
      `${n} follow-ups booked ${debriefDurationMin(n)} min, past the grounded max ${GROUNDED_MAX_MIN}`,
    );
  }
});
