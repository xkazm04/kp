// Locks the four-state code-review status contract introduced to disambiguate an
// empty review (no owned public repos) from a real, evidenced-skills review. The
// route once returned "ok" for BOTH, forcing every reader to also inspect the
// summary string; "empty" makes the no-repos outcome self-describing. These tests
// pin the exact enum membership so a future widening/renaming is a deliberate,
// reviewed change rather than a silent regression back to the overloaded "ok".
//
// We import CODE_REVIEW_STATUSES (the single source of truth schemas.ts derives
// its zod enum from) and build the same z.enum here — schemas.ts itself can't be
// loaded by the runner because it transitively imports generated modules with
// extensionless paths the Node ESM resolver rejects.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { CODE_REVIEW_STATUSES } from "./code-review-status.ts";

const statusEnum = z.enum(CODE_REVIEW_STATUSES);

test("the canonical status list is exactly the four documented states", () => {
  assert.deepEqual([...CODE_REVIEW_STATUSES].sort(), ["disabled", "empty", "error", "ok"]);
});

test("the enum accepts every canonical status", () => {
  for (const status of CODE_REVIEW_STATUSES) {
    assert.equal(statusEnum.safeParse(status).success, true, `status "${status}" should be valid`);
  }
});

test("the enum rejects an unknown status (it is not silently widened)", () => {
  // "skipped" is a plausible synonym for the empty case — guard that the enum
  // does not admit ad-hoc values.
  assert.equal(statusEnum.safeParse("skipped").success, false);
});

test("empty is present and distinct from ok", () => {
  // The requirement: the no-repos outcome must NOT reuse "ok", so a consumer
  // reading status === "ok" as evidenced-skills data stays correct.
  assert.equal(CODE_REVIEW_STATUSES.includes("empty"), true);
  assert.notEqual("empty", "ok");
});
