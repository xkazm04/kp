import test from "node:test";
import assert from "node:assert/strict";
import { allStepsDone, doneCount, nextStep, stepDone, stepNote, STEPS } from "./setupGettingStartedModel";
import type { GettingStarted } from "@/app/_lib/getting-started";

// The honesty contract of the Getting-started surface is that every mark reflects
// a real workspace fact — no variant may invent a step or a completion flag. All
// of that derivation lives in this model, and none of it was pinned.

const NOTHING: GettingStarted = {
  company: false,
  firstRole: "none",
  caseDesigned: false,
  channels: "none",
  team: false,
  setupFinished: false,
  allDone: false,
};

/** The four core steps, so the `finishSetup` assertions can vary one thing. */
const CORE_DONE: GettingStarted = {
  ...NOTHING,
  company: true,
  firstRole: "ready",
  caseDesigned: true,
  channels: "verified",
  allDone: true,
};

test("nothing done → every step open, progress 0, next = the first one", () => {
  assert.equal(doneCount(NOTHING), 0);
  assert.equal(nextStep(NOTHING)?.key, "finishSetup");
  for (const s of STEPS) assert.equal(stepDone(s.key, NOTHING), false, s.key);
});

test("a JD that is still analyzing is NOT a done step — it is a noted one", () => {
  const d: GettingStarted = { ...NOTHING, firstRole: "analyzing" };
  assert.equal(stepDone("firstRole", d), false);
  assert.equal(stepNote("firstRole", d), "analyzing");
  assert.equal(doneCount(d), 0);
});

test("a failed JD build says so rather than silently staying blank", () => {
  assert.equal(stepNote("firstRole", { ...NOTHING, firstRole: "failed" }), "failed");
  assert.equal(stepDone("firstRole", { ...NOTHING, firstRole: "ready" }), true);
  assert.equal(stepNote("firstRole", { ...NOTHING, firstRole: "ready" }), null);
});

test("a webhook that has never received traffic is 'listening', not done", () => {
  const listening: GettingStarted = { ...NOTHING, channels: "listening" };
  assert.equal(stepDone("channels", listening), false);
  assert.equal(stepNote("channels", listening), "listening");
  assert.equal(stepDone("channels", { ...NOTHING, channels: "verified" }), true);
});

test("next() walks the steps in order and skips the ones already done", () => {
  const d: GettingStarted = { ...NOTHING, setupFinished: true, company: true, firstRole: "ready" };
  assert.equal(nextStep(d)?.key, "case");
  assert.equal(doneCount(d), 3);
});

test("every step done → nothing left to do", () => {
  const all: GettingStarted = { ...CORE_DONE, setupFinished: true };
  assert.equal(doneCount(all), STEPS.length);
  assert.equal(nextStep(all), null);
  assert.equal(allStepsDone(all), true);
});

test("inviting teammates is NOT one of the steps", () => {
  // `team` still rides in the payload for surfaces that care, but it never gated
  // anything here, so it must not compete for attention or move the count.
  assert.deepEqual(STEPS.map((s) => s.key), ["finishSetup", "company", "firstRole", "case", "channels"]);
  assert.equal(doneCount({ ...NOTHING, team: true }), 0);
});

test("every step opens somewhere real — a tab, or the wizard", () => {
  // Exactly one step is the wizard re-entry; every other one names a workspace tab.
  const wizard = STEPS.filter((s) => s.opens === "wizard");
  assert.deepEqual(wizard.map((s) => s.key), ["finishSetup"]);
  for (const s of STEPS) {
    if (s.opens === "wizard") continue;
    assert.match(s.tab, /^[a-z-]+$/, s.key);
  }
});

// --- finishSetup: the recovery step ------------------------------------------
// Its whole reason to exist is that a SKIPPED first run is unrecoverable without
// it — the '/' gate never re-fires and the Settings walkthrough persists nothing.
// So the one thing that must never regress is that a skip does not read as done.

test("finishSetup follows the server's stamp, and a skip is not a finish", () => {
  // The server sends `setupFinished` only for a "completed" stamp; a skipped (or
  // never-stamped) principal arrives as false and the step stays open.
  assert.equal(stepDone("finishSetup", NOTHING), false);
  assert.equal(stepDone("finishSetup", { ...NOTHING, setupFinished: true }), true);
  // No sub-state: the wizard is either finished or it is not.
  assert.equal(stepNote("finishSetup", NOTHING), null);
});

test("a skipped first run promotes 'finish setting up' as the next move", () => {
  assert.equal(nextStep(NOTHING)?.key, "finishSetup");
  assert.equal(nextStep(NOTHING)?.opens, "wizard");
});

test("finishSetup moves the count and gates the card's retirement", () => {
  // The four core steps done by hand after a skip: `allDone` on the wire says the
  // workspace can hire, but the checklist must NOT retire — it is the only way
  // back into the wizard.
  assert.equal(CORE_DONE.allDone, true);
  assert.equal(doneCount(CORE_DONE), STEPS.length - 1);
  assert.equal(allStepsDone(CORE_DONE), false);
  assert.equal(nextStep(CORE_DONE)?.key, "finishSetup");
  // Finishing the wizard closes the last one.
  assert.equal(allStepsDone({ ...CORE_DONE, setupFinished: true }), true);
});
