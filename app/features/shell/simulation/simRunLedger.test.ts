import { test } from "node:test";
import assert from "node:assert/strict";
import { createLedger, mintRunId, summarizeLedger } from "./simRunLedger.ts";

test("a run id is prefixed, sortable by start time, and differs by salt", () => {
  const a = mintRunId(() => 1_000_000, () => 0.1);
  const b = mintRunId(() => 2_000_000, () => 0.1);
  const c = mintRunId(() => 1_000_000, () => 0.9);
  assert.match(a, /^sim-[0-9a-z]+-[0-9a-z]{4}$/);
  assert.ok(a < b, "a later start sorts later");
  assert.notEqual(a, c);
});

test("each chapter becomes one record carrying the run id, phase, times, outcome and actor", () => {
  let n = 0;
  const l = createLedger("sim-x", () => new Date(Date.UTC(2026, 0, 1, 0, 0, n++)));
  l.begin("design");
  l.end("passed");
  const [s] = l.steps();
  assert.deepEqual(Object.keys(s), ["runId", "phase", "startedAt", "endedAt", "outcome", "actor"]);
  assert.equal(s.runId, "sim-x");
  assert.equal(s.actor, "auto");
  assert.equal(s.startedAt, "2026-01-01T00:00:00.000Z");
  assert.equal(s.endedAt, "2026-01-01T00:00:01.000Z");
});

test("the strongest actor noted during a chapter wins", () => {
  const l = createLedger("r");
  l.begin("screen");
  l.note("approval");
  l.note("auto");
  l.end("passed");
  l.begin("interview");
  l.note("approval");
  l.note("manual-fallback");
  l.note("approval");
  l.end("passed");
  assert.deepEqual(l.steps().map((s) => s.actor), ["approval", "manual-fallback"]);
});

test("a chapter left open when the next begins is closed as failed; end and note with nothing open are no-ops", () => {
  const l = createLedger("r");
  l.note("manual-fallback");
  l.end("passed");
  assert.equal(l.steps().length, 0);
  l.begin("a");
  l.begin("b");
  l.end("stopped");
  assert.deepEqual(l.steps().map((s) => [s.phase, s.outcome]), [["a", "failed"], ["b", "stopped"]]);
});

test("zero manual edits is a count: passed everywhere and no fallback chapter", () => {
  const mk = (actor: "auto" | "approval" | "manual-fallback", outcome: "passed" | "failed" = "passed") => {
    const l = createLedger("r");
    l.begin("p");
    l.note(actor);
    l.end(outcome);
    return l.steps();
  };
  assert.equal(summarizeLedger(mk("approval")).zeroManualEdits, true);
  assert.equal(summarizeLedger(mk("manual-fallback")).zeroManualEdits, false);
  assert.equal(summarizeLedger(mk("auto", "failed")).zeroManualEdits, false);
  assert.equal(summarizeLedger([]).zeroManualEdits, false, "an empty ledger proves nothing");
  assert.equal(summarizeLedger(mk("manual-fallback")).manualFallbacks, 1);
});
