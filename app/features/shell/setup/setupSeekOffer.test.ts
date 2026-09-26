// The first-run wizard's seeker arm follows the install's job-seeker switch
// (setupSeekOffer.ts). Off: no fork, the run starts answered `hire`, and a stored
// `seek` draft folds onto hiring — so nothing can finish on /me. On: exactly today.
import { test } from "node:test";
import assert from "node:assert/strict";
import { initialIntent, offeredIntent, offeredIntents } from "./setupSeekOffer.ts";
import { INITIAL_SETUP, relevantSteps, SETUP_INTENTS, stepSatisfied } from "./setupSteps.ts";

test("ON: the fork offers both arms and the run starts unanswered, as it always has", () => {
  assert.deepEqual(offeredIntents(true), SETUP_INTENTS);
  assert.equal(initialIntent(true), INITIAL_SETUP.intent);
  for (const intent of [null, "hire", "seek"] as const) assert.equal(offeredIntent(intent, true), intent);
});

test("OFF: hiring is the only arm, already answered, and a stored seek draft becomes hiring", () => {
  assert.deepEqual(offeredIntents(false), ["hire"]);
  assert.equal(initialIntent(false), "hire");
  for (const intent of [null, "hire", "seek"] as const) assert.equal(offeredIntent(intent, false), "hire");
});

test("OFF: the run is the full hiring run and Welcome needs no answer", () => {
  const state = { ...INITIAL_SETUP, intent: initialIntent(false) };
  assert.equal(stepSatisfied("welcome", state), true, "Continue is live without a fork to press");
  assert.deepEqual(
    relevantSteps(state).map((s) => s.id),
    relevantSteps({ ...INITIAL_SETUP, intent: "hire" }).map((s) => s.id),
  );
});
