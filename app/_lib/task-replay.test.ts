// challenge-r05 workspace-config-api/B — every finished run states its replay verdict.
//
// The Background-tasks table offered Retry on every dead row, and the retry door
// decided only AFTER the click whether the replay could run. For a failed CV analysis
// it never could (runAnalyze deletes its upload workdir on every exit), so the button's
// only possible answer was a 409. These cases pin the ONE verdict both sides now read.
import test from "node:test";
import assert from "node:assert/strict";
import { attachReplayVerdicts, replayBlock, replayVerdict } from "./task-replay.ts";
import { retryDecision } from "./task-fanout.ts";
import { taskKindCapability } from "./task-admission.ts";

const GONE = { baseDir: "/gone", variants: [{ cvPath: "/gone/a.pdf" }] };
const never = () => false;
const always = () => true;

test("a failed analyze whose workdir was cleaned up is inputs-gone", () => {
  assert.deepEqual(replayVerdict("analyze", "failed", GONE, never), { replayable: false, reason: "inputs-gone" });
  assert.deepEqual(replayVerdict("analyze", "canceled", GONE, never), { replayable: false, reason: "inputs-gone" });
});

test("an interrupted analyze whose workdir survived the crash is replayable", () => {
  assert.deepEqual(replayVerdict("analyze", "interrupted", GONE, always), { replayable: true });
});

test("self-contained kinds replay; a retired kind cannot", () => {
  assert.deepEqual(replayVerdict("batch_screen", "failed", { entryIds: ["e1"] }, never), { replayable: true });
  assert.deepEqual(replayVerdict("batch_screen", "failed", { entryIds: ["e1"] }, always), { replayable: true });
  assert.deepEqual(replayVerdict("retired_kind", "failed", {}, always), { replayable: false, reason: "kind-retired" });
});

test("a succeeded or active row offers no whole-run retry", () => {
  for (const status of ["succeeded", "running", "queued"]) {
    assert.equal(replayVerdict("batch_screen", status, { entryIds: ["e1"] }, always), null, status);
    assert.equal(replayVerdict("analyze", status, GONE, never), null, status);
  }
});

test("unrecognisable analyze params carry no claim and do not refuse", () => {
  // An old or hand-written row with no paths: the route let those through; so does the verdict.
  assert.deepEqual(replayVerdict("analyze", "failed", {}, never), { replayable: true });
  assert.deepEqual(replayVerdict("analyze", "failed", null, never), { replayable: true });
});

test("a caller without the kind's seat is not offered Retry (agrees with the retry door's seat check)", () => {
  const viewer = () => false;
  assert.deepEqual(replayVerdict("batch_screen", "failed", {}, always, viewer), { replayable: false, reason: "no-seat" });
  const asked: string[] = [];
  replayVerdict("batch_screen", "failed", {}, always, (cap) => (asked.push(cap), true));
  assert.deepEqual(asked, [taskKindCapability("batch_screen")], "the seat asked is the one task-admission declares");
});

test("the verdict agrees with retryDecision on which statuses a whole-run replay accepts", () => {
  for (const status of ["queued", "running", "succeeded", "failed", "canceled", "interrupted"]) {
    const decision = retryDecision({ kind: "batch_screen", status, params: {}, result: null }, undefined);
    const verdict = replayVerdict("batch_screen", status, {}, always);
    assert.equal("ok" in decision, verdict !== null, status);
  }
});

test("replayBlock is the status-agnostic half the retry route calls", () => {
  assert.equal(replayBlock("analyze", GONE, never), "inputs-gone");
  assert.equal(replayBlock("analyze", GONE, always), null);
  assert.equal(replayBlock("nope", {}, always), "kind-retired");
  assert.equal(replayBlock("batch_outreach", { entryIds: ["x"] }, never), null);
});

test("attachReplayVerdicts reads params ONCE per call, only for the path-bearing dead rows", () => {
  const rows = [
    { id: "a1", kind: "analyze", status: "failed" },
    { id: "a2", kind: "analyze", status: "running" },
    { id: "b1", kind: "batch_screen", status: "failed" },
    { id: "a3", kind: "analyze", status: "interrupted" },
    { id: "s1", kind: "reasoning", status: "succeeded" },
  ];
  const calls: string[][] = [];
  const out = attachReplayVerdicts(rows, {
    loadParams: (ids) => {
      calls.push([...ids]);
      return new Map<string, unknown>([
        ["a1", GONE],
        ["a3", { baseDir: "/alive", variants: [{ cvPath: "/alive/a.pdf" }] }],
      ]);
    },
    exists: (p) => p.startsWith("/alive"),
    hasCapability: () => true,
  });
  assert.deepEqual(calls, [["a1", "a3"]], "one bounded read, with exactly the page's dead analyze ids");
  const byId = Object.fromEntries(out.map((r) => [r.id, r.replay]));
  assert.deepEqual(byId.a1, { replayable: false, reason: "inputs-gone" });
  assert.equal(byId.a2, null);
  assert.deepEqual(byId.b1, { replayable: true });
  assert.deepEqual(byId.a3, { replayable: true });
  assert.equal(byId.s1, null);
});

test("attachReplayVerdicts skips the params read entirely when no row needs it", () => {
  let called = 0;
  attachReplayVerdicts([{ id: "b1", kind: "batch_screen", status: "failed" }], {
    loadParams: () => (called++, new Map()),
    exists: always,
    hasCapability: () => true,
  });
  assert.equal(called, 0);
});
