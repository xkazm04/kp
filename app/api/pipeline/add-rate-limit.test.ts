// POST /api/pipeline spends a per-workspace, per-IP window before its first write
// (2026-10-07 pipeline write-doors scan). rate-limit-contract.test.ts pins the call
// site and drives the limiter's arithmetic; this file drives the REAL handler, so a
// spent window is proven to refuse the add with the one registered refusal and to
// file nothing — no entry, no event, no sealed verdict — while a request that could
// never file keeps its own coded refusal.
//
// Its own file (own process): it fills the module's in-process limiter.
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
import { listDecisionRecords } from "../../_lib/decision-record-store.ts";
import { rateLimit, SHARED_CLIENT_KEY } from "../../_lib/rate-limit.ts";
import { recordMatchRun } from "../../_lib/db/match-runs.ts";

after(() => cleanupUnitDb());

const LIMIT = { limit: 600, windowMs: 10 * 60_000 };
const ADD = {
  candidateId: "arl-c1",
  candidateLabel: "Rate Limited Add",
  jobId: "arl-job-1",
  jobTitle: "Data Analyst",
  source: "match",
  approvalKind: "decision",
  matchScore: 64,
  matchFacts: {
    fitTier: "promising",
    best: { labelCode: "foundation", percent: 77 },
    worst: { labelCode: "fit", percent: 51 },
    matched: ["SQL"],
    unproven: [],
    missing: ["Spark"],
    matchScore: 64,
    scorerVersion: "match-scorer.v1",
  },
};
// A Match add names the stored result it was ranked from; the throttle is spent before that check.
(ADD as Record<string, unknown>).matchRunId = recordMatchRun({
  workspaceId: DEFAULT_WORKSPACE_ID,
  candidateId: ADD.candidateId,
  weights: null,
  results: [{ jobId: ADD.jobId, facts: ADD.matchFacts as never }],
});
const ENTRY_ID = `m-${ADD.candidateId}-${ADD.jobId}`;
const post = (body: unknown) =>
  POST(new NextRequest("http://localhost/api/pipeline", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));

test("a spent window refuses the add with TOO_MANY_REQUESTS and files nothing", async () => {
  // No trusted proxy in the unit runner, so every caller resolves to the shared key.
  const key = `pipeline-add:${DEFAULT_WORKSPACE_ID}:${SHARED_CLIENT_KEY}`;
  for (let i = 0; i < LIMIT.limit; i++) assert.equal(rateLimit(key, LIMIT), true, `hit ${i + 1} is admitted`);

  const res = await post(ADD);
  assert.equal(res.status, 429);
  assert.equal((await res.json()).code, "TOO_MANY_REQUESTS");
  assert.equal(getPipelineEntry(ENTRY_ID), null, "no entry was inserted");
  assert.deepEqual(listPipelineEventsForEntry(ENTRY_ID), [], "no 'added' event either");
  assert.equal(listDecisionRecords({ candidateRef: ENTRY_ID }).length, 0, "and no verdict was sealed");
});

test("a request that could never file keeps its own refusal ahead of the throttle", async () => {
  const res = await post({ candidateLabel: "no ids" });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, "PIPELINE_ADD_IDS_REQUIRED");
});

