// The prep modal's hydration + progress arithmetic (/perfect 2026-09-03, schedule-ui-2).
// All three rules lived inside a "use client" hook and had never been executed by a test,
// while each has already been wrong in a way a user saw. Pinned here.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyPrepState,
  hydratePrepState,
  prepProgress,
  splitImported,
  wovenKeyOf,
} from "./scheduleInterviewPrepProgress.ts";
import type { Prep } from "./scheduleInterviewPrepTypes.ts";

/** A minimal payload with `n` chronology blocks and `k` signals. */
function prepOf(n: number, k: number, extra: Partial<Prep> = {}): Prep {
  return {
    scenario: "s",
    durationMin: 30,
    focusAreas: [],
    chronology: Array.from({ length: n }, (_, i) => ({ fromMin: i, toMin: i + 1, topic: `t${i}`, goal: "g", questions: [] })),
    signals: Array.from({ length: k }, (_, i) => `signal ${i}`),
    ...extra,
  } as Prep;
}

// ---- hydration ---------------------------------------------------------------

test("hydratePrepState seeds checklist, notes and interviewer from a saved payload", () => {
  const seed = hydratePrepState(
    prepOf(2, 1, { userProgress: { checked: { "c-0": true }, notes: "said 'we shipped it in six weeks'" }, interviewer: "Ada" })
  );
  assert.deepEqual(seed.checked, { "c-0": true });
  assert.equal(seed.notes, "said 'we shipped it in six weeks'");
  assert.equal(seed.interviewer, "Ada");
});

test("hydratePrepState tolerates a payload that predates every human-input key", () => {
  // A pack generated before PREP2/PREP5 has no userProgress and no interviewer. The
  // modal must open, not throw, and must not seed `undefined` into a controlled input.
  const seed = hydratePrepState(prepOf(1, 1));
  assert.deepEqual(seed, emptyPrepState());
  assert.equal(seed.notes, "", "notes feeds a controlled textarea — never undefined");
  assert.equal(seed.interviewer, "");
});

test("hydratePrepState ignores ill-typed stored values rather than trusting them", () => {
  const seed = hydratePrepState({
    ...prepOf(1, 0),
    userProgress: { checked: { "c-0": false as unknown as boolean, "c-1": true }, notes: 42 as unknown as string },
    interviewer: null as unknown as string,
  } as Prep);
  assert.deepEqual(seed.checked, { "c-1": true }, "only genuinely-true keys carry over");
  assert.equal(seed.notes, "");
  assert.equal(seed.interviewer, "");
});

test("hydratePrepState of nothing is the empty state (the pre-load render)", () => {
  assert.deepEqual(hydratePrepState(null), emptyPrepState());
  assert.deepEqual(hydratePrepState(undefined), emptyPrepState());
});

// ---- imported-question split -------------------------------------------------

test("splitImported puts a question in exactly one list", () => {
  const topics = new Set(["t0", "t1"]);
  const { woven, unassigned } = splitImported(
    [{ question: "a", blockRef: "t0" }, { question: "b" }, { question: "c", blockRef: "t1" }],
    topics
  );
  assert.deepEqual(woven.map((e) => e.question), ["a", "c"]);
  assert.deepEqual(unassigned.map((e) => e.question), ["b"]);
});

test("a blockRef whose block no longer exists degrades to unassigned, never to lost", () => {
  // A Regenerate reshapes the chronology; a question woven into a topic that is gone
  // must reappear in the reference list rather than silently vanish from the modal.
  const { woven, unassigned } = splitImported([{ question: "orphan", blockRef: "deleted-topic" }], new Set(["t0"]));
  assert.equal(woven.length, 0);
  assert.deepEqual(unassigned.map((e) => e.question), ["orphan"]);
});

test("wovenKeyOf indexes into the woven list, and cannot collide with a rendered key", () => {
  const woven = [{ question: "a", blockRef: "t0" }, { question: "b", blockRef: "t1" }];
  assert.equal(wovenKeyOf(woven, "b"), "w-1");
  assert.equal(wovenKeyOf(woven, "not-woven"), "w--1", "no rendered checkbox can carry a negative index");
});

// ---- the meter ---------------------------------------------------------------

test("prepProgress counts blocks + signals + woven questions as the denominator", () => {
  const { total, done } = prepProgress(prepOf(3, 2), 1, {});
  assert.equal(total, 6);
  assert.equal(done, 0);
});

test("prepProgress counts only keys that map to a CURRENTLY-rendered item", () => {
  // The "9/6 done" regression: a plan that shrank kept its older userProgress keys, and
  // counting the map's own truthy entries rendered a done count above the total and a
  // >100% meter. c-9 and w-4 below are exactly those orphans.
  const { total, done } = prepProgress(prepOf(2, 1), 1, {
    "c-0": true,
    "c-9": true,
    "k-0": true,
    "w-0": true,
    "w-4": true,
  });
  assert.equal(total, 4);
  assert.equal(done, 3);
  assert.ok(done <= total, "the meter can never exceed 100%");
});

test("prepProgress with no pack is 0/0, not a crash", () => {
  assert.deepEqual(prepProgress(null, 3, { "c-0": true }), { total: 0, done: 0 });
});

test("prepProgress tolerates a payload with no signals key at all", () => {
  const noSignals = { ...prepOf(2, 0) } as Prep;
  delete (noSignals as { signals?: unknown }).signals;
  assert.deepEqual(prepProgress(noSignals, 0, { "c-1": true }), { total: 2, done: 1 });
});
