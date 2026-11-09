import { test } from "node:test";
import assert from "node:assert/strict";
import { fixtureSeedEnabled, seedChoiceFixedByEnv } from "./seed-gate.ts";

// Operator triage T1 (2026-10-22): the demo corpus no longer seeds at boot by default.

test("fixture seeds are OFF by default (no env at all)", () => {
  assert.equal(fixtureSeedEnabled({}), false);
  assert.equal(fixtureSeedEnabled({ KP_EMPTY: "" }), false);
  assert.equal(fixtureSeedEnabled({ KP_SEED_DEMO: "" }), false);
});

test("KP_SEED_DEMO truthy forms opt in to boot seeding", () => {
  for (const v of ["1", "true", "yes", "on", " TRUE ", "On"]) {
    assert.equal(fixtureSeedEnabled({ KP_SEED_DEMO: v }), true, `KP_SEED_DEMO=${JSON.stringify(v)}`);
  }
});

test("KP_SEED_DEMO falsy/garbage forms stay off (an opt-in must be explicit)", () => {
  for (const v of ["0", "false", "off", "no", "demo", "banana"]) {
    assert.equal(fixtureSeedEnabled({ KP_SEED_DEMO: v }), false, `KP_SEED_DEMO=${JSON.stringify(v)}`);
  }
});

test("KP_EMPTY still wins over the opt-in", () => {
  for (const v of ["1", "true", "yes", "on"]) {
    assert.equal(fixtureSeedEnabled({ KP_EMPTY: v, KP_SEED_DEMO: "1" }), false, `KP_EMPTY=${JSON.stringify(v)}`);
  }
});

test("the in-app first-run choice is suppressed only when the env has answered it", () => {
  assert.equal(seedChoiceFixedByEnv({}), false);
  assert.equal(seedChoiceFixedByEnv({ KP_EMPTY: "0", KP_SEED_DEMO: "no" }), false);
  assert.equal(seedChoiceFixedByEnv({ KP_EMPTY: "1" }), true);
  assert.equal(seedChoiceFixedByEnv({ KP_SEED_DEMO: "1" }), true);
});
