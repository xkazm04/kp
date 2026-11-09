import "better-sqlite3";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { ensureDb } from "./db/core.ts";
import { insertJob } from "./job-ingest.ts";
import { createPipelineEntry } from "./db/pipeline.ts";
import { createWorkspace } from "./db/workspaces.ts";
import { advanceRoleRun } from "./role-run-engine.ts";
import { getOrCreateRoleRun } from "./db/role-runs.ts";
import { roleRunGateToken } from "./role-run-gates.ts";
import { buildGateDisplay, previewRoleRunGate, resolveRoleRunGateSubject } from "./role-run-gate-preview.ts";
import type { JobRecord } from "./db/core.ts";

before(() => ensureDb());
after(() => cleanupUnitDb());

const names = (m: Record<string, string>) => (id: string) => m[id] ?? null;

test("the display block names candidate, proposal and reason for all three gates", () => {
  const nameOf = names({ e1: "Ada Lovelace" });
  const rej = buildGateDisplay("rejection", { decisions: [{ entryId: "e1", route: "reject_proposed", reasonCode: "below_floor" }] }, nameOf);
  assert.deepEqual(rej, [{ entryId: "e1", candidateName: "Ada Lovelace", proposal: { kind: "reject_proposed", detail: null }, reasonCode: "below_floor" }]);
  const inv = buildGateDisplay("interview_invite", { invites: [{ entryId: "e1", status: "proposed", slotAt: "2026-11-10T09:00" }] }, nameOf);
  assert.equal(inv[0].candidateName, "Ada Lovelace");
  assert.deepEqual(inv[0].proposal, { kind: "invite", detail: "proposed · 2026-11-10T09:00" });
  assert.equal(inv[0].reasonCode, null, "no reason in the artifact is null, for the panel to say so in words");
  const off = buildGateDisplay("offer", { drafts: [{ entryId: "e1", terms: { band: "B3", currency: "CZK", ttlDays: 7 }, ttlDays: 7, basis: { recommendation: "strong_yes" } }] }, nameOf);
  assert.equal(off[0].proposal.kind, "offer");
  assert.equal(off[0].proposal.detail, "B3 · CZK · 7d");
  assert.doesNotMatch(JSON.stringify(off), /strong_yes/, "a filed scorecard recommendation never reaches the display");
});

async function parked() {
  const jobId = `jd-gp-${Math.random().toString(36).slice(2, 8)}`;
  insertJob({ id: jobId, title: "GP", requirements: [{ skill: "java", kind: "skill", hardness: "must" }] } as unknown as JobRecord, undefined, "published");
  const { entry } = createPipelineEntry({ candidateId: `c-${jobId}`, candidateLabel: "Grace Hopper", jobId, jobTitle: "GP", matchScore: 90 });
  const { run } = getOrCreateRoleRun({ jobId });
  await advanceRoleRun(run.id);
  return { runId: run.id, branchRef: entry.id };
}

test("the display block is outside what is signed: token and subject set do not depend on it", async () => {
  const { runId, branchRef } = await parked();
  const now = 1_757_000_000_000;
  const a = previewRoleRunGate(runId, "rejection", branchRef, undefined, now);
  assert.equal(a.display[0]?.candidateName, "Grace Hopper");
  const subject = resolveRoleRunGateSubject(runId, "rejection", branchRef);
  assert.equal("display" in subject, false, "the commit path derives its set without the display");
  assert.equal(a.token, roleRunGateToken(runId, "rejection", subject.policyVersion, subject.subjectRefs, now));
  // Rename the candidate: the display changes, the signed bytes do not.
  ensureDb().prepare(`UPDATE pipeline_entries SET candidate_label = 'Someone Else' WHERE id = ?`).run(branchRef);
  const b = previewRoleRunGate(runId, "rejection", branchRef, undefined, now);
  assert.equal(b.display[0]?.candidateName, "Someone Else");
  assert.equal(b.token, a.token);
  assert.deepEqual(b.subjectRefs, a.subjectRefs);
  assert.equal(b.policyVersion, a.policyVersion);
});

test("workspace boundary: an entry in another workspace yields no name", async () => {
  const { runId, branchRef } = await parked();
  const other = createWorkspace("Other team");
  const p = previewRoleRunGate(runId, "rejection", branchRef, undefined, Date.now());
  const foreignNames = buildGateDisplay("rejection", p.parked, () => null);
  assert.equal(foreignNames[0]?.candidateName, null);
  // And through the real lookup: the same entry id read as another workspace resolves nothing.
  const { getPipelineEntriesByIds } = await import("./db/pipeline.ts");
  assert.equal(getPipelineEntriesByIds([branchRef], other.id).get(branchRef), undefined);
});
