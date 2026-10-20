// A Match add is checked against the result the SERVER holds (ADR 0018 amendment; pipeline
// write-doors scan, finding 1). POST /api/match records each result under a run id; the add
// door loads it and refuses, with a coded 409 BEFORE the seal and the insert, a Match add
// whose facts differ from it or whose run is missing, expired, foreign or for another
// candidate/role.
//
// Drives the REAL handler, the way add-rate-limit.test.ts does: every refusal is proven to
// leave no entry, no event and no sealed record, and the honest add is proven to file and
// seal exactly as before, with the run id now in the record's inputs.
//
// unit-db.ts MUST be the first project import (sets KP_DB_PATH before any store module
// resolves db-path.ts).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { POST } from "./route.ts";
import { getPipelineEntry, listPipelineEventsForEntry } from "../../_lib/db/pipeline.ts";
import { DEFAULT_WORKSPACE_ID } from "../../_lib/db/workspaces.ts";
import { MATCH_RUN_TTL_MS, recordMatchRun } from "../../_lib/db/match-runs.ts";
import { listDecisionRecords } from "../../_lib/decision-record-store.ts";
import { MATCH_VERDICT_KIND, type MatchReasonFacts } from "../../_lib/match-verdict.ts";

after(() => cleanupUnitDb());

const FACTS: MatchReasonFacts = {
  fitTier: "promising",
  best: { labelCode: "foundation", percent: 77 },
  worst: { labelCode: "fit", percent: 51 },
  matched: ["SQL"],
  unproven: ["dbt"],
  missing: ["Spark"],
  matchScore: 64,
  scorerVersion: "match-scorer.v1",
};
type Facts = MatchReasonFacts;

let seq = 0;
/** One candidate/role pair with a stored run holding FACTS; `send` posts a Match add. */
function scenario() {
  seq += 1;
  const candidateId = `map-c${seq}`;
  const jobId = `map-job-${seq}`;
  const runId = recordMatchRun({ workspaceId: DEFAULT_WORKSPACE_ID, candidateId, weights: null, results: [{ jobId, facts: FACTS }] });
  const body = (over: Record<string, unknown> = {}) => ({
    candidateId,
    candidateLabel: "Provenance Subject",
    jobId,
    jobTitle: "Data Analyst",
    source: "match",
    approvalKind: "decision",
    matchScore: FACTS.matchScore,
    matchFacts: FACTS,
    matchRunId: runId,
    ...over,
  });
  const entryId = `m-${candidateId}-${jobId}`;
  const send = (over: Record<string, unknown> = {}) =>
    POST(new NextRequest("http://localhost/api/pipeline", { method: "POST", body: JSON.stringify(body(over)), headers: { "content-type": "application/json" } }));
  return { candidateId, jobId, runId, entryId, body, send };
}

/** The refusal leaves nothing behind: no entry, no 'added' event, no sealed verdict. */
function assertNothingWritten(entryId: string, why: string) {
  assert.equal(getPipelineEntry(entryId), null, `${why}: no entry was inserted`);
  assert.deepEqual(listPipelineEventsForEntry(entryId), [], `${why}: no 'added' event`);
  assert.equal(listDecisionRecords({ candidateRef: entryId }).length, 0, `${why}: no sealed record`);
}

async function assertRefused(res: Response, code: string, entryId: string, why: string) {
  assert.equal(res.status, 409, why);
  assert.equal((await res.json()).code, code, why);
  assertNothingWritten(entryId, why);
}

test("a Match add with a valid matchRunId files and seals, the run id riding in the record's inputs", async () => {
  const s = scenario();
  const res = await s.send();
  assert.equal(res.status, 200);
  const { entry, created } = (await res.json()) as { entry: { id: string; approvalKind: string | null }; created: boolean };
  assert.equal(created, true);
  assert.equal(entry.id, s.entryId);
  assert.equal(entry.approvalKind, "decision");
  assert.equal(getPipelineEntry(s.entryId)!.matchScore, 64);
  const records = listDecisionRecords({ candidateRef: s.entryId }).filter((r) => r.kind === MATCH_VERDICT_KIND);
  assert.equal(records.length, 1);
  assert.equal(records[0].policyVersion, "match-scorer.v1");
  assert.deepEqual(JSON.parse(records[0].payloadJson).inputs, { ...FACTS, matchRunId: s.runId });
});

