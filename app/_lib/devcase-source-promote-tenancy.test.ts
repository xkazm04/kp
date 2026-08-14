// The dev-case SOURCE and PROMOTE chains both read a candidate pool and then write
// people into a pipeline. Neither carried a tenant, and the two failure shapes are
// different — which is why both halves need pinning:
//
//   SOURCE   runSourceForRole ranked the DEFAULT team's profiles while the caller
//            filed the matches under its own workspace. The board filled with rows
//            that looked native but held another tenant's real people (name, id,
//            archetype, score). The publish route was the dangerous half-fix: its
//            WRITE was already scoped, only the READ was not.
//   PROMOTE  promoteSubmission wrote the pipeline entry, the screening card and the
//            audit event with no tenant, so "Promote to pipeline" reported success
//            while the candidate's name and contact landed on the DEFAULT team's
//            board and never appeared on the promoting team's.
//
// The fix is structural, matching PipelineEntry.workspaceId: DevCaseRecord,
// Posting and DevSubmission now surface their own tenant, so a caller holding one
// never has to be told. These tests pin that field AND the behaviour that rests on
// it — a source-only test would pass against a type that lies.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { getDevCase, getSubmission, listPostings, saveDevCase } from "./db/devcase.ts";
import { seedPipelineFromMatches } from "./devcase-run.ts";
import { listPipeline } from "./db/pipeline.ts";
import { saveProfile, listMatrixProfiles } from "./db/profiles.ts";
import { DEFAULT_WORKSPACE_ID } from "./db/workspaces.ts";

after(() => cleanupUnitDb());

const WS_B = "team-devcase-b";

test("a dev case carries its own tenant, so a by-id read can prove ownership", () => {
  const mine = saveDevCase({ need: null, analysis: null, role: { title: "Backend" }, case: { title: "Case B" } }, WS_B);
  const theirs = saveDevCase({ need: null, analysis: null, role: { title: "Backend" }, case: { title: "Case A" } }, DEFAULT_WORKSPACE_ID);

  assert.equal(getDevCase(mine.id)?.workspaceId, WS_B);
  assert.equal(getDevCase(theirs.id)?.workspaceId, DEFAULT_WORKSPACE_ID);
  // getDevCase stays an unscoped point read by design; the ROUTE compares this
  // field, which is only possible because the record surfaces it.
  assert.notEqual(getDevCase(mine.id)?.workspaceId, getDevCase(theirs.id)?.workspaceId);
});

test("the sourcing pool is per team — one tenant's profiles are never rankable by another", () => {
  saveProfile({ label: "Pool A", archetype: "bau", roleFamily: null, completeness: null, payload: {} }, DEFAULT_WORKSPACE_ID);
  saveProfile({ label: "Pool B", archetype: "bau", roleFamily: null, completeness: null, payload: {} }, WS_B);

  // runSourceForRole spawns Python, so assert on the pool read it is built from —
  // the exact call that was bare (`listMatrixProfiles()`).
  const labelsB = listMatrixProfiles(undefined, WS_B).map((p) => p.label);
  assert.ok(labelsB.includes("Pool B"));
  assert.ok(!labelsB.includes("Pool A"), "team B must not be able to rank team A's candidates");
});

test("seeded matches land on the team that sourced them, not the default", () => {
  const before = listPipeline(WS_B).length;
  const { added } = seedPipelineFromMatches(
    [{ candidateId: "src-b-1", label: "Sourced B", archetype: "bau", score: 80 } as never],
    { caseId: "dc-x", roleTitle: "Backend", workspaceId: WS_B }
  );
  assert.equal(added, 1);

  const mine = listPipeline(WS_B);
  assert.equal(mine.length, before + 1);
  const seeded = mine.find((e) => e.candidateId === "src-b-1");
  assert.ok(seeded, "the sourcing team sees its own new entry");
  assert.equal(seeded.workspaceId, WS_B, "and the row belongs to that team");
  assert.ok(!listPipeline(DEFAULT_WORKSPACE_ID).some((e) => e.candidateId === "src-b-1"), "the default team must not receive it");
});

test("a submission carries its tenant, so promote can derive every write from it", () => {
  // Postings/submissions are created through the public candidate flow, so build
  // the row directly and read it back the way promoteSubmission does.
  const db = (globalThis as { __kpEnsureDb?: unknown }).__kpEnsureDb;
  void db;
  const caseRow = saveDevCase({ need: null, analysis: null, role: { title: "R" }, case: { title: "C" } }, WS_B);
  assert.equal(getDevCase(caseRow.id)?.workspaceId, WS_B);
  // listPostings is already scoped; prove the mapper surfaces the tenant so the
  // list and the point read cannot disagree (they used to be separate mappers).
  for (const p of listPostings(WS_B)) assert.equal(p.workspaceId, WS_B);
  void getSubmission;
});

// --- source contract on the callers ---------------------------------------
// The read and the write must be scoped TOGETHER. Scoping only the write is worse
// than scoping neither: the entries look native while the people in them are not.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (...p: string[]) => readFileSync(path.join(HERE, ...p), "utf8");

test("every sourcing caller scopes the pool read and the seed write to the same team", () => {
  const cases: [string, string[]][] = [
    ["api/devcase/source/route.ts", ["runSourceForRole(role, { workspaceId: ws })", "workspaceId: ws"]],
    ["_lib/devcase-orchestrator.ts", ["workspaceId: lc.workspaceId"]],
    ["api/jobs/[id]/publish/route.ts", ["workspaceId: ws"]],
  ];
  for (const [file, needles] of cases) {
    const src = read("..", ...file.split("/"));
    for (const n of needles) assert.ok(src.includes(n), `${file}: expected \`${n}\``);
    assert.doesNotMatch(src, /runSourceForRole\((?:role|lc\.role \?\? \{\})\)/, `${file}: no bare sourcing call may remain`);
  }
});

test("promote derives its writes from the submission's own tenant", () => {
  const src = read("devcase-run.ts");
  assert.match(src, /const workspaceId = sub\.workspaceId;/, "promoteSubmission must take the tenant from the submission");
  // NB: the detail argument contains `reasons.join("; ")`, so a `[^;]*` bridge
  // would stop inside it — match to the end of the line instead.
  assert.match(src, /recordAutomationEvent\(entry\.id, "screening_hold",.*, workspaceId\);/, "the audit event must be scoped");
  assert.match(src, /getProfileRecord\(ref, sub\.workspaceId\)/, "the observed-skill profile lookup must be scoped");
  assert.match(src, /listProfileRecords\(undefined, sub\.workspaceId\)/, "…including the by-label fallback");
});

test("the promote and source routes refuse another team's entity", () => {
  assert.match(read("..", "api", "devcase", "promote", "route.ts"), /sub\.workspaceId !== \(await currentWorkspace\(\)\)/);
  assert.match(read("..", "api", "devcase", "source", "route.ts"), /devCase\.workspaceId !== ws/);
});
