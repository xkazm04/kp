import test from "node:test";
import assert from "node:assert/strict";

import { fnv1a } from "./hash.ts";
import { candidateSetFingerprint, groupEvalDedupeKey } from "./group-eval-dedupe.ts";
import { selectionCacheKey } from "@/app/features/hiring/decisions/groupEval/cache-key";

// The digests below are a COMPATIBILITY CONTRACT, not a spec of what FNV-1a
// "should" produce. They were captured from the two implementations this module
// replaced (group-eval-dedupe.ts's and groupEval/cache-key.ts's), which were
// byte-identical in output despite differing in source. Every persisted
// `group_evals.role_key` for a selection run, and every in-flight `group_eval`
// task dedupe key, embeds one of these. If a change here turns this test red the
// answer is to revert the change or ship a cache migration — never to re-record
// the expected values.
test("fnv1a digests are pinned to the values the two forked implementations produced", () => {
  assert.equal(fnv1a(""), "811c9dc5", "the empty string is the FNV-1a offset basis");
  assert.equal(fnv1a("a"), "e40c292c");
  assert.equal(fnv1a("e1,e2,e3"), "fd2673de", "the dedupe fingerprint's comma join");
  assert.equal(fnv1a("e1\u0000e2\u0000e3"), "56730e8e", "the selection key's NUL join");
  assert.equal(fnv1a("role-x"), "1200072c");
  assert.equal(fnv1a("hello world"), "d58b3fa7");
});

test("fnv1a always returns 8 lower-case hex characters", () => {
  for (const input of ["", "a", "\u0000", "zzzzzzzzzzzzzzzzzzzz", "🙂 unicode", "role-x#sel:2"]) {
    const out = fnv1a(input);
    assert.match(out, /^[0-9a-f]{8}$/, `"${input}" must hash to 8 lower-case hex chars, got "${out}"`);
  }
});

test("fnv1a is deterministic and distinguishes near-identical inputs", () => {
  assert.equal(fnv1a("e1,e2"), fnv1a("e1,e2"), "the same input must always hash the same");
  assert.notEqual(fnv1a("e1,e2"), fnv1a("e2,e1"), "order matters to the hash itself (callers sort first)");
  assert.notEqual(fnv1a("e1,e2"), fnv1a("e1,e3"));
});

// Both call sites now route through the shared helper. These pins are the reason
// the consolidation is safe to land without invalidating anything: the keys the
// two sites emit are the ones they emitted before.
test("the group_eval dedupe key is unchanged by the shared hash", () => {
  assert.equal(
    candidateSetFingerprint([{ candidateId: "e3" }, { candidateId: "e1" }, { candidateId: "e2" }]),
    "3-fd2673de",
    "sorted, comma-joined, size-prefixed — the pre-consolidation fingerprint",
  );
  assert.equal(
    groupEvalDedupeKey({ roleKey: "role-x", governanceMode: "recommendation", candidates: [{ candidateId: "e1" }, { candidateId: "e2" }] }),
    `group_eval:role-x:recommendation:2-${fnv1a("e1,e2")}`,
  );
});

test("the selection cache key is unchanged by the shared hash", () => {
  assert.equal(selectionCacheKey("role-x", ["e3", "e1", "e2"]), "role-x#sel:3-56730e8e");
});
