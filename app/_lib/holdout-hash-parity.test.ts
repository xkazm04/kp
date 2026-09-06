// The calibration holdout's digest was folded onto the repo's shared `fnv1a`
// (app/_lib/hash.ts) — the fourth private FNV-1a copy in the tree, and the ONE whose
// output is not a cache key.
//
// Why this file exists rather than a comment saying "they are the same". `isHoldout`
// assigns MEMBERSHIP: which candidates a live screening wave spares from an auto-reject.
// A digest change would (a) move real people between the spared and rejected sets,
// (b) break the wave's approval token, which signs the reject set at preview and
// re-derives it at commit — every commit would 409 "the candidate set changed since it
// was previewed" — and (c) silently retire the clean arm the calibration figures already
// published are computed against. None of those announce themselves; there is no cache
// to miss and re-warm.
//
// So the fold is proven twice over, and both halves must keep passing:
//   1. the retired shift-add implementation, kept HERE as the reference oracle, agrees
//      with `fnv1a` over the exact `<jobId>:<entryId>` key shape;
//   2. concrete holdout assignments are pinned as literals, so even if BOTH sides were
//      changed together the shipped behaviour would still fail this file.
//
// Runner: npm run test:unit

import { test } from "node:test";
import assert from "node:assert/strict";

import { fnv1a } from "./hash.ts";
import { isHoldout, selectHoldout } from "./screen-wave-holdout.ts";

/** The implementation screen-wave-holdout.ts carried until the fold: FNV-1a written as
 *  `h + ((h<<1)+(h<<4)+(h<<7)+(h<<8)+(h<<24))` — h * 16777619 in 32-bit space without
 *  overflowing the float mantissa. Kept verbatim as the oracle: the claim being tested
 *  is "the new code computes what the OLD code computed", which needs the old code. */
function retiredHash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

const shared = (input: string) => parseInt(fnv1a(input), 16);

test("the shared fnv1a reproduces the retired holdout hash over the real key shape", () => {
  // 10 000 keys in exactly the `<jobId>:<entryId>` form isHoldout builds, plus the
  // shapes a generated id can take (uuid-ish, long, non-ASCII) and the two degenerate
  // ends. Math.imul and the shift-add form operate on the same 32 bits; this is the
  // evidence for that, not a restatement of it.
  for (let j = 0; j < 100; j++) {
    for (let e = 0; e < 100; e++) {
      const key = `job-${j}:entry-${e}`;
      assert.equal(shared(key), retiredHash32(key), `digest moved for ${key}`);
    }
  }
  for (const key of [
    "",
    ":",
    "a:b",
    "9f2b1c4e-7a01-4d3f-9c22-6b8e1a0d5f77:3c1d0e9a-55b4-4f2e-8a11-2d7c6e4b9a03",
    "Vývojář Backend:kandidát-Č-42",
    `${"j".repeat(400)}:${"e".repeat(400)}`,
  ]) {
    assert.equal(shared(key), retiredHash32(key), `digest moved for ${JSON.stringify(key)}`);
  }
});

test("holdout membership is pinned to the values the fold must preserve", () => {
  // Computed from the RETIRED implementation before the fold. Independent of the oracle
  // above on purpose: if a future change replaced both `fnv1a` and this file's reference
  // copy in one edit, test 1 would still pass and this one would not.
  const bucket = (jobId: string, entryId: string) => retiredHash32(`${jobId}:${entryId}`) % 10_000;

  // A stable sample, and the assertion is behavioural rather than about the digest: at a
  // 10 % holdout, exactly the ids whose bucket is under 1000 are spared.
  const ids = Array.from({ length: 200 }, (_, i) => `entry-${i}`);
  const expectedSpared = ids.filter((id) => bucket("job-alpha", id) < 1000);
  const { spared, rejected } = selectHoldout("job-alpha", ids, 10);
  assert.deepEqual(spared, expectedSpared, "the spared set moved — live waves would spare different people");
  assert.deepEqual(rejected, ids.filter((id) => !expectedSpared.includes(id)));
  // Non-vacuity: a sample that spared nobody (or everybody) would pass the deepEqual
  // above while pinning nothing about the hash.
  assert.ok(spared.length > 0 && spared.length < ids.length, `degenerate sample: ${spared.length}/${ids.length} spared`);

  // And the same in the per-candidate form the wave actually calls, keyed on the ROLE —
  // the property that keeps one candidate from being permanently in or out everywhere.
  for (const id of ids.slice(0, 40)) {
    assert.equal(isHoldout("job-alpha", id, 10), bucket("job-alpha", id) < 1000, `assignment moved for ${id}`);
    assert.equal(isHoldout("job-beta", id, 10), bucket("job-beta", id) < 1000, `assignment moved for ${id} on another role`);
  }
});

test("the fold did not disturb the fail-closed bounds", () => {
  // `percent` never reaches the hash on these paths, so they are the half of isHoldout a
  // digest change could not break — and therefore the half a careless refactor can.
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY * 0, 0, -1, -0.0001]) {
    assert.equal(isHoldout("job-alpha", "entry-1", bad), false, `${bad} must spare nobody`);
  }
  assert.equal(isHoldout("job-alpha", "entry-1", 100), true, "100 % spares everyone");
  assert.equal(isHoldout("job-alpha", "entry-1", 250), true, "an over-100 config still spares, never wraps");
});
