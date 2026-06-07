// Locks the `pipeline_entries.status` lifecycle contract (idea-275e251e). The
// point of the taxonomy is that `rejected` (company passed) and `declined`
// (candidate turned us down) are DISTINCT terminal states — these tests fix the
// exact membership so the two can't quietly be collapsed back into one, and pin
// the terminal-state helper that readers use instead of string-comparing literals.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PIPELINE_ENTRY_STATUSES,
  TERMINAL_ENTRY_STATUSES,
  isPipelineEntryStatus,
  isTerminalEntryStatus,
} from "./pipeline-status.ts";

test("the canonical status list is exactly the three documented states", () => {
  assert.deepEqual([...PIPELINE_ENTRY_STATUSES].sort(), ["active", "declined", "rejected"]);
});

test("declined is a first-class status, distinct from rejected", () => {
  // The whole contract: a candidate-side decline is NOT a company-side reject.
  assert.equal(PIPELINE_ENTRY_STATUSES.includes("declined"), true);
  assert.equal(PIPELINE_ENTRY_STATUSES.includes("rejected"), true);
  assert.notEqual("declined", "rejected");
});

test("both terminal states are terminal — and active is not", () => {
  assert.deepEqual([...TERMINAL_ENTRY_STATUSES].sort(), ["declined", "rejected"]);
  assert.equal(isTerminalEntryStatus("rejected"), true);
  assert.equal(isTerminalEntryStatus("declined"), true);
  assert.equal(isTerminalEntryStatus("active"), false);
});

test("isTerminalEntryStatus is null-safe and rejects unknown values", () => {
  assert.equal(isTerminalEntryStatus(null), false);
  assert.equal(isTerminalEntryStatus(undefined), false);
  assert.equal(isTerminalEntryStatus("hired"), false);
  assert.equal(isTerminalEntryStatus(""), false);
});

test("isPipelineEntryStatus guards membership (null/typo are not statuses)", () => {
  assert.equal(isPipelineEntryStatus("active"), true);
  assert.equal(isPipelineEntryStatus("rejected"), true);
  assert.equal(isPipelineEntryStatus("declined"), true);
  assert.equal(isPipelineEntryStatus("withdrawn"), false);
  assert.equal(isPipelineEntryStatus(null), false);
  assert.equal(isPipelineEntryStatus(undefined), false);
});

test("every terminal status is also a member of the full status set", () => {
  for (const s of TERMINAL_ENTRY_STATUSES) {
    assert.equal(isPipelineEntryStatus(s), true, `${s} must be a documented status`);
  }
});
