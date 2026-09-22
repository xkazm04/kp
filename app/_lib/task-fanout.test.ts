// The fan-out ledger (batch_screen / batch_outreach): per-candidate outcomes read
// from a stored task row, and the scoped retry decision the retry door is a thin
// caller of.
//
// Why the retry decision is tested HERE and not through the route: the route
// imports app/_lib/tasks.ts, which pulls better-sqlite3 and the whole handler
// graph, and no unit test loads it at runtime. So the decision is a pure function
// of what the route has already read — the row `getTask(id, ws)` returned (null for
// another workspace's task: the tenancy check IS that null) and the requested scope
// — and every refusal it can make happens before the route reaches a limiter.
//
// Runner: node:test, via `npm run test:unit`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fanoutItemCode, fanoutOutcome, retryDecision, retryParamsFor, retryScopes } from "./task-fanout.ts";
import { buildDedupeKey } from "./task-dedupe.ts";

test("case 1: a canceled outreach run splits into delivered / suppressed / failed-by-code / unreached", () => {
  const out = fanoutOutcome(
    "batch_outreach",
    { entryIds: ["a", "b", "c", "d"] },
    {
      results: [
        { id: "a", ok: true, applied: "sent" },
        { id: "b", ok: false, code: "entry_has_no_profile" },
        { id: "c", ok: true, applied: "suppressed_consent_expired" },
      ],
    },
    "canceled"
  );
  assert.deepEqual(out, {
    deliveredIds: ["a"],
    suppressedIds: ["c"],
    failedIds: ["b"],
    unreachedIds: ["d"],
    byCode: { entry_has_no_profile: 1 },
  });
});

test("case 2: a legacy raw `reason` is read as engine_failed and never reaches the outcome", () => {
  const out = fanoutOutcome(
    "batch_outreach",
    { entryIds: ["x"] },
    { ok: 0, total: 1, results: [{ id: "x", ok: false, reason: "Traceback (most recent call last): /tmp/kp-123/run.py" }] },
    "succeeded"
  );
  assert.ok(out);
  assert.deepEqual(out.failedIds, ["x"]);
  assert.deepEqual(out.byCode, { engine_failed: 1 });
  const wire = JSON.stringify(out);
  assert.ok(!wire.includes("Traceback"), "a raw engine message must not survive into the outcome");
  assert.ok(!wire.includes("/tmp"), "a workdir path must not survive into the outcome");
});

test("case 3: counts alone name nobody, so a legacy batch_screen row offers no subset retry", () => {
  const legacy = { advanced: 1, held: 0, advisory: 0, errors: 2, total: 3 };
  const out = fanoutOutcome("batch_screen", {}, legacy, "succeeded");
  assert.ok(out);
  assert.deepEqual(out.failedIds, []);
  assert.deepEqual(retryScopes("batch_screen", {}, legacy, "succeeded"), []);
  // …and the same row canceled mid-run still cannot name its remainder.
  assert.deepEqual(retryScopes("batch_screen", { entryIds: ["a", "b", "c"] }, legacy, "canceled"), []);
});

test("case 4: a per-item failure is recorded as a CODE, and the item carries ids and codes only", () => {
  assert.equal(fanoutItemCode({ refusal: "entry_not_found" }), "entry_not_found");
  assert.equal(fanoutItemCode(new Error("spawn ENOENT")), "engine_failed");
  // A refusal token this build has no label for is an engine failure, not a new word.
  assert.equal(fanoutItemCode({ refusal: "Traceback: /tmp/x" }), "engine_failed");
  assert.equal(fanoutItemCode(undefined), "engine_failed");
  // The tasks table is erasure-exempt and not entry-keyed (db/pipeline.ts), so
  // whatever the outcome keeps from an item is an id or a code — a candidate label
  // riding on a stored item is dropped on read.
  const out = fanoutOutcome(
    "batch_outreach",
    { entryIds: ["a", "b"] },
    { results: [{ id: "a", ok: true, applied: "sent", candidateLabel: "Ada Lovelace" }, { id: "b", ok: false, code: "entry_not_found", email: "ada@example.com" }] },
    "succeeded"
  );
  const wire = JSON.stringify(out);
  assert.ok(!wire.includes("Ada") && !wire.includes("@"), "no label or address may ride on the outcome");
});

