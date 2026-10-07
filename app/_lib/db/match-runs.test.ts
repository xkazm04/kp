// The stored Match results (db/match-runs.ts): what is held, for how long, and who can
// read it back. The add door's refusals are driven through the real handler in
// app/api/pipeline/match-add-provenance.test.ts; this pins the store beneath them.
//
// unit-db.ts MUST be the first project import.
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { ensureDb } from "./core.ts";
import { loadMatchRunFacts, matchWeightsHash, MATCH_RUN_TTL_MS, recordMatchRun } from "./match-runs.ts";
import type { MatchReasonFacts } from "../match-verdict.ts";

after(() => cleanupUnitDb());

const FACTS: MatchReasonFacts = {
  fitTier: "strong",
  best: { labelCode: "skills", percent: 82 },
  worst: { labelCode: "career", percent: 40 },
  matched: ["Java"],
  unproven: [],
  missing: ["Rust"],
  matchScore: 71,
  scorerVersion: "match-scorer.v1",
};
const ws = "default";
const rows = () => (ensureDb().prepare(`SELECT COUNT(*) AS n FROM match_run_results`).get() as { n: number }).n;

test("the TTL outlasts a working session of ranking and filing", () => {
  assert.ok(MATCH_RUN_TTL_MS >= 8 * 60 * 60 * 1000);
});

test("a recorded run reads back for its workspace, candidate and job — and only those", () => {
  const runId = recordMatchRun({ workspaceId: ws, candidateId: "c1", weights: null, results: [{ jobId: "j1", facts: FACTS }, { jobId: "j2", facts: FACTS }] });
  assert.deepEqual(loadMatchRunFacts({ workspaceId: ws, runId, candidateId: "c1", jobId: "j1" }), FACTS);
  assert.deepEqual(loadMatchRunFacts({ workspaceId: ws, runId, candidateId: "c1", jobId: "j2" }), FACTS);
  assert.equal(loadMatchRunFacts({ workspaceId: ws, runId, candidateId: "c1", jobId: "j3" }), null, "a role the run never ranked");
  assert.equal(loadMatchRunFacts({ workspaceId: ws, runId, candidateId: "c2", jobId: "j1" }), null, "another candidate");
  assert.equal(loadMatchRunFacts({ workspaceId: "other-team", runId, candidateId: "c1", jobId: "j1" }), null, "another workspace");
  assert.equal(loadMatchRunFacts({ workspaceId: ws, runId: "mr-nope", candidateId: "c1", jobId: "j1" }), null, "an unknown run");
});

test("a run expires at the TTL, and recording a later one drops the expired rows", () => {
  const t0 = new Date("2026-10-07T08:00:00Z");
  const old = recordMatchRun({ workspaceId: ws, candidateId: "c-exp", weights: null, results: [{ jobId: "j1", facts: FACTS }], now: t0 });
  const justBefore = new Date(t0.getTime() + MATCH_RUN_TTL_MS - 1000);
  const atExpiry = new Date(t0.getTime() + MATCH_RUN_TTL_MS);
  assert.deepEqual(loadMatchRunFacts({ workspaceId: ws, runId: old, candidateId: "c-exp", jobId: "j1", now: justBefore }), FACTS);
  assert.equal(loadMatchRunFacts({ workspaceId: ws, runId: old, candidateId: "c-exp", jobId: "j1", now: atExpiry }), null);
  const before = rows();
  recordMatchRun({ workspaceId: ws, candidateId: "c-exp2", weights: null, results: [{ jobId: "j1", facts: FACTS }], now: new Date(t0.getTime() + MATCH_RUN_TTL_MS + 1000) });
  assert.equal(rows(), before, "the expired row left as the new one arrived");
});

test("facts the strict coercer refuses are not stored", () => {
  const runId = recordMatchRun({
    workspaceId: ws,
    candidateId: "c-bad",
    weights: null,
    results: [{ jobId: "j-bad", facts: { ...FACTS, fitTier: "excellent" } as never }, { jobId: "j-ok", facts: FACTS }],
  });
  assert.equal(loadMatchRunFacts({ workspaceId: ws, runId, candidateId: "c-bad", jobId: "j-bad" }), null);
  assert.deepEqual(loadMatchRunFacts({ workspaceId: ws, runId, candidateId: "c-bad", jobId: "j-ok" }), FACTS);
});

test("the weights fingerprint ignores key order and separates baseline from an override", () => {
  assert.equal(matchWeightsHash({ skills: 60, career: 40 }), matchWeightsHash({ career: 40, skills: 60 }));
  assert.notEqual(matchWeightsHash({ skills: 60, career: 40 }), matchWeightsHash({ skills: 61, career: 39 }));
  assert.notEqual(matchWeightsHash(null), matchWeightsHash({ skills: 60 }));
});
