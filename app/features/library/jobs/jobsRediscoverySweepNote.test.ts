// The sweep note tells the truth about a partly-failed sweep.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { sweepNote } from "./jobsRediscoverySweepNote.ts";

test("a clean sweep is one green line", () => {
  assert.deepEqual(sweepNote({ jobsSwept: 3, newAlerts: 2, failedJobs: 0 }), {
    keys: ["swept"],
    jobs: 3,
    found: 2,
    failed: 0,
    tone: "ok",
  });
});

test("a clean sweep that found NOBODY is still green — that is a real answer", () => {
  const n = sweepNote({ jobsSwept: 3, newAlerts: 0 });
  assert.deepEqual(n.keys, ["swept"]);
  assert.equal(n.tone, "ok");
});

test("THE FIX: a sweep whose rankings failed is NOT the same line as one that found nobody", () => {
  const broken = sweepNote({ jobsSwept: 3, newAlerts: 0, failedJobs: 3 });
  const empty = sweepNote({ jobsSwept: 3, newAlerts: 0, failedJobs: 0 });
  assert.notDeepEqual(broken, empty, "the two must never render identically");
  assert.deepEqual(broken.keys, ["swept", "sweptIncomplete"], "what landed AND what didn't");
  assert.equal(broken.failed, 3);
  assert.equal(broken.tone, "error", "an incomplete list is never painted as success");
});

test("a PARTIAL failure still reports the alerts that did land", () => {
  const n = sweepNote({ jobsSwept: 5, newAlerts: 2, failedJobs: 1 });
  assert.deepEqual(n.keys, ["swept", "sweptIncomplete"]);
  assert.equal(n.found, 2, "the two real alerts are still claimed");
  assert.equal(n.failed, 1);
  assert.equal(n.tone, "error");
});

test("no published roles stays its own neutral line, never a failure", () => {
  assert.deepEqual(sweepNote({ jobsSwept: 0, newAlerts: 0, failedJobs: 0 }), {
    keys: ["noPublished"],
    jobs: 0,
    found: 0,
    failed: 0,
    tone: "ok",
  });
});

test("a nonsensical failure count is clamped, never rendered as '4 of 3 failed'", () => {
  assert.equal(sweepNote({ jobsSwept: 3, newAlerts: 0, failedJobs: 9 }).failed, 3);
  assert.equal(sweepNote({ jobsSwept: 3, newAlerts: 0, failedJobs: -2 }).failed, 0);
});

test("missing fields (an older server, or a body that lost them) read as a clean zero sweep", () => {
  assert.deepEqual(sweepNote({}).keys, ["noPublished"]);
});
