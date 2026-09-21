// The Roles desk's status rules (jobsRoleStatus.ts), driven directly.
//
// These are the two facts a recruiter reads off the eighth column, and both have a
// way of going wrong silently: a target that folds to 0 makes every role "filled"
// the moment it opens, and a `filled` that is READ from the status column instead
// of derived makes a role that has just hired its last candidate still say "open"
// until a background hook catches up.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hiredCountOf,
  ROLE_STATUS_FILTER_ORDER,
  roleStatusOf,
  roleStatusRank,
  targetHiresOf,
} from "./jobsRoleStatus.ts";
import { ROLE_STATUSES } from "../../../_lib/status-tone.ts";

test("a target is always at least 1, so the progress fraction has a reachable denominator", () => {
  // Absent = the stored NULL = "never stated" = the default of one hire.
  assert.equal(targetHiresOf({}), 1);
  assert.equal(targetHiresOf({ targetHires: undefined }), 1);
  assert.equal(targetHiresOf({ targetHires: 3 }), 3);
  // Values the publish route refuses but a hand-edited DB could still hold. A 0
  // denominator would make every role filled on the day it opened.
  assert.equal(targetHiresOf({ targetHires: 0 }), 1);
  assert.equal(targetHiresOf({ targetHires: -2 }), 1);
  assert.equal(targetHiresOf({ targetHires: Number.NaN }), 1);
  assert.equal(targetHiresOf({ targetHires: 2.7 }), 2);
});

test("an undecorated hired count is 0, never presented as progress", () => {
  assert.equal(hiredCountOf({}), 0);
  assert.equal(hiredCountOf({ hired: Number.NaN }), 0);
  assert.equal(hiredCountOf({ hired: -1 }), 0);
  assert.equal(hiredCountOf({ hired: 4 }), 4);
});

test("a draft is a draft whatever its hired count says", () => {
  assert.equal(roleStatusOf({ status: "draft" }), "draft");
  // A stray pipeline entry must not badge a role the recruiter never took to market.
  assert.equal(roleStatusOf({ status: "draft", hired: 5, targetHires: 1 }), "draft");
});

test("a live role is open until it reaches its target, then filled", () => {
  assert.equal(roleStatusOf({ status: "published", hired: 0, targetHires: 3 }), "open");
  assert.equal(roleStatusOf({ status: "published", hired: 2, targetHires: 3 }), "open");
  assert.equal(roleStatusOf({ status: "published", hired: 3, targetHires: 3 }), "filled");
  // …and OVER the target is still filled, not something else.
  assert.equal(roleStatusOf({ status: "published", hired: 4, targetHires: 3 }), "filled");
});

test("a NULL status is the seeded corpus row, which is live by contract", () => {
  assert.equal(roleStatusOf({ status: null }), "open");
  assert.equal(roleStatusOf({}), "open");
  assert.equal(roleStatusOf({ status: null, hired: 1 }), "filled");
});

test("FILLED IS DERIVED: the window between the hire and the auto-close reads the same either way", () => {
  // The post-commit hook runs after the response, so for a moment the role is still
  // 'published' at 3-of-3. Both sides of that window must read "filled" — the whole
  // reason the status is derived rather than stored.
  const beforeHookRuns = { status: "published" as const, hired: 3, targetHires: 3 };
  const afterHookRuns = { status: "closed" as const, hired: 3, targetHires: 3 };
  assert.equal(roleStatusOf(beforeHookRuns), "filled");
  assert.equal(roleStatusOf(afterHookRuns), "filled");
});

test("a role closed SHORT of its target is closed, not filled", () => {
  // A manual close on an abandoned req: the desk must not congratulate it.
  assert.equal(roleStatusOf({ status: "closed", hired: 1, targetHires: 3 }), "closed");
  assert.equal(roleStatusOf({ status: "closed", hired: 0, targetHires: 1 }), "closed");
});

test("the sort order is the desk's reading order, not the alphabet", () => {
  const ranks = [
    roleStatusRank({ status: "published", hired: 0, targetHires: 2 }),
    roleStatusRank({ status: "draft" }),
    roleStatusRank({ status: "published", hired: 2, targetHires: 2 }),
    roleStatusRank({ status: "closed", hired: 0, targetHires: 2 }),
  ];
  assert.deepEqual(ranks, [0, 1, 2, 3], "open → draft → filled → closed");
  // Never null: every role has a status, so this column has no bottom bucket.
  assert.equal(typeof roleStatusRank({}), "number");
});

test("the filter menu offers every declared role status, exactly once", () => {
  assert.deepEqual([...ROLE_STATUS_FILTER_ORDER].sort(), [...ROLE_STATUSES].sort());
  assert.equal(new Set(ROLE_STATUS_FILTER_ORDER).size, ROLE_STATUS_FILTER_ORDER.length);
});
