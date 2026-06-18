// Locks the single-tenant fail-safe: until per-workspace data isolation ships,
// creating or switching to a non-default workspace must be refused (that switch is
// what makes the cross-tenant leaks #1–#4 live). KP_MULTI_WORKSPACE opts back in.
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { multiWorkspaceEnabled, canSwitchWorkspace } from "./workspace-lock.ts";

const DEFAULT = "workspace";

test("multi-workspace is OFF by default and for junk values", () => {
  assert.equal(multiWorkspaceEnabled({}), false);
  assert.equal(multiWorkspaceEnabled({ KP_MULTI_WORKSPACE: "" }), false);
  assert.equal(multiWorkspaceEnabled({ KP_MULTI_WORKSPACE: "no" }), false);
  assert.equal(multiWorkspaceEnabled({ KP_MULTI_WORKSPACE: "0" }), false);
});

test("multi-workspace turns ON for explicit truthy opt-in", () => {
  for (const v of ["1", "true", "TRUE", "yes", "on"]) {
    assert.equal(multiWorkspaceEnabled({ KP_MULTI_WORKSPACE: v }), true, v);
  }
});

test("locked: only the default workspace is a valid switch target", () => {
  assert.equal(canSwitchWorkspace(DEFAULT, DEFAULT, {}), true); // no-op re-mint, safe
  assert.equal(canSwitchWorkspace("ws_other", DEFAULT, {}), false); // the leak vector — refused
});

test("unlocked: any workspace can be switched to", () => {
  const env = { KP_MULTI_WORKSPACE: "1" };
  assert.equal(canSwitchWorkspace("ws_other", DEFAULT, env), true);
  assert.equal(canSwitchWorkspace(DEFAULT, DEFAULT, env), true);
});