test("case 5: a subset retry narrows the cohort and forks its own dedupe identity", () => {
  const original = { entryIds: ["a", "b", "c", "d"] };
  const subset = retryParamsFor("batch_outreach", original, ["b"]);
  assert.deepEqual(subset, { entryIds: ["b"] });
  assert.ok(subset);
  assert.notEqual(buildDedupeKey("batch_outreach", subset), buildDedupeKey("batch_outreach", original));
  assert.equal(retryParamsFor("analyze", { baseDir: "/x" }, ["x"]), null);
  assert.equal(retryParamsFor("batch_outreach", original, []), null);
});

test("case 6: { scope: 'failed' } on a SUCCEEDED outreach replays only the failed ids; nothing failed or no scope refuses", () => {
  const task = {
    kind: "batch_outreach",
    status: "succeeded" as const,
    params: { entryIds: ["a", "b"] },
    result: { ok: 1, total: 2, results: [{ id: "a", ok: true, applied: "sent" }, { id: "b", ok: false, code: "engine_failed" }] },
  };
  assert.deepEqual(retryDecision(task, "failed"), { ok: { entryIds: ["b"] } });
  const clean = { ...task, result: { ok: 2, total: 2, results: [{ id: "a", ok: true, applied: "sent" }, { id: "b", ok: true, applied: "sent" }] } };
  assert.deepEqual(retryDecision(clean, "failed"), { refuse: "TASK_NOT_RETRYABLE" });
  // The existing full-replay contract is unchanged: no scope on a succeeded run refuses…
  assert.deepEqual(retryDecision(task, undefined), { refuse: "TASK_NOT_RETRYABLE" });
  // …and replays the persisted params verbatim on a dead one.
  assert.deepEqual(retryDecision({ ...task, status: "failed" }, undefined), { ok: { entryIds: ["a", "b"] } });
  // A scope on a kind that does not fan out, an unknown scope, or a run still in
  // flight is refused rather than guessed at.
  assert.deepEqual(retryDecision({ ...task, kind: "analyze" }, "failed"), { refuse: "TASK_NOT_RETRYABLE" });
  assert.deepEqual(retryDecision(task, "everyone"), { refuse: "TASK_NOT_RETRYABLE" });
  assert.deepEqual(retryDecision({ ...task, status: "running" }, "failed"), { refuse: "TASK_NOT_RETRYABLE" });
});

test("case 7: { scope: 'unreached' } on a CANCELED batch_screen resumes over the remainder of the cohort", () => {
  const task = {
    kind: "batch_screen",
    status: "canceled" as const,
    params: { entryIds: ["e1", "e2", "e3", "e4", "e5"] },
    result: {
      advanced: 1,
      held: 1,
      advisory: 0,
      errors: 0,
      total: 5,
      results: [{ id: "e1", ok: true, applied: "advanced" }, { id: "e2", ok: true, applied: "held_for_review" }],
    },
  };
  assert.deepEqual(retryDecision(task, "unreached"), { ok: { entryIds: ["e3", "e4", "e5"] } });
  assert.deepEqual(retryScopes(task.kind, task.params, task.result, task.status), ["unreached"]);
  // A succeeded run has no remainder: ids it did not record were filtered out as
  // ineligible (not active, not this workspace), not left unreached.
  assert.deepEqual(retryDecision({ ...task, status: "succeeded" }, "unreached"), { refuse: "TASK_NOT_RETRYABLE" });
});

test("case 8: another workspace's task is TASK_NOT_FOUND before anything else is weighed", () => {
  // The route reads the row with getTask(id, ws), which returns null for a task of
  // another tenant; the decision takes that read as its FIRST input, so a foreign id
  // answers 404 whatever the scope — and the route consults no rate-limit bucket
  // before the decision (pinned in app/api/rate-limit-contract.test.ts).
  for (const scope of ["failed", "unreached", undefined, "nonsense"]) {
    assert.deepEqual(retryDecision(null, scope), { refuse: "TASK_NOT_FOUND" });
  }
});
