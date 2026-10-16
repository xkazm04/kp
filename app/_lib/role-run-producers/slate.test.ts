// S1 producer: the board plus the role's silver medalists, under SLATE_CAP, with the
// consent gate asked before any board entry is written. The ranker is an injected
// stand-in; consent is the REAL predicate over real (anonymized) rows.
import "better-sqlite3";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { ensureDb } from "../db/core.ts";
import { SLATE_CAP, advanceRoleRun } from "../role-run-engine.ts";
import { getOrCreateRoleRun, latestStageArtifact } from "../db/role-runs.ts";
import { insertJob } from "../job-ingest.ts";
import { anonymizeEntry, createPipelineEntry, listEntriesForJob } from "../db/pipeline.ts";
import type { JobRecord } from "../db/core.ts";
import type { SlatePayload } from "../role-run-stages.ts";
import type { RediscoverResult, Rediscovered } from "../rediscover.ts";
import { producerRunners } from "./index.ts";
import { slateProducer } from "./slate.ts";

before(() => {
  ensureDb();
  for (const id of ["jd-sl-a", "jd-sl-b", "jd-sl-c", "jd-sl-d", "jd-sl-other"]) {
    insertJob({ id, title: "Engineer", requirements: [{ skill: "java", kind: "skill", hardness: "must" }] } as unknown as JobRecord, undefined, "published");
  }
});
after(() => cleanupUnitDb());

const found = (rs: Rediscovered[], over: Partial<RediscoverResult> = {}): RediscoverResult => ({
  rediscovered: rs,
  skipped: [],
  more: 0,
  suppressed: 0,
  poolTruncated: false,
  evaluated: [],
  withheld: [],
  ...over,
});
const medalist = (candidateId: string): Rediscovered => ({
  candidateId,
  label: `Name of ${candidateId}`,
  archetype: "bau",
  score: 81,
  prior: { kind: "rejected", label: "Rejected · Other Role", stage: "Interview", depth: 2 },
});
const slateOf = (runId: string) => latestStageArtifact(runId, "slate", null)?.payload as SlatePayload;
const advance = (runId: string, deps: Parameters<typeof slateProducer>[0]) =>
  advanceRoleRun(runId, { maxStages: 2, runners: producerRunners([slateProducer(deps)], { llmAvailable: () => false }) });
const board = (jobId: string, candidateId: string, sourceChannel?: string) =>
  createPipelineEntry({ candidateId, candidateLabel: `Board ${candidateId}`, jobId, jobTitle: "Engineer", sourceChannel }).entry;

test("board entries first, then rediscovered silver medalists with their origin and a non-identifying prior ref", async () => {
  const inbound = board("jd-sl-a", "c-in", "apply");
  const pooled = board("jd-sl-a", "c-pool");
  const { run } = getOrCreateRoleRun({ jobId: "jd-sl-a" });
  await advance(run.id, { rediscover: async () => found([medalist("c-silver")]) });
  const slate = slateOf(run.id);
  assert.deepEqual(slate.candidates.slice(0, 2).map((c) => [c.candidateRef, c.origin]), [[inbound.id, "inbound"], [pooled.id, "pool"]]);
  const third = slate.candidates[2];
  assert.equal(third.origin, "rediscovery");
  assert.equal(third.priorOutcomeRef, "prior:rejected:Interview");
  assert.ok(listEntriesForJob("jd-sl-a").some((e) => e.id === third.candidateRef && e.candidateId === "c-silver"), "the branch is a real board entry");
  assert.equal(slate.truncated, false);
});

test("consent: a withheld candidate is never put on the slate and never gets a board entry", async () => {
  // c-erased was erased (Art. 17) on an entry under ANOTHER role; the real predicate withholds them.
  const old = board("jd-sl-other", "c-erased");
  anonymizeEntry(old.id, "erasure");
  const { run } = getOrCreateRoleRun({ jobId: "jd-sl-b" });
  await advance(run.id, { rediscover: async () => found([medalist("c-erased"), medalist("c-fine")]) });
  const slate = slateOf(run.id);
  const people = listEntriesForJob("jd-sl-b").map((e) => e.candidateId);
  assert.deepEqual(people, ["c-fine"]);
  assert.equal(slate.candidates.length, 1);
  assert.equal(JSON.stringify(slate).includes("c-erased"), false);
});

test("a candidate the team already has an entry for under this role is not rediscovered or revived", async () => {
  const existing = board("jd-sl-c", "c-declined");
  ensureDb().prepare(`UPDATE pipeline_entries SET status = ? WHERE id = ?`).run("declined", existing.id);
  const { run } = getOrCreateRoleRun({ jobId: "jd-sl-c" });
  await advance(run.id, { rediscover: async () => found([medalist("c-declined")]) });
  const entries = listEntriesForJob("jd-sl-c");
  assert.equal(entries.length, 1);
  assert.equal(entries[0].status, "declined", "no re-add transition");
  assert.equal(slateOf(run.id).candidates.filter((c) => c.origin === "rediscovery").length, 0);
});

test("SLATE_CAP holds: board entries keep their place, rediscovery fills the rest, truncated says so", async () => {
  for (let i = 0; i < SLATE_CAP - 1; i++) board("jd-sl-d", `c-board-${i}`);
  const { run } = getOrCreateRoleRun({ jobId: "jd-sl-d" });
  await advance(run.id, { rediscover: async () => found([medalist("m-1"), medalist("m-2"), medalist("m-3")]) });
  const slate = slateOf(run.id);
  assert.equal(slate.candidates.length, SLATE_CAP);
  assert.equal(slate.candidates.filter((c) => c.origin === "rediscovery").length, 1);
  assert.equal(slate.truncated, true);
  assert.equal(listEntriesForJob("jd-sl-d").length, SLATE_CAP, "no entry is minted for a candidate the cap cut");
});

test("a failing ranker still yields the board slate", async () => {
  const { run } = getOrCreateRoleRun({ jobId: "jd-sl-a", cycle: "2" });
  await advance(run.id, { rediscover: async () => { throw new Error("recruiter_cli died"); } });
  assert.ok(slateOf(run.id).candidates.length >= 3);
});
