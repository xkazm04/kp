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

// ---- the outcome of the irreversible action is announced -----------------------
// The wave commit is the one action in this directory that cannot be undone, and
// its result reached a screen-reader user only if they went looking: the committed
// banner lived in one branch of a ternary and the modal's only aria-live region in
// the other, so committing swapped the live region OUT. The modal is .tsx with no
// component runner here, so the contract is pinned by reading the source
// (decisionsRulesLoad.test.ts's technique). CRLF-normalized on purpose: this
// checkout is CRLF while the worktree may be LF.
import { readFileSync } from "node:fs";

const modalSrc = readFileSync(new URL("./DecisionsScreenWaveModal.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("the committed banner IS a polite live region, mounted before the commit lands", () => {
  const region = /<p\n\s+role="status"\n\s+aria-live="polite"([\s\S]*?)<\/p>/.exec(modalSrc);
  assert.ok(region, "a role=status / aria-live=polite paragraph exists at the top of the modal body");
  assert.match(region[1], /committedBanner/, "…and it is the committed banner, not a second element that could drift from it");
  assert.match(region[1], /commsFailures/, "…including the partial-commit warning");
});

test("the live region is not inside the committed branch, so it exists to be updated", () => {
  const bannerAt = modalSrc.indexOf("committedBanner");
  const branchAt = modalSrc.indexOf("{committed ? (\n        <div");
  assert.ok(bannerAt > 0 && branchAt > 0, "both landmarks found");
  assert.ok(bannerAt < branchAt, "the region is rendered BEFORE the committed/preview fork, so it is mounted either way");
});
