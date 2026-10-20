// The producer seam: which runner a stage gets. Nothing here spawns a CLI - producers are
// injected stand-ins - and the seam must never turn a missing or failing provider into a
// crashed or half-written run.
import "better-sqlite3";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { ensureDb } from "../db/core.ts";
import { advanceRoleRun, type StageContext, type StageRunner } from "../role-run-engine.ts";
import { getOrCreateRoleRun, latestStageArtifact } from "../db/role-runs.ts";
import { insertJob } from "../job-ingest.ts";
import type { JobRecord } from "../db/core.ts";
import type { RoleSpecPayload } from "../role-run-stages.ts";
import { producerRunners, roleRunLlmAvailable, type RoleRunProducer } from "./index.ts";

before(() => {
  ensureDb();
  for (const [id, skill] of [["jd-prod-a", "java"], ["jd-prod-b", "java"], ["jd-prod-c", "java"], ["jd-prod-d", "sql"]]) {
    insertJob({ id, title: "Engineer", requirements: [{ skill, kind: "skill", hardness: "must" }] } as unknown as JobRecord, undefined, "published");
  }
});
after(() => cleanupUnitDb());

const real: StageRunner = (ctx: StageContext) => ({
  status: "complete",
  payload: { jobId: ctx.run.jobId, roleSpecHash: "from-producer", rubricVersion: "9", rubricKeys: ["x"], lintFindings: [] } satisfies RoleSpecPayload,
});
const producer = (over: Partial<RoleRunProducer> = {}): RoleRunProducer => ({ kind: "role_spec", usesLlm: true, run: real, ...over });
const specOf = (runId: string) => latestStageArtifact(runId, "role_spec", null)?.payload as RoleSpecPayload;

test("an available LLM producer's outcome is what the ledger records", async () => {
  const { run } = getOrCreateRoleRun({ jobId: "jd-prod-a" });
  await advanceRoleRun(run.id, { runners: producerRunners([producer()], { llmAvailable: () => true }) });
  assert.equal(specOf(run.id).roleSpecHash, "from-producer");
});

test("no provider: the keyless default runs and the producer is never called", async () => {
  const { run } = getOrCreateRoleRun({ jobId: "jd-prod-b" });
  let called = 0;
  await advanceRoleRun(run.id, {
    runners: producerRunners([producer({ run: (ctx) => { called++; return real(ctx); } })], { llmAvailable: () => false }),
  });
  assert.equal(called, 0);
  assert.notEqual(specOf(run.id).roleSpecHash, "from-producer");
  assert.deepEqual(specOf(run.id).rubricKeys, ["java"], "the keyless floor derived the rubric from the job");
});

test("a local (non-LLM) producer runs even with no provider", async () => {
  const { run } = getOrCreateRoleRun({ jobId: "jd-prod-c" });
  await advanceRoleRun(run.id, { runners: producerRunners([producer({ usesLlm: false })], { llmAvailable: () => false }) });
  assert.equal(specOf(run.id).roleSpecHash, "from-producer");
});

test("a producer that throws degrades to the keyless default for that stage; the run does not crash", async () => {
  const { run } = getOrCreateRoleRun({ jobId: "jd-prod-d" });
  const boom = producer({ run: () => { throw new Error("provider said: secret prompt text"); } });
  const result = await advanceRoleRun(run.id, { runners: producerRunners([boom], { llmAvailable: () => true }) });
  assert.ok(result.produced.some((p) => p.kind === "role_spec"));
  assert.deepEqual(specOf(run.id).rubricKeys, ["sql"]);
});

test("roleRunLlmAvailable: needs a provider, honours KP_OFFLINE and the KP_ROLE_RUN_LLM=0 switch", () => {
  const cli = () => ({ gemini: false, claudeCli: true });
  const none = () => ({ gemini: false, claudeCli: false });
  assert.equal(roleRunLlmAvailable({}, cli), true);
  assert.equal(roleRunLlmAvailable({}, () => ({ gemini: true, claudeCli: false })), true);
  assert.equal(roleRunLlmAvailable({}, none), false);
  assert.equal(roleRunLlmAvailable({ KP_OFFLINE: "1" }, cli), false);
  assert.equal(roleRunLlmAvailable({ KP_ROLE_RUN_LLM: "0" }, cli), false);
});
