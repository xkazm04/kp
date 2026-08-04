// Locks the single-tenant fail-safe: until per-workspace data isolation ships,
// creating or switching to a non-default workspace must be refused (that switch is
// what makes the cross-tenant leaks #1–#4 live). KP_MULTI_WORKSPACE opts back in.
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { multiWorkspaceEnabled, canSwitchWorkspace, demoSessionAllowed, signupEnabled } from "./workspace-lock.ts";

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

// The public demo mints an anonymous recruiter session that can read the real
// tenant's PII via the still-unscoped tables — so on a gated deploy it is OPT-IN.
test("demo session is OFF by default and for junk values", () => {
  assert.equal(demoSessionAllowed({}), false);
  assert.equal(demoSessionAllowed({ KP_DEMO_ENABLED: "" }), false);
  assert.equal(demoSessionAllowed({ KP_DEMO_ENABLED: "no" }), false);
  assert.equal(demoSessionAllowed({ KP_DEMO_ENABLED: "0" }), false);
});

test("demo session turns ON for explicit opt-in or when scoping is enabled", () => {
  for (const v of ["1", "true", "TRUE", "yes", "on"]) {
    assert.equal(demoSessionAllowed({ KP_DEMO_ENABLED: v }), true, v);
  }
  // Multi-workspace scoping makes the demo workspace genuinely isolated → allowed.
  assert.equal(demoSessionAllowed({ KP_MULTI_WORKSPACE: "1" }), true);
});

// Public signup provisions a whole new tenant — while any per-tenant table is
// still unscoped it must ship DARK by default (/signup + the register API 404).
test("signup is OFF by default and for junk values", () => {
  assert.equal(signupEnabled({}), false);
  assert.equal(signupEnabled({ KP_SIGNUP_ENABLED: "" }), false);
  assert.equal(signupEnabled({ KP_SIGNUP_ENABLED: "no" }), false);
  assert.equal(signupEnabled({ KP_SIGNUP_ENABLED: "0" }), false);
});

test("signup turns ON only for explicit truthy opt-in", () => {
  for (const v of ["1", "true", "TRUE", "yes", "on"]) {
    assert.equal(signupEnabled({ KP_SIGNUP_ENABLED: v }), true, v);
  }
  // Deliberately NOT implied by multi-workspace: turning tenancy on doesn't
  // open public registration by itself.
  assert.equal(signupEnabled({ KP_MULTI_WORKSPACE: "1" }), false);
});
