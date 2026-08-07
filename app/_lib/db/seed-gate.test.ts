import { test } from "node:test";
import assert from "node:assert/strict";
import { fixtureSeedEnabled } from "./seed-gate.ts";

test("fixture seeds run by default (KP_EMPTY unset)", () => {
  assert.equal(fixtureSeedEnabled({}), true);
  assert.equal(fixtureSeedEnabled({ KP_EMPTY: "" }), true);
});

test("KP_EMPTY truthy forms disable fixture seeding", () => {
  for (const v of ["1", "true", "yes", "on", " TRUE ", "On"]) {
    assert.equal(fixtureSeedEnabled({ KP_EMPTY: v }), false, `KP_EMPTY=${JSON.stringify(v)}`);
  }
});

test("KP_EMPTY falsy/garbage forms keep seeding on (fail-safe)", () => {
  for (const v of ["0", "false", "off", "no", "empty", "banana"]) {
    assert.equal(fixtureSeedEnabled({ KP_EMPTY: v }), true, `KP_EMPTY=${JSON.stringify(v)}`);
  }
});
