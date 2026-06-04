// Pins the reconciled interview-length contract (idea-0ecbe5a5). Four numbers
// used to drift — the portal copy, the persona wording, the provider cap and the
// grounded run-of-show — so these tests lock the single source of truth in
// interview-duration.mjs and, crucially, that the provider cap can never fall
// back below a real interview's length and silently truncate the transcript.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  QUICK_SCREEN_MIN,
  GROUNDED_DEFAULT_MIN,
  GROUNDED_MAX_MIN,
  PROVIDER_CAP_MIN,
  PROVIDER_MAX_DURATION_SECONDS,
  durationLabel,
  durationChip,
} from "./interview-duration.mjs";
import { MIN_DURATION_MIN, MAX_DURATION_MIN } from "./run-of-show.ts";

test("the two mode targets are ordered: quick screen is shorter than the grounded screen", () => {
  assert.ok(QUICK_SCREEN_MIN > 0, "quick screen has a positive length");
  assert.ok(
    QUICK_SCREEN_MIN < GROUNDED_DEFAULT_MIN,
    `quick ${QUICK_SCREEN_MIN} should be shorter than grounded default ${GROUNDED_DEFAULT_MIN}`
  );
});

test("the grounded default sits inside the run-of-show band", () => {
  assert.ok(
    GROUNDED_DEFAULT_MIN >= MIN_DURATION_MIN && GROUNDED_DEFAULT_MIN <= MAX_DURATION_MIN,
    `grounded default ${GROUNDED_DEFAULT_MIN} must be within [${MIN_DURATION_MIN}, ${MAX_DURATION_MIN}]`
  );
});

test("GROUNDED_MAX_MIN mirrors the run-of-show maximum (the mirror can't drift)", () => {
  assert.equal(
    GROUNDED_MAX_MIN,
    MAX_DURATION_MIN,
    "interview-duration.mjs and run-of-show.ts must agree on the grounded maximum"
  );
});

test("the provider cap clears the grounded maximum so a real interview is never truncated", () => {
  // This is the trust-critical invariant: one ElevenLabs agent serves both modes,
  // so its hard cap must exceed the longest grounded run-of-show — otherwise a
  // 20–30 min screen is severed mid-answer and feeds the scorecard a stub.
  assert.ok(
    PROVIDER_CAP_MIN > MAX_DURATION_MIN,
    `provider cap ${PROVIDER_CAP_MIN} min must exceed the grounded max ${MAX_DURATION_MIN} min`
  );
  assert.equal(PROVIDER_MAX_DURATION_SECONDS, PROVIDER_CAP_MIN * 60, "seconds derive from the minute cap");
});

test("the labels read naturally and pluralize", () => {
  assert.equal(durationLabel(GROUNDED_DEFAULT_MIN), `About ${GROUNDED_DEFAULT_MIN} minutes`);
  assert.equal(durationLabel(1), "About 1 minute");
  assert.equal(durationChip(QUICK_SCREEN_MIN), `~${QUICK_SCREEN_MIN} min`);
});
