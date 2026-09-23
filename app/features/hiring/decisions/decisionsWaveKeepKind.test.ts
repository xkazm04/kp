// Pins waveKeepKind against the closed ScreenReasonCode set so holdout keeps
// cannot regress to "ordinary keep" / `other`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { waveKeepKind } from "./decisionsFloorDisclosure.ts";
import { SCREEN_REASON_CODES, type ScreenReasonCode } from "@/app/_lib/screen-wave-contract.ts";

const ALL: ScreenReasonCode[] = [
  "autoRejectOff",
  "earlyCareer",
  "unknownArchetype",
  "tieAtCutoff",
  "aboveCutoff",
  "atThreshold",
  "reject",
  "staleSkipped",
  "unscored",
  "reinstated",
  "sealFailed",
  "holdout",
  "holdoutSealFailed",
  "recruiterSpared",
];

test("holdout and holdoutSealFailed map to holdout kinds, not other", () => {
  assert.equal(waveKeepKind("holdout"), "holdout");
  assert.equal(waveKeepKind("holdoutSealFailed"), "holdoutSealFailed");
  assert.notEqual(waveKeepKind("holdout"), "other");
  assert.notEqual(waveKeepKind("holdoutSealFailed"), "other");
});

test("fairness-protected keep codes classify as fairness", () => {
  assert.equal(waveKeepKind("earlyCareer"), "fairness");
  assert.equal(waveKeepKind("unknownArchetype"), "fairness");
});

test("every other ScreenReasonCode, and a missing code, is other", () => {
  for (const code of ALL) {
    if (code === "holdout" || code === "holdoutSealFailed") continue;
    if (code === "earlyCareer" || code === "unknownArchetype") continue;
    assert.equal(waveKeepKind(code), "other", code);
  }
  assert.equal(waveKeepKind(undefined), "other");
  assert.equal(waveKeepKind(null), "other");
  assert.equal(waveKeepKind(""), "other");
});

test("the closed set in this file matches SCREEN_REASON_CODES, the wire contract's runtime list", () => {
  // Was a regex over screen-wave.ts's union; the vocabulary is now a literal array in
  // the import-free contract, so the comparison is against the value itself.
  assert.deepEqual([...SCREEN_REASON_CODES].sort(), [...ALL].sort(), "waveKeepKind's closed set drifted from SCREEN_REASON_CODES");
  // screen-wave.ts must not grow a second, hand-kept union again.
  const src = readFileSync(fileURLToPath(new URL("../../../_lib/screen-wave.ts", import.meta.url)), "utf8");
  assert.doesNotMatch(src, /export type ScreenReasonCode =/, "screen-wave.ts re-exports the contract's union, it does not redeclare it");
});
