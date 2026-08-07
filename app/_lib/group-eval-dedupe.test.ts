// bug-ui-scan-2026-07-09 #3: the group_eval dedupe key must fold the governance mode
// AND the candidate set, not just the role — otherwise a concurrent re-trigger with a
// materially different mode/pool is silently handed the in-flight run's stale result.
//
// NON-VACUITY: the pre-fix builder was `stableKey("group_eval", p.roleKey)` — the role
// ALONE. Every "different mode / different set → DIFFERENT key" assertion below would
// FAIL against it (it returns the same `group_eval:backend` regardless of mode/pool);
// the "reordered set → SAME key" and "true retry → SAME key" assertions pin that a
// genuine retry still dedupes. Run: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { groupEvalDedupeKey, candidateSetFingerprint } from "./group-eval-dedupe.ts";

const cand = (entryId: string, candidateId: string | null = null) => ({ entryId, candidateId });

test("a missing/blank role identity yields null (stableKey null-contract), else a keyed string", () => {
  assert.equal(groupEvalDedupeKey({}), null);
  assert.equal(groupEvalDedupeKey({ roleKey: "" }), null);
  assert.equal(groupEvalDedupeKey({ roleKey: "   " }), null, "whitespace-only role is blank");
  assert.match(groupEvalDedupeKey({ roleKey: "backend" }) ?? "", /^group_eval:backend:recommendation:/);
});

test("an absent governanceMode normalizes to recommendation (byte-stable across absent vs explicit)", () => {
  assert.equal(
    groupEvalDedupeKey({ roleKey: "backend" }),
    groupEvalDedupeKey({ roleKey: "backend", governanceMode: "recommendation" }),
  );
  assert.equal(
    groupEvalDedupeKey({ roleKey: "backend", governanceMode: "bogus-mode" }),
    groupEvalDedupeKey({ roleKey: "backend" }),
    "an invalid mode also normalizes to recommendation",
  );
});

test("changing ONLY the governance mode changes the key (the reported collision)", () => {
  const base = { roleKey: "backend", candidates: [cand("e1"), cand("e2")] };
  const reco = groupEvalDedupeKey({ ...base, governanceMode: "recommendation" });
  const committee = groupEvalDedupeKey({ ...base, governanceMode: "committee" });
  const eligibility = groupEvalDedupeKey({ ...base, governanceMode: "eligibility_list" });
  assert.notEqual(reco, committee, "recommendation vs committee must not collapse into one run");
  assert.notEqual(committee, eligibility);
  assert.notEqual(reco, eligibility);
});

test("changing ONLY the candidate set changes the key; reordering the SAME set does not", () => {
  const mode = "recommendation";
  const setP = groupEvalDedupeKey({ roleKey: "r", governanceMode: mode, candidates: [cand("e1"), cand("e2")] });
  const setPrime = groupEvalDedupeKey({ roleKey: "r", governanceMode: mode, candidates: [cand("e1"), cand("e2"), cand("e3")] });
  const setPreordered = groupEvalDedupeKey({ roleKey: "r", governanceMode: mode, candidates: [cand("e2"), cand("e1")] });
  assert.notEqual(setP, setPrime, "adding a candidate must start its own run");
  assert.equal(setP, setPreordered, "the same people in a different order is the SAME run (order-independent)");
});

test("a true retry — same role, mode AND set — dedupes (byte-identical key)", () => {
  const a = groupEvalDedupeKey({ roleKey: "r", governanceMode: "committee", candidates: [cand("e2"), cand("e1")] });
  const b = groupEvalDedupeKey({ roleKey: "r", governanceMode: "committee", candidates: [cand("e1"), cand("e2")] });
  assert.equal(a, b);
});

test("candidate identity is candidateId when present, else entryId (mirrors runGroupEval)", () => {
  // Two entries for the SAME person (same candidateId, different entry ids) fingerprint
  // identically; a different candidateId does not.
  assert.equal(
    candidateSetFingerprint([cand("e1", "cand-A")]),
    candidateSetFingerprint([cand("e9", "cand-A")]),
    "same candidateId, different entryId → same identity",
  );
  assert.notEqual(
    candidateSetFingerprint([cand("e1", "cand-A")]),
    candidateSetFingerprint([cand("e1", "cand-B")]),
  );
  // Blank identities are ignored; the empty set has a stable fingerprint.
  assert.equal(candidateSetFingerprint([]), candidateSetFingerprint([{ entryId: "", candidateId: null }]));
});
