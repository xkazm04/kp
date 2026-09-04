import test from "node:test";
import assert from "node:assert/strict";
import { doneCount, nextStep, stepDone, stepNote, STEPS } from "./setupGettingStartedModel";
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
  allDone: false,
};

test("nothing done → every step open, progress 0, next = the first one", () => {
  assert.equal(doneCount(NOTHING), 0);
  assert.equal(nextStep(NOTHING)?.key, "company");
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
  const d: GettingStarted = { ...NOTHING, company: true, firstRole: "ready" };
  assert.equal(nextStep(d)?.key, "case");
  assert.equal(doneCount(d), 2);
});

test("all four core steps done → nothing left to do", () => {
  const all: GettingStarted = { company: true, firstRole: "ready", caseDesigned: true, channels: "verified", team: false, allDone: true };
  assert.equal(doneCount(all), STEPS.length);
  assert.equal(nextStep(all), null);
});

test("inviting teammates is NOT one of the four core steps", () => {
  // `team` still rides in the payload for surfaces that care, but it never gated
  // anything here, so it must not compete for attention or move the count.
  assert.deepEqual(STEPS.map((s) => s.key), ["company", "firstRole", "case", "channels"]);
  assert.equal(doneCount({ ...NOTHING, team: true }), 0);
});

test("every step points at a real workspace tab", () => {
  for (const s of STEPS) assert.match(s.tab, /^[a-z-]+$/, s.key);
});
