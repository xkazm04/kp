// Pins waveKeepKind against the closed ScreenReasonCode set so holdout keeps
// cannot regress to "ordinary keep" / `other`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { waveKeepKind } from "./decisionsFloorDisclosure.ts";
import type { ScreenReasonCode } from "@/app/_lib/screen-wave.ts";

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

test("the closed set in this file matches ScreenReasonCode in screen-wave.ts", () => {
  const src = readFileSync(fileURLToPath(new URL("../../../_lib/screen-wave.ts", import.meta.url)), "utf8")
    .replace(/\r\n/g, "\n");
  const block = src.match(/export type ScreenReasonCode =\s*([\s\S]*?);/)?.[1] ?? "";
  const quoted = [...block.matchAll(/"([a-zA-Z]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(quoted, [...ALL].sort(), "waveKeepKind's closed set drifted from ScreenReasonCode");
});
