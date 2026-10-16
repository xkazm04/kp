// S0 producer: reuse the job's own requirements when it has them; generate a rubric only
// when it has none. The JD builder is an injected stand-in - no CLI is spawned.
import "better-sqlite3";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { ensureDb } from "../db/core.ts";
import { advanceRoleRun } from "../role-run-engine.ts";
import { getOrCreateRoleRun, latestStageArtifact } from "../db/role-runs.ts";
import { insertJob } from "../job-ingest.ts";
import type { JobRecord } from "../db/core.ts";
import type { RoleSpecPayload } from "../role-run-stages.ts";
import { producerRunners } from "./index.ts";
import { roleSpecProducer, type JdBuildFn } from "./role-spec.ts";

before(() => {
  ensureDb();
  insertJob({ id: "jd-rs-stated", title: "Java Engineer", requirements: [{ skill: "Java", kind: "skill", hardness: "must" }] } as unknown as JobRecord, undefined, "published");
  insertJob({ id: "jd-rs-bare", title: "Platform Engineer", description: "We need someone to run our Kubernetes platform and on-call rota.", requirements: [] } as unknown as JobRecord, undefined, "published");
  insertJob({ id: "jd-rs-empty", title: "Mystery Role", description: "", requirements: [] } as unknown as JobRecord, undefined, "published");
});
after(() => cleanupUnitDb());

const specOf = (runId: string) => latestStageArtifact(runId, "role_spec", null)?.payload as RoleSpecPayload;
const advance = (runId: string, build: JdBuildFn) =>
  advanceRoleRun(runId, { runners: producerRunners([roleSpecProducer({ build })], { llmAvailable: () => true }) });

test("a job that already states requirements is NOT regenerated: its requirements are the rubric", async () => {
  const { run } = getOrCreateRoleRun({ jobId: "jd-rs-stated" });
  let calls = 0;
  await advance(run.id, async () => { calls++; return {}; });
  assert.equal(calls, 0, "no model call when the JD already carries its rubric");
  assert.deepEqual(specOf(run.id).rubricKeys, ["java"]);
  assert.deepEqual(specOf(run.id).lintFindings, []);
});

test("a job with no requirements but a description gets a generated rubric, stated as generated", async () => {
  const { run } = getOrCreateRoleRun({ jobId: "jd-rs-bare" });
  let seen: Record<string, unknown> = {};
  await advance(run.id, async (params) => {
    seen = params;
    return { role: { title: "Platform Engineer", seniority: "medior", roleFamily: "sre", mustHaves: ["Kubernetes", "On Call"], niceToHaves: [], responsibilities: [], languages: [], promptVersion: "t" } };
  });
  const spec = specOf(run.id);
  assert.deepEqual(spec.rubricKeys, ["kubernetes", "on_call"]);
  assert.deepEqual(spec.lintFindings, ["rubric_generated_from_description"]);
  assert.equal(seen.jdSlug, undefined, "nothing is persisted as a JD");
  assert.deepEqual(seen.options, { description: true, marketResearch: false, caseDesign: false }, "only the rubric is paid for");
});

test("a model that returns no must-haves leaves the honest no_graded_requirements finding", async () => {
  const { run } = getOrCreateRoleRun({ jobId: "jd-rs-bare" , cycle: "2" });
  await advance(run.id, async () => ({ role: {} }));
  assert.deepEqual(specOf(run.id).lintFindings, ["rubric_generated_from_description", "no_graded_requirements"]);
});

test("too little text to design from: the keyless floor answers and the model is never asked", async () => {
  const { run } = getOrCreateRoleRun({ jobId: "jd-rs-empty" });
  let calls = 0;
  await advance(run.id, async () => { calls++; return {}; });
  assert.equal(calls, 0);
  assert.deepEqual(specOf(run.id).lintFindings, ["no_graded_requirements"]);
});

test("a failing build degrades to the keyless floor instead of crashing the run", async () => {
  const { run } = getOrCreateRoleRun({ jobId: "jd-rs-bare", cycle: "3" });
  const result = await advance(run.id, async () => { throw new Error("provider down"); });
  assert.ok(result.produced.some((p) => p.kind === "role_spec"));
  assert.deepEqual(specOf(run.id).lintFindings, ["no_graded_requirements"]);
});
