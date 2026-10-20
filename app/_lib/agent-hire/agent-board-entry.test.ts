// The agent-fit transform files the agent on the role board (ADR-0012: one board,
// people and agents, one frozen rubric). persistAgentFit is the seam: the spec row
// and the board entry commit together or not at all, and a re-transform lands on
// the SAME entry. testing/unit-db.ts must stay the first project import.
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { persistAgentFit } from "./transform-run.ts";
import { ensureDb } from "../db/core.ts";
import { createPipelineEntry, getPipelineEntry, listPipelineEventsForEntry } from "../db/pipeline.ts";
import { readRoleSlate, freezeRubricFromBrief } from "../db/role-slate.ts";
import { mintRoleRubric } from "../db/role-rubrics.ts";
import { DEFAULT_WORKSPACE_ID } from "../db/workspaces.ts";
import { deriveRoleRubric } from "../role-rubric.ts";
import type { RoleBrief } from "../rolespec.ts";

after(() => cleanupUnitDb());

let seq = 0;
function job(): string {
  seq += 1;
  const id = `afbe-job-${seq}`;
  ensureDb()
    .prepare(`INSERT INTO jobs (id, title, payload_json, created_at, workspace_id) VALUES (?, ?, ?, ?, NULL)`)
    .run(id, `Role ${id}`, JSON.stringify({ id, title: `Role ${id}`, description: "Ship things." }), new Date().toISOString());
  return id;
}

function envelope(name: string) {
  return {
    result: {
      fit: { verdict: "good", coverage: [], coverageRatio: 0.8 },
      spec: { name, mission: "m", systemPromptDraft: "p", connectors: [], maxTurns: null },
      budget: { suggestedMonthlyUsd: null, rule: "r", salaryBandRef: "s" },
      metrics: [],
    },
    source: "deterministic",
    perStepSources: {},
    fallbackReason: {},
  };
}

const BRIEF = {
  title: "Reporting owner",
  seniority: "senior",
  roleFamily: "data_analytics",
  summary: "x",
  successCriteria: ["a"],
  responsibilities: ["b"],
  requirements: [
    { skill: "SQL", kind: "must_have", hardness: "prerequisite", weight: 0.8, rationale: "", provenance: "stated", confidence: 0.9 },
  ],
  facets: [],
} as RoleBrief;

const rows = (jobId: string, ws = DEFAULT_WORKSPACE_ID) =>
  ensureDb().prepare(`SELECT * FROM pipeline_entries WHERE job_id = ? AND workspace_id = ?`).all(jobId, ws) as Array<Record<string, unknown>>;

test("one persist files exactly one active agent entry, beside a human on the same slate", () => {
  const jobId = job();
  createPipelineEntry({ candidateId: "cand-h", candidateLabel: "Human H", jobId, jobTitle: "T" });
  const out = persistAgentFit(jobId, envelope("Reporter"));
  const agentRows = rows(jobId).filter((r) => r.population === "agent");
  assert.equal(agentRows.length, 1);
  assert.equal(agentRows[0].status, "active");
  assert.equal(agentRows[0].id, out.entryId);
  const slate = readRoleSlate(jobId, new Map());
  assert.equal(slate.members.length, 2);
  assert.deepEqual(slate.members.map((m) => m.population).sort(), ["agent", "human"]);
  assert.equal(slate.members.find((m) => m.population === "agent")?.label, "Reporter");
});

test("a re-transform with a new spec name lands on the same entry", () => {
  const jobId = job();
  const a = persistAgentFit(jobId, envelope("First"));
  const b = persistAgentFit(jobId, envelope("Second"));
  assert.equal(a.entryId, b.entryId);
  assert.equal(rows(jobId).length, 1);
  assert.notEqual(a.record.id, b.record.id, "the spec row is still versioned");
});

test("rubric_version is the frozen version, NULL for a draft or no rubric", () => {
  const none = job();
  assert.equal(getPipelineEntry(persistAgentFit(none, envelope("A")).entryId)?.rubricVersion ?? null, null);

  const draft = job();
  const minted = mintRoleRubric({ jobId: draft, intakeId: null, axes: deriveRoleRubric(BRIEF), source: "manual" });
  assert.ok(minted.ok);
  assert.equal(getPipelineEntry(persistAgentFit(draft, envelope("A")).entryId)?.rubricVersion ?? null, null);

  const fz = job();
  const f = freezeRubricFromBrief(fz, BRIEF);
  assert.ok(f.ok);
  const entry = getPipelineEntry(persistAgentFit(fz, envelope("A")).entryId);
  assert.equal(entry?.rubricVersion, f.rubric.version);
});

test("a persist in ws-b leaves ws-a's board unchanged", () => {
  const jobId = job();
  persistAgentFit(jobId, envelope("A"), DEFAULT_WORKSPACE_ID);
  const before = rows(jobId, DEFAULT_WORKSPACE_ID).length;
  persistAgentFit(jobId, envelope("B"), "ws-b");
  assert.equal(rows(jobId, DEFAULT_WORKSPACE_ID).length, before);
  assert.equal(rows(jobId, "ws-b").length, 1);
});

test("the 'added' event carries actor auto:agent-fit", () => {
  const jobId = job();
  const { entryId } = persistAgentFit(jobId, envelope("A"));
  const added = listPipelineEventsForEntry(entryId, 50, DEFAULT_WORKSPACE_ID).find((e) => e.kind === "added");
  assert.equal(added?.actor, "auto:agent-fit");
});
