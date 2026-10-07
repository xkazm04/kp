// `npm run kpi:reasons` against a database the APP built. The meter's own fixtures used to
// hand-write their tables, so a column the app never had (analyses.id, decision_records.id)
// passed every test and crashed on every real install. This one builds the schema through
// ensureDb() / the decision store and writes rows through their writers, so the meter's
// SELECTs are checked against the columns that actually exist.
//
// unit-db.ts MUST be the first project import (it points KP_DB_PATH at a throwaway file).
import "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { UNIT_DB_PATH, cleanupUnitDb } from "./testing/unit-db.ts";
import { ensureDb } from "./db/core.ts";
import { saveAnalysis } from "./db/analyses.ts";
import { createPipelineEntry } from "./db/pipeline.ts";
import { sealDecisionRecord } from "./decision-record-store.ts";

after(() => cleanupUnitDb());

type Arm = { checked: number; withReasons: number };
type MeterOut = { byKind: { rejection: Arm }; rankingBySource: { analysis: Arm; match: Arm } };

/** Spawn the meter exactly as `npm run kpi:reasons` does, against this test's database. */
function runMeter(): MeterOut {
  const root = path.resolve(import.meta.dirname, "..", "..");
  const r = spawnSync(
    process.execPath,
    ["--import", "./scripts/test-alias-loader.mjs", "--experimental-transform-types", "--disable-warning=ExperimentalWarning", "scripts/kpi/reasons-coverage.mjs", "--json"],
    { cwd: root, env: { ...process.env, KP_DB_PATH: UNIT_DB_PATH }, encoding: "utf8" }
  );
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout) as MeterOut;
}

test("the reasons meter reads a real install schema: analyses by slug, match entries, decision_records by seq", () => {
  const holder = globalThis as typeof globalThis & { __kpDb?: { close(): void } };
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
  const filed = createPipelineEntry({
    candidateId: "cand-1",
    candidateLabel: "Grace",
    jobId: "job-1",
    jobTitle: "Engineer",
    sourceChannel: "match",
    approvalDetail: JSON.stringify({ summary: "Strong fit.", strengths: [], redFlags: [] }),
  });
  sealDecisionRecord({
    kind: "rejected",
    actor: "human:recruiter",
    policyVersion: "test",
    candidateRef: filed.entry.id,
    rationale: "Does not meet the bar.",
    reasonCode: "reject",
    inputs: {},
  });
  // Release our handle so the child reads a settled file (the isolated store has no close API).
  try {
    holder.__kpDb?.close();
  } catch {
    /* already closed */
  }
  holder.__kpDb = undefined;
  const after_ = runMeter();
  assert.equal(after_.rankingBySource.analysis.checked, before.rankingBySource.analysis.checked + 1, "analysis arm counts the saved analysis");
  assert.equal(after_.rankingBySource.match.checked, before.rankingBySource.match.checked + 1, "match arm counts the filed entry");
  assert.equal(after_.byKind.rejection.checked, before.byKind.rejection.checked + 1, "rejection arm counts the sealed record");
});
