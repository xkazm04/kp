// Tenant scope for scoreOutcomeInputs (pipeline-calibration.ts): one team's scores,
// trail and sealed confidences never reach another team's validation report. Behavioral
// (two workspaces on the isolated unit DB) plus a source guard over every SQL block.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { actOnPipelineEntry, createPipelineEntry } from "./pipeline.ts";
import { scoreOutcomeInputs } from "./pipeline-calibration.ts";

after(() => cleanupUnitDb());

test("scoreOutcomeInputs reads only the caller's workspace", () => {
  const add = (ws: string, n: number) =>
    createPipelineEntry({
      candidateId: `so-${ws}-${n}`,
      candidateLabel: `Outcome Tester ${n}`,
      jobId: `so-job-${ws}`,
      jobTitle: "Outcome Role",
      matchScore: 60 + n,
      workspaceId: ws,
    }).entry;
  const a = add("ws-so-a", 1);
  const b = add("ws-so-b", 2);
  assert.ok(actOnPipelineEntry(a.id, "accept", undefined, undefined, "ws-so-a"));
  assert.ok(actOnPipelineEntry(b.id, "reject", undefined, undefined, "ws-so-b"));

  const inA = scoreOutcomeInputs("ws-so-a");
  assert.deepEqual(inA.entries.map((e) => e.entryId), [a.id]);
  assert.ok(inA.events.length > 0 && inA.events.every((e) => e.entryId === a.id));
  const inB = scoreOutcomeInputs("ws-so-b");
  assert.deepEqual(inB.entries.map((e) => e.entryId), [b.id]);
  assert.ok(inB.events.every((e) => e.entryId === b.id));
  assert.equal(inA.axis.stages[inA.axis.terminalIndex], "Hired");
});

test("every SQL block in scoreOutcomeInputs binds workspace_id", () => {
  const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "pipeline-calibration.ts"), "utf8");
  const body = src.slice(src.indexOf("export function scoreOutcomeInputs"));
  const blocks = [...body.matchAll(/`([^`]*)`/g)].map((m) => m[1]).filter((s) => /\bFROM\b/i.test(s));
  assert.ok(blocks.length >= 3, `expected >= 3 queries, found ${blocks.length}`);
  for (const sql of blocks) assert.match(sql, /workspace_id\s*=\s*\?/i, sql.trim().slice(0, 160));
});
