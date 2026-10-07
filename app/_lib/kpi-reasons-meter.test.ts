// `npm run kpi:reasons` against a database the APP built. The meter's own fixtures used to
// hand-write their tables, so a column the app never had (analyses.id, decision_records.id)
// passed every test and crashed on every real install. This one builds the schema through
// ensureDb() / the decision store and writes rows through their writers — a Match add goes
// through POST /api/pipeline, which seals its verdict (ADR 0018) — so the meter's SELECTs
// are checked against the columns that actually exist.
//
// unit-db.ts MUST be the first project import (it points KP_DB_PATH at a throwaway file).
import "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { UNIT_DB_PATH, cleanupUnitDb } from "./testing/unit-db.ts";
import { ensureDb } from "./db/core.ts";
import { saveAnalysis } from "./db/analyses.ts";
import { createPipelineEntry, getPipelineEntry } from "./db/pipeline.ts";
import { sealDecisionRecord } from "./decision-record-store.ts";
import { recordMatchRun } from "./db/match-runs.ts";
import { DEFAULT_WORKSPACE_ID } from "./db/workspaces.ts";
import { POST as addToBoard } from "../api/pipeline/route.ts";
import { POST as actOnEntry } from "../api/pipeline/[id]/route.ts";

after(() => cleanupUnitDb());

type Arm = { checked: number; withReasons: number };
type MeterOut = {
  byKind: { rejection: Arm };
  rankingBySource: { analysis: Arm; match: Arm };
  legacyMatch: { legacy_prose_snapshot: number; legacy_snapshot_cleared: number };
  total: Arm;
};

/** Spawn the meter exactly as `npm run kpi:reasons` does, against this test's database. */
function runMeter(): MeterOut {
  // Release our handle so the child reads a settled file (the isolated store has no close
  // API); ensureDb() reopens on the next write.
  const holder = globalThis as typeof globalThis & { __kpDb?: { close(): void } };
  try {
    holder.__kpDb?.close();
  } catch {
    /* already closed */
  }
  holder.__kpDb = undefined;
  const root = path.resolve(import.meta.dirname, "..", "..");
  const r = spawnSync(
    process.execPath,
    ["--import", "./scripts/test-alias-loader.mjs", "--experimental-transform-types", "--disable-warning=ExperimentalWarning", "scripts/kpi/reasons-coverage.mjs", "--json"],
    { cwd: root, env: { ...process.env, KP_DB_PATH: UNIT_DB_PATH }, encoding: "utf8" }
  );
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout) as MeterOut;
}

const FACTS = {
  fitTier: "strong",
  best: { labelCode: "skills", percent: 82 },
  worst: { labelCode: "career", percent: 40 },
  matched: ["Java"],
  unproven: [],
  missing: ["Rust"],
  matchScore: 71,
  scorerVersion: "match-scorer.v1",
};

/** A Match add through the real door: facts in, verdict sealed, entry filed. */
async function matchAdd(candidateId: string, jobId: string): Promise<string> {
  const matchRunId = recordMatchRun({ workspaceId: DEFAULT_WORKSPACE_ID, candidateId, weights: null, results: [{ jobId, facts: FACTS as never }] });
  const res = await addToBoard(
    new NextRequest("http://localhost/api/pipeline", {
      method: "POST",
      body: JSON.stringify({ candidateId, candidateLabel: candidateId, jobId, jobTitle: "Engineer", source: "match", approvalKind: "decision", matchScore: 71, matchFacts: FACTS, matchRunId }),
      headers: { "content-type": "application/json" },
    })
  );
  assert.equal(res.status, 200);
  return ((await res.json()) as { entry: { id: string } }).entry.id;
}

/** A Match add filed before ADR 0018: an entry with no record, its slot as it was left. */
function legacyMatchEntry(candidateId: string, approvalDetail: string | null): string {
  const id = createPipelineEntry({ candidateId, candidateLabel: candidateId, jobId: `${candidateId}-job`, jobTitle: "Engineer", sourceChannel: "match" }).entry.id;
  ensureDb().prepare(`UPDATE pipeline_entries SET approval_detail = ? WHERE id = ?`).run(approvalDetail, id);
  return id;
}

