// Owner ruling 6: the calibration instrument's two missing inputs are now RECORDED at the
// moment they exist, append-only, and read back by scoreOutcomeInputs:
//   - an automated advance's auto_advanced event carries the screening confidence it
//     compared against the bar (pipeline_events.inputs_json);
//   - a saved profile carries potential's four parts beside the composite
//     (profiles.payload_json $.potentialParts).
// Rows written before either existed read as "not recorded", never imputed.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { ensureDb } from "./core.ts";
import { actOnPipelineEntry, createPipelineEntry } from "./pipeline.ts";
import { saveProfile } from "./profiles.ts";
import { scoreOutcomeInputs } from "./pipeline-calibration.ts";
import { computeScoreOutcomes } from "../calibration-outcomes.ts";

after(() => cleanupUnitDb());

const here = path.dirname(fileURLToPath(import.meta.url));

function addEntry(ws: string, n: number, candidateId = `rec-${ws}-${n}`) {
  return createPipelineEntry({
    candidateId,
    candidateLabel: `Recording Tester ${n}`,
    jobId: `rec-job-${ws}`,
    jobTitle: "Recording Role",
    matchScore: 70 + n,
    workspaceId: ws,
  }).entry;
}

test("an automated advance's event carries the confidence it acted on; the reader returns it", () => {
  const ws = "ws-rec-conf";
  const recorded = addEntry(ws, 1);
  const legacy = addEntry(ws, 2);
  assert.ok(
    actOnPipelineEntry(recorded.id, "accept", undefined, { actor: "system", inputs: { screeningConfidence: 86, screeningConfidenceBar: 80 } }, ws)
  );
  // The shape every automated advance had before ruling 6: no inputs at all.
  assert.ok(actOnPipelineEntry(legacy.id, "accept", undefined, { actor: "system" }, ws));

  const rows = ensureDb()
    .prepare(`SELECT entry_id, kind, inputs_json FROM pipeline_events WHERE workspace_id = ? AND kind = 'auto_advanced' ORDER BY id`)
    .all(ws) as { entry_id: string; kind: string; inputs_json: string | null }[];
  assert.equal(rows.length, 2);
  assert.deepEqual(JSON.parse(rows[0].inputs_json as string), { screeningConfidence: 86, screeningConfidenceBar: 80 });
  assert.equal(rows[1].inputs_json, null, "nothing is written when nothing was compared");

  const inputs = scoreOutcomeInputs(ws);
  assert.deepEqual(
    inputs.confidences.map((c) => [c.entryId, c.kind, c.confidence]),
    [[recorded.id, "auto_advanced", 86]]
  );
  const report = computeScoreOutcomes(inputs.entries, inputs.events, inputs.confidences, inputs.axis);
  assert.equal(report.audit.automatedAdvances, 2);
  assert.equal(report.audit.withConfidence, 1);
  assert.equal(report.audit.notRecorded, 1, "the legacy advance is counted as not recorded, never imputed");
  assert.equal(report.audit.above.n, 1);
});

test("a human advance writes no inputs: the person's confidence stays on the sealed record", () => {
  const ws = "ws-rec-human";
  const e = addEntry(ws, 1);
  assert.ok(actOnPipelineEntry(e.id, "accept", undefined, undefined, ws));
  const row = ensureDb().prepare(`SELECT kind, inputs_json FROM pipeline_events WHERE workspace_id = ? AND kind = 'advanced'`).get(ws) as {
    kind: string;
    inputs_json: string | null;
  };
  assert.equal(row.inputs_json, null);
});

test("potential's four parts are read from the saved profile beside the composite; a profile without them reads null", () => {
  const ws = "ws-rec-parts";
  const withParts = saveProfile(
    {
      label: "Parts Student",
      archetype: "student",
      roleFamily: "software_engineering",
      completeness: 0.8,
      payload: { archetype: "student", potentialScore: 0.48, potentialParts: { depth: 0.5, velocity: 0.4, foundation: 0.6, initiative: 0.3 } },
    },
    ws
  );
  const composite = saveProfile(
    { label: "Old Student", archetype: "student", roleFamily: "software_engineering", completeness: 0.8, payload: { archetype: "student", potentialScore: 0.48 } },
    ws
  );
  const a = addEntry(ws, 1, withParts.id);
  const b = addEntry(ws, 2, composite.id);
  const byId = new Map(scoreOutcomeInputs(ws).entries.map((e) => [e.entryId, e.scores]));
  const pa = byId.get(a.id)!;
  assert.equal(pa.potential, 48);
  assert.equal(pa.potentialDepth, 50);
  assert.equal(pa.potentialVelocity, 40);
  assert.equal(pa.potentialFoundation, 60);
  assert.equal(pa.potentialInitiative, 30);
  const pb = byId.get(b.id)!;
  assert.equal(pb.potential, 48);
  for (const key of ["potentialDepth", "potentialVelocity", "potentialFoundation", "potentialInitiative"] as const) {
    assert.equal(pb[key], null, `${key} must be not-recorded, never derived from the composite`);
  }
});

test("source pin: the screen task's automated advance passes the verdict confidence and the shared bar", () => {
  const src = readFileSync(path.join(here, "..", "automation-run.ts"), "utf8");
  const at = src.indexOf("if (advance) {");
  assert.ok(at > 0, "the screen advance branch moved");
  const branch = src.slice(at, src.indexOf("if (!moved)", at));
  assert.match(branch, /const conf = result\.confidence;/);
  assert.match(branch, /screeningConfidence: conf, screeningConfidenceBar: SCREEN_ADVANCE_CONF/);
  assert.match(branch, /actOnPipelineEntry\(entry\.id, "accept", undefined, \{ expectedStage: entry\.stage, actor: "system", inputs \}/);
});
