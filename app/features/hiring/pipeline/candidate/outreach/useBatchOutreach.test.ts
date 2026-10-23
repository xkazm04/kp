// The bulk sheet is REACHABLE: the Orbit's compare bench (the only surface left with a picked
// cohort) starts the batch drafter and opens BulkOutreachSheet on what it drafted. The hook is
// React state over a task poll and the repo has no component renderer, so the wiring is pinned
// by reading the source (the technique drawerCommsTruth.test.ts uses for this directory).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { draftedEntryIds } from "./outreachBulk.ts";

const bench = readFileSync(new URL("../../orbit/ladder/OrbitLadderCompare.tsx", import.meta.url), "utf8");
const hook = readFileSync(new URL("./useBatchOutreach.ts", import.meta.url), "utf8");

test("only the candidates a run drafted for reach the sheet", () => {
  assert.deepEqual(draftedEntryIds({ results: [{ id: "a", ok: true }, { id: "b", ok: false }, { id: "c", ok: true }] }), ["a", "c"]);
  assert.deepEqual(draftedEntryIds(null), []);
  assert.deepEqual(draftedEntryIds({}), []);
});

test("the compare bench opens the sheet from the batch outreach action", () => {
  assert.match(bench, /useBatchOutreach\(\)/);
  assert.match(bench, /outreach\.start\(pickedHere\)/, "the button starts the drafter on the picked cohort");
  assert.match(bench, /<BulkOutreachSheet entryIds=\{outreach\.sheet\}/, "…and the sheet opens on the drafted entries");
});

test("the hook starts the draft task and never sends", () => {
  assert.match(hook, /startTask\("batch_outreach"/);
  assert.doesNotMatch(hook, /releaseLetter|sendComm|\/release/, "the release stays the sheet's per-letter doors");
});