test("a tampered matchScore is refused with 409 and leaves nothing", async () => {
  const s = scenario();
  // The score is raised in BOTH places the add carries it, so only the stored run can catch it.
  await assertRefused(
    await s.send({ matchScore: 99, matchFacts: { ...FACTS, matchScore: 99 } }),
    "PIPELINE_ADD_MATCH_RUN_MISMATCH",
    s.entryId,
    "matchScore"
  );
});

test("a tampered fitTier is refused with 409 and leaves nothing", async () => {
  const s = scenario();
  await assertRefused(await s.send({ matchFacts: { ...FACTS, fitTier: "strong" } }), "PIPELINE_ADD_MATCH_RUN_MISMATCH", s.entryId, "fitTier");
});

test("a tampered scorerVersion is refused with 409 and leaves nothing", async () => {
  const s = scenario();
  await assertRefused(
    await s.send({ matchFacts: { ...FACTS, scorerVersion: "match-scorer.v9" } }),
    "PIPELINE_ADD_MATCH_RUN_MISMATCH",
    s.entryId,
    "scorerVersion"
  );
});

test("a tampered dimension or skill list is refused with 409 and leaves nothing", async () => {
  const variants: Record<string, Partial<Facts>> = {
    best: { best: { labelCode: "skills", percent: 99 } },
    worst: { worst: { labelCode: "fit", percent: 50 } },
    matched: { matched: ["SQL", "Kafka"] },
    unproven: { unproven: [] },
    missing: { missing: [] },
  };
  for (const [name, patch] of Object.entries(variants)) {
    const s = scenario();
    await assertRefused(await s.send({ matchFacts: { ...FACTS, ...patch } }), "PIPELINE_ADD_MATCH_RUN_MISMATCH", s.entryId, name);
  }
});

test("a missing, unknown or malformed matchRunId is refused with 409 and leaves nothing", async () => {
  for (const matchRunId of [undefined, null, "", "mr-not-a-run", 42, "../../etc/passwd"]) {
    const s = scenario();
    await assertRefused(await s.send({ matchRunId }), "PIPELINE_ADD_MATCH_RUN_UNKNOWN", s.entryId, `matchRunId ${JSON.stringify(matchRunId)}`);
  }
});

test("an expired run is refused with 409 and leaves nothing", async () => {
  const s = scenario();
  const stale = recordMatchRun({
    workspaceId: DEFAULT_WORKSPACE_ID,
    candidateId: s.candidateId,
    weights: null,
    results: [{ jobId: s.jobId, facts: FACTS }],
    now: new Date(Date.now() - MATCH_RUN_TTL_MS - 60_000),
  });
  await assertRefused(await s.send({ matchRunId: stale }), "PIPELINE_ADD_MATCH_RUN_UNKNOWN", s.entryId, "expired");
});

test("another workspace's run is refused with 409 and leaves nothing", async () => {
  const s = scenario();
  const foreign = recordMatchRun({ workspaceId: "other-team", candidateId: s.candidateId, weights: null, results: [{ jobId: s.jobId, facts: FACTS }] });
  await assertRefused(await s.send({ matchRunId: foreign }), "PIPELINE_ADD_MATCH_RUN_UNKNOWN", s.entryId, "foreign workspace");
});

test("a run for another candidate or another role is refused with 409 and leaves nothing", async () => {
  const s = scenario();
  const other = scenario();
  await assertRefused(await s.send({ matchRunId: other.runId }), "PIPELINE_ADD_MATCH_RUN_UNKNOWN", s.entryId, "other candidate and role");
  // Same candidate, a role the run never ranked.
  await assertRefused(await s.send({ jobId: "map-job-never-ranked" }), "PIPELINE_ADD_MATCH_RUN_UNKNOWN", `m-${s.candidateId}-map-job-never-ranked`, "unranked role");
  // Same role, a different person.
  await assertRefused(await s.send({ candidateId: "map-someone-else" }), "PIPELINE_ADD_MATCH_RUN_UNKNOWN", `m-map-someone-else-${s.jobId}`, "other candidate");
});

test("a refused add can be retried with the honest facts and then files", async () => {
  const s = scenario();
  await assertRefused(await s.send({ matchFacts: { ...FACTS, fitTier: "strong" } }), "PIPELINE_ADD_MATCH_RUN_MISMATCH", s.entryId, "first try");
  const res = await s.send();
  assert.equal(res.status, 200);
  assert.equal(listDecisionRecords({ candidateRef: s.entryId }).filter((r) => r.kind === MATCH_VERDICT_KIND).length, 1);
});
