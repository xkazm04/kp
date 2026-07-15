// feed-tells-why round-trip: pin that recordRediscoveryAlerts persists the prior's
// STAGE + DEPTH (the live {kind,label,stage,depth} shape) and listRediscoveryAlerts
// reads them back, so the standing feed can rebuild the same localized why-now the
// panel tells — AND that a legacy row (no stage/depth column value) reads back as
// null so the feed falls back to the persisted English label instead of fabricating
// a disclosure.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test, after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";

// Point every store connection at a throwaway DB BEFORE importing them: db-path reads
// KP_DB_PATH at module load. node --test isolates each file in its own process.
const TMP = path.join(os.tmpdir(), `kp-rediscovery-alert-story-${process.pid}.sqlite`);
process.env.KP_DB_PATH = TMP;

const { recordRediscoveryAlerts, listRediscoveryAlerts } = await import("./rediscovery-alert-store.ts");

after(() => {
  for (const f of [TMP, `${TMP}-wal`, `${TMP}-shm`]) {
    try {
      fs.rmSync(f, { force: true });
    } catch {
      /* file locked / absent — fine */
    }
  }
});

test("record + list round-trips the prior stage and depth", () => {
  const added = recordRediscoveryAlerts("jobA", "Alpha Role", [
    {
      candidateId: "cand-deep",
      label: "Deep Prior",
      archetype: "bau",
      score: 81,
      prior: { kind: "rejected", label: "Rejected · Beta Role", stage: "Interview", depth: 2 },
    },
  ]);
  assert.equal(added, 1);

  const [row] = listRediscoveryAlerts();
  assert.equal(row.prior.kind, "rejected");
  assert.equal(row.prior.stage, "Interview", "terminal stage is persisted for the depth disclosure");
  assert.equal(row.prior.depth, 2, "band-limited depth boost is persisted so the feed knows to disclose it");
  // The legacy English label survives as back-compat, but the feed prefers the story.
  assert.equal(row.prior.label, "Rejected · Beta Role");
});

test("a shallow prior (depth 0) still round-trips its stage", () => {
  recordRediscoveryAlerts("jobShallow", "Shallow Role", [
    {
      candidateId: "cand-shallow",
      label: "Shallow Prior",
      archetype: "bau",
      score: 60,
      prior: { kind: "elsewhere", label: "Applied · Other", stage: "Applied", depth: 0 },
    },
  ]);
  const row = listRediscoveryAlerts().find((a) => a.candidateId === "cand-shallow");
  assert.ok(row);
  assert.equal(row!.prior.stage, "Applied");
  assert.equal(row!.prior.depth, 0, "depth 0 is a real value (no disclosure), NOT null (legacy)");
});

test("a legacy row (no stage/depth written) reads back null so the feed falls back to the English label", () => {
  // Simulate a row persisted before the migration: insert directly over the same
  // kp.sqlite file WITHOUT the new columns, leaving prior_stage/prior_depth NULL.
  const d = new Database(TMP);
  d.prepare(
    `INSERT INTO rediscovery_alerts
       (id, job_id, job_title, candidate_id, candidate_label, archetype, score, prior_kind, prior_label, created_at, workspace_id)
     VALUES (@id, @jobId, @jobTitle, @candidateId, @label, @archetype, @score, @priorKind, @priorLabel, @createdAt, @workspaceId)`
  ).run({
    id: "ra-legacy",
    jobId: "jobLegacy",
    jobTitle: "Legacy Role",
    candidateId: "cand-legacy",
    label: "Legacy Prior",
    archetype: "bau",
    score: 70,
    priorKind: "closed",
    priorLabel: "Closed · Old Role",
    createdAt: new Date().toISOString(),
    workspaceId: "workspace",
  });
  d.close();

  const row = listRediscoveryAlerts().find((a) => a.candidateId === "cand-legacy");
  assert.ok(row, "legacy row is listed");
  assert.equal(row!.prior.stage, null, "legacy stage reads as null → feed falls back to the English label");
  assert.equal(row!.prior.depth, null, "legacy depth reads as null (not 0)");
  assert.equal(row!.prior.label, "Closed · Old Role");
});
