// The cache-HIT governance rule (see groupEval/governanceCacheSync.ts). The server
// blocks only the silent governed→recommendation downgrade; the client's cache-hit
// sync used to overwrite the control in BOTH directions, so a deliberate
// recommendation→committee switch was erased by opening an already-evaluated role.
//
// These pin both halves: what must now SPEAK, and — just as important — what must
// stay silent and unchanged.
import test from "node:test";
import assert from "node:assert/strict";
import { syncGovernanceOnCacheHit } from "./groupEval/governanceCacheSync";

test("an escalation the recruiter chose survives the cache hit, and is disclosed", () => {
  // The bug: saved eval ran as "recommendation", recruiter has deliberately selected
  // "committee". The control must NOT snap back, and the reader must be told the
  // comparison in front of them did not run under the mode they asked for.
  const r = syncGovernanceOnCacheHit("recommendation", "committee", true);
  assert.equal(r.mode, "committee");
  assert.deepEqual(r.mismatch, { ranUnder: "recommendation", selected: "committee", weaker: true });

  const e = syncGovernanceOnCacheHit("recommendation", "eligibility_list", true);
  assert.equal(e.mode, "eligibility_list");
  assert.equal(e.mismatch?.weaker, true);
});

test("a stored governed mode still snaps the control UP, with no notice", () => {
  // The reason the sync line exists (bug-ui-scan-2026-07-09 #1): evalMode is
  // unpersisted per-mount state defaulting to "recommendation", so a committee role
  // must raise the control or a later re-run re-sends the weaker mode.
  for (const chose of [true, false]) {
    for (const stored of ["committee", "eligibility_list"] as const) {
      const r = syncGovernanceOnCacheHit(stored, "recommendation", chose);
      assert.equal(r.mode, stored, `stored=${stored} userChose=${chose}`);
      assert.equal(r.mismatch, null, `stored=${stored} userChose=${chose}`);
    }
  }
});

test("a matching cache hit changes nothing and says nothing", () => {
  for (const m of ["recommendation", "committee", "eligibility_list"] as const) {
    for (const chose of [true, false]) {
      const r = syncGovernanceOnCacheHit(m, m, chose);
      assert.equal(r.mode, m);
      assert.equal(r.mismatch, null);
    }
  }
});

test("an untouched control follows the payload, so a mode raised on one role never leaks onto the next", () => {
  // Opening a committee role raises the control; opening a plain recommendation role
  // next must not inherit "committee" — the recruiter never asked for it, and a
  // re-run would then evaluate that second role under a mode nobody chose.
  const r = syncGovernanceOnCacheHit("recommendation", "committee", false);
  assert.equal(r.mode, "recommendation");
  assert.equal(r.mismatch, null);
});

test("a lateral governed switch is honoured and disclosed, but is not a weakening", () => {
  const r = syncGovernanceOnCacheHit("committee", "eligibility_list", true);
  assert.equal(r.mode, "eligibility_list");
  assert.deepEqual(r.mismatch, { ranUnder: "committee", selected: "eligibility_list", weaker: false });
});

test("a legacy payload with no stored mode leaves the control alone and claims no mismatch", () => {
  for (const stored of [null, undefined]) {
    for (const chose of [true, false]) {
      const r = syncGovernanceOnCacheHit(stored, "committee", chose);
      assert.equal(r.mode, "committee");
      assert.equal(r.mismatch, null);
    }
  }
});
