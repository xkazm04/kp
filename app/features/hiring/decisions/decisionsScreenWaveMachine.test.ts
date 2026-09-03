// Pins the screening-wave state machine: debounce -> preview -> confirm ->
// commit -> 409 -> re-preview, and the notice that must survive exactly one
// refresh (the bug fixed in 40fc5ac3, asserted nowhere until now).
import { test } from "node:test";
import assert from "node:assert/strict";
import { INITIAL_WAVE_STATE, waveReduce, type WaveMachineState } from "./decisionsScreenWaveMachine.ts";
import type { WaveResult } from "./decisionsScreenWaveTypes.ts";

const result = (n: number) => ({ decisions: new Array(n).fill(0).map((_, i) => ({ label: `c${i}` })), commsFailures: 0 } as unknown as WaveResult);
const run = (events: Parameters<typeof waveReduce>[1][], from: WaveMachineState = INITIAL_WAVE_STATE) =>
  events.reduce((s, e) => waveReduce(s, e), from);

test("the first preview settles into a loaded, error-free state", () => {
  const s = run([{ type: "previewStarted" }, { type: "previewSucceeded", result: result(3) }, { type: "previewSettled" }]);
  assert.equal(s.loading, false);
  assert.equal(s.error, null);
  assert.equal(s.preview?.decisions.length, 3);
});

test("a preview failure is reported and clears no previous preview", () => {
  const s = run([
    { type: "previewStarted" },
    { type: "previewSucceeded", result: result(2) },
    { type: "previewSettled" },
    { type: "previewStarted" },
    { type: "previewFailed", message: "preview failed" },
    { type: "previewSettled" },
  ]);
  assert.equal(s.error, "preview failed");
  assert.equal(s.loading, false);
  assert.equal(s.preview?.decisions.length, 2, "the last good preview stays on screen behind the error");
});

test("commit success closes the confirm step and freezes the committed result", () => {
  const s = run([
    { type: "previewStarted" },
    { type: "previewSucceeded", result: result(4) },
    { type: "previewSettled" },
    { type: "confirmOpened" },
    { type: "commitStarted" },
    { type: "commitSucceeded", result: result(4) },
    { type: "commitSettled" },
  ]);
  assert.equal(s.committing, false);
  assert.equal(s.confirmOpen, false);
  assert.equal(s.committed?.decisions.length, 4);
  assert.equal(s.error, null);
});

test("a 409 bumps the refresh nonce and arms the notice", () => {
  const s = run([
    { type: "previewStarted" },
    { type: "previewSucceeded", result: result(4) },
    { type: "previewSettled" },
    { type: "commitStarted" },
    { type: "commitConflict", message: "the set changed — review and approve again" },
    { type: "commitSettled" },
  ]);
  assert.equal(s.error, "the set changed — review and approve again");
  assert.equal(s.refreshNonce, INITIAL_WAVE_STATE.refreshNonce + 1, "the re-preview must be triggered");
  assert.equal(s.committed, null, "a conflicted commit committed nothing");
  assert.equal(s.confirmOpen, false);
});

test("the 409 notice survives the re-preview it triggers", () => {
  const conflicted = run([
    { type: "previewStarted" },
    { type: "previewSucceeded", result: result(4) },
    { type: "previewSettled" },
    { type: "commitStarted" },
    { type: "commitConflict", message: "set changed" },
    { type: "commitSettled" },
  ]);
  const after = run([{ type: "previewStarted" }, { type: "previewSucceeded", result: result(5) }, { type: "previewSettled" }], conflicted);
  assert.equal(after.error, "set changed", "the line saying the approval did NOT land must outlive its own re-preview");
  assert.equal(after.preview?.decisions.length, 5, "and the fresh set is what the recruiter now approves");
});

test("the notice is consumed on exactly ONE settle — the next preview clears it", () => {
  const conflicted = run([{ type: "commitStarted" }, { type: "commitConflict", message: "set changed" }, { type: "commitSettled" }]);
  const first = run([{ type: "previewStarted" }, { type: "previewSucceeded", result: result(5) }, { type: "previewSettled" }], conflicted);
  assert.equal(first.error, "set changed");
  const second = run([{ type: "previewStarted" }, { type: "previewSucceeded", result: result(6) }, { type: "previewSettled" }], first);
  assert.equal(second.error, null, "a later slider change clears normally");
});

test("the notice is consumed even when the re-preview itself fails", () => {
  const conflicted = run([{ type: "commitStarted" }, { type: "commitConflict", message: "set changed" }, { type: "commitSettled" }]);
  const failed = run([{ type: "previewStarted" }, { type: "previewFailed", message: "preview failed" }, { type: "previewSettled" }], conflicted);
  assert.equal(failed.error, "preview failed", "a failing re-preview reports itself");
  assert.equal(failed.keepCommitNotice, false, "and the armed notice is spent, never left to stick to a later preview");
});

test("a commit failure that is not a 409 triggers no re-preview", () => {
  const s = run([{ type: "commitStarted" }, { type: "commitFailed", message: "wave failed" }, { type: "commitSettled" }]);
  assert.equal(s.error, "wave failed");
  assert.equal(s.refreshNonce, INITIAL_WAVE_STATE.refreshNonce, "only a conflict re-previews");
  assert.equal(s.keepCommitNotice, false);
});

test("opening the commit clears a stale error and cancelling closes the confirm", () => {
  const s = run([{ type: "commitStarted" }, { type: "commitFailed", message: "wave failed" }, { type: "commitSettled" }]);
  assert.equal(waveReduce(s, { type: "commitStarted" }).error, null);
  assert.equal(waveReduce({ ...s, confirmOpen: true }, { type: "confirmClosed" }).confirmOpen, false);
});