test("the reasons meter reads a real install schema: analyses by slug, match entries, decision_records by seq", () => {
  ensureDb();
  // A fresh install self-seeds the demo corpus, so count the DELTA this test adds.
  const before = runMeter();
  saveAnalysis({
    candidateLabel: "Ada",
    jdSlug: null,
    score: 80,
    roleFamily: null,
    seniority: null,
    payload: { explanation: "Strong Go evidence.", trustFindings: [] },
  });
  const legacy = legacyMatchEntry("cand-1", JSON.stringify({ summary: "Strong fit.", strengths: [], redFlags: [] }));
  sealDecisionRecord({
    kind: "rejected",
    actor: "human:recruiter",
    policyVersion: "test",
    candidateRef: legacy,
    rationale: "Does not meet the bar.",
    reasonCode: "reject",
    inputs: {},
  });
  const after_ = runMeter();
  assert.equal(after_.rankingBySource.analysis.checked, before.rankingBySource.analysis.checked + 1, "analysis arm counts the saved analysis");
  assert.equal(after_.legacyMatch.legacy_prose_snapshot, before.legacyMatch.legacy_prose_snapshot + 1, "the pre-seal match entry is bucketed");
  assert.equal(after_.rankingBySource.match.checked, before.rankingBySource.match.checked, "…and not counted in the match arm");
  assert.equal(after_.byKind.rejection.checked, before.byKind.rejection.checked + 1, "rejection arm counts the sealed record");
});

test("a sealed Match add is counted as explained; legacy rows land in their two buckets and stay out of the headline", async () => {
  const before = runMeter();
  await matchAdd("cand-sealed", "job-sealed");
  legacyMatchEntry("cand-prose", JSON.stringify({ summary: "Promising fit.", strengths: ["SQL"], redFlags: [] }));
  legacyMatchEntry("cand-cleared", null);
  const after_ = runMeter();
  assert.equal(after_.rankingBySource.match.checked, before.rankingBySource.match.checked + 1, "only the sealed add enters the arm");
  assert.equal(after_.rankingBySource.match.withReasons, before.rankingBySource.match.withReasons + 1, "and it resolves");
  assert.equal(after_.legacyMatch.legacy_prose_snapshot, before.legacyMatch.legacy_prose_snapshot + 1);
  assert.equal(after_.legacyMatch.legacy_snapshot_cleared, before.legacyMatch.legacy_snapshot_cleared + 1);
  assert.equal(after_.total.checked, before.total.checked + 1, "the headline grew by the sealed add alone");
});

test("add -> accept -> the meter still counts the entry as explained after the accept clears the gate slot", async () => {
  const id = await matchAdd("cand-accept", "job-accept");
  const mid = runMeter();
  const res = await actOnEntry(
    new NextRequest(`http://localhost/api/pipeline/${id}`, {
      method: "POST",
      body: JSON.stringify({ action: "accept", expectedStage: "Screened" }),
      headers: { "content-type": "application/json" },
    }),
    { params: Promise.resolve({ id }) }
  );
  assert.equal(res.status, 200);
  const moved = getPipelineEntry(id)!;
  assert.notEqual(moved.stage, "Screened", "the accept advanced the entry");
  assert.equal(moved.approvalKind, null, "the accept cleared the gate");
  assert.equal(moved.approvalDetail, null);
  const after_ = runMeter();
  assert.equal(after_.rankingBySource.match.checked, mid.rankingBySource.match.checked, "still the same one entry");
  assert.equal(after_.rankingBySource.match.withReasons, mid.rankingBySource.match.withReasons, "still explained — the record outlives the slot");
  assert.equal(after_.legacyMatch.legacy_snapshot_cleared, mid.legacyMatch.legacy_snapshot_cleared, "and never re-filed as legacy");
});
