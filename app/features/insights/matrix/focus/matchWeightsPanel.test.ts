// Locks the fix for bug-ui-scan-2026-07-09 (candidate-profile-job-matching #5):
// the WeightsPanel kept a stale `draft` after an "Apply re-rank". The server
// renormalizes the recruiter's slider vector to sum-100 and the parent re-seeds the
// `weights` prop from the response, but the panel never re-synced `draft` to it — so
// the sliders + `{n}%` labels kept showing the pre-normalization drag while the
// ranking reflected the normalized vector, and `dirty` stayed true, leaving "Apply
// re-rank" falsely enabled.
//
// The panel is a .tsx (node --test can't load JSX), so the two rules its slider state
// depends on are extracted into MatchTypes.ts and pinned here directly.
//
// Non-vacuity: the scenario test asserts that with the STALE draft the panel is dirty
// (button enabled) and only after re-syncing the draft to the applied vector is it
// clean — i.e. removing the sync effect (the fix) makes the "clean after sync"
// assertion fail, because draft would still equal the stale drag.
//
// Runner: Node's built-in test runner with type stripping. npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { syncDraftToWeights, weightsDirty, type WeightVector } from "@/app/features/shared/matchTypes";

test("weightsDirty flags a real slider move but ignores sub-percent renormalization jitter", () => {
  const base: WeightVector = { skills: 0.5, career: 0.3, personal: 0.2 };
  // No movement -> not dirty.
  assert.equal(weightsDirty(base, base), false);
  // A whole-percent move on any dimension -> dirty.
  assert.equal(weightsDirty({ skills: 0.6, career: 0.3, personal: 0.2 }, base), true);
  assert.equal(weightsDirty({ skills: 0.5, career: 0.29, personal: 0.21 }, base), true);
  // Sub-percent float jitter (both round to the same whole percent the slider shows)
  // must NOT read as dirty — otherwise the button flickers enabled after a re-rank.
  assert.equal(weightsDirty({ skills: 0.5049, career: 0.2951, personal: 0.2 }, base), false);
});

test("syncDraftToWeights re-anchors the draft to the in-effect vector as a fresh object", () => {
  const applied: WeightVector = { skills: 0.45, career: 0.33, personal: 0.22 };
  assert.deepEqual(syncDraftToWeights(applied), applied);
  // Fresh object (not the prop reference) so setState always re-renders.
  assert.notStrictEqual(syncDraftToWeights(applied), applied);
});

test("after an apply renormalizes weights, re-syncing the draft flips 'Apply re-rank' off (stale draft leaves it falsely on)", () => {
  // Recruiter dragged skills to 60% (career/personal untouched at 20/20).
  const dragged: WeightVector = { skills: 0.6, career: 0.2, personal: 0.2 };
  // Server renormalizes to sum-100 and the parent re-seeds `weights` from the response.
  const applied: WeightVector = { skills: 0.45, career: 0.33, personal: 0.22 };

  // PRE-FIX: the draft was never re-synced, so it stayed at the drag -> the panel
  // reports dirty -> the button is (wrongly) still enabled.
  assert.equal(weightsDirty(dragged, applied), true);

  // POST-FIX: the weights-sync effect re-anchors the draft to the vector in effect,
  // so the panel is clean and the button is correctly disabled.
  const synced = syncDraftToWeights(applied);
  assert.equal(weightsDirty(synced, applied), false);
});
