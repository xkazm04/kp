// The drawer note's dirty/flush/hydrate machine (pipelineDrawerNote.ts). Every case
// here is a way the four writers used to collide: a redundant second save on close, a
// keystroke typed during an in-flight save being dropped, a bundle hydration wiping
// what the recruiter was typing, and a board refresh fired on every autosave.
import { test } from "node:test";
import assert from "node:assert/strict";
import { noteUnmountAction, resolveNoteSave, shouldHydrateNote } from "./pipelineDrawerNote.ts";

test("a clean save clears dirty — so close does not fire a redundant second write", () => {
  const r = resolveNoteSave({ ok: true, savedValue: "wants 80k", latestValue: "wants 80k", savedThisSession: false });
  assert.deepEqual(r, { status: "saved", clearDirty: true, savedThisSession: true });
  assert.equal(noteUnmountAction({ dirty: false, savedThisSession: r.savedThisSession }), "refresh");
});

test("a keystroke typed WHILE the save was in flight keeps the note dirty", () => {
  // The exact drop this guards: clearing the flag unconditionally would lose
  // ", available August" — the debounce for it was cancelled by the close.
  const r = resolveNoteSave({
    ok: true,
    savedValue: "wants 80k",
    latestValue: "wants 80k, available August",
    savedThisSession: false,
  });
  assert.equal(r.clearDirty, false);
  assert.equal(r.savedThisSession, true, "a save DID land — the board copy is stale either way");
  assert.equal(noteUnmountAction({ dirty: true, savedThisSession: true }), "flush");
});

test("a failed save stays dirty so the unmount flush is the retry", () => {
  const r = resolveNoteSave({ ok: false, savedValue: "x", latestValue: "x", savedThisSession: false });
  assert.deepEqual(r, { status: "error", clearDirty: false, savedThisSession: false });
  assert.equal(noteUnmountAction({ dirty: true, savedThisSession: false }), "flush");
});

test("savedThisSession never goes back to false once a save has landed", () => {
  const r = resolveNoteSave({ ok: false, savedValue: "x", latestValue: "x", savedThisSession: true });
  assert.equal(r.savedThisSession, true);
});

test("the bundle hydrates only an UNEDITED note — never over live typing", () => {
  assert.equal(shouldHydrateNote("server truth", false), true, "heals the stale board prop");
  assert.equal(shouldHydrateNote("server truth", true), false, "an in-place re-pull cannot wipe an edit");
  assert.equal(shouldHydrateNote(null, false), false, "the bundle has not landed yet");
  assert.equal(shouldHydrateNote("", false), true, "a genuinely empty server note is a value, not an absence");
});

test("a drawer opened and closed without an edit owes nothing", () => {
  assert.equal(noteUnmountAction({ dirty: false, savedThisSession: false }), "none");
});
