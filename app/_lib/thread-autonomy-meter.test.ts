// Real native better-sqlite3 first: the seed below runs the app's own migrations (ensureDb)
// and writes through recordEvent, never an inline CREATE TABLE copy.
import "better-sqlite3";
// IMPORT ORDER IS LOAD-BEARING: unit-db sets KP_DB_PATH before anything touches db-path.
import { cleanupUnitDb, UNIT_DB_DIR, UNIT_DB_PATH } from "./testing/unit-db.ts";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureDb, recordEvent } from "./db/core.ts";
import { createPipelineEntry } from "./db/pipeline.ts";
import { DEFAULT_WORKSPACE_ID } from "./db/workspaces.ts";

// The committed meter for goal 1 (scripts/kpi/thread-autonomy.mjs), run as the child process
// an operator runs. What it must never do is open the SOURCE database through ensureDb():
// that runs migrations, so a read would write to the install it is measuring.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = path.join(REPO_ROOT, "scripts", "kpi", "thread-autonomy.mjs");

function runMeter(dbPath: string, ...args: string[]) {
  return spawnSync(
    process.execPath,
    [
      "--import",
      "./scripts/test-alias-loader.mjs",
      "--experimental-transform-types",
      "--disable-warning=ExperimentalWarning",
      SCRIPT,
      ...args,
    ],
    { cwd: REPO_ROOT, env: { ...process.env, KP_DB_PATH: dbPath }, encoding: "utf8", timeout: 120_000 }
  );
}

const JOB_ID = "job-meter";
const JOB_TITLE = "Meter Role";
let seededEvents = 0;

before(() => {
  const db = ensureDb();
  const entry = createPipelineEntry({
    candidateId: "meter-c1",
    candidateLabel: "Meter Candidate",
    jobId: JOB_ID,
    jobTitle: JOB_TITLE,
    workspaceId: DEFAULT_WORKSPACE_ID,
  }).entry;
  const at = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
  recordEvent(db, { entryId: entry.id, jobTitle: JOB_TITLE, kind: "matched", actor: "auto:matcher", toStage: "Accepted", createdAt: at(30) });
  recordEvent(db, { entryId: entry.id, jobTitle: JOB_TITLE, kind: "scored", actor: "auto:screen-wave", toStage: "Screened", createdAt: at(29) });
  recordEvent(db, { entryId: entry.id, jobTitle: JOB_TITLE, kind: "advanced", actor: "human:recruiter", toStage: "Interview", createdAt: at(28) });
  // createPipelineEntry records its own "added" event, so the expected count is read back
  // from the table instead of being hard-coded to the three events written above.
  seededEvents = (db.prepare(`SELECT COUNT(*) AS n FROM pipeline_events WHERE entry_id = ?`).get(entry.id) as { n: number }).n;
  // Release the file so the source's bytes and mtime are settled before the meter runs.
  (globalThis as typeof globalThis & { __kpDb?: { close(): void } }).__kpDb?.close();
});
after(() => cleanupUnitDb());

test("the meter reads one row for the seeded job with its event count", () => {
  const res = runMeter(UNIT_DB_PATH as string, "--json");
  assert.equal(res.status, 0, res.stderr);
  const report = JSON.parse(res.stdout);
  assert.equal(report.workspaceId, DEFAULT_WORKSPACE_ID);
  assert.equal(report.truncated, false);
  const job = report.jobs.find((j: { jobId: string }) => j.jobId === JOB_ID);
  assert.ok(job, "NON-VACUITY: the seeded job must be in the report");
  assert.equal(job.jobTitle, JOB_TITLE);
  assert.ok(seededEvents >= 3, "NON-VACUITY: the three written events landed");
  assert.equal(job.events, seededEvents);
  assert.notEqual(job.firstHumanKind, null, "the human step is named, so the autonomy figures were really computed");
  assert.equal(report.source.db, UNIT_DB_PATH);
});

test("the meter does not touch the source database: bytes and mtime survive the run", () => {
  const before = { bytes: readFileSync(UNIT_DB_PATH as string), mtimeMs: statSync(UNIT_DB_PATH as string).mtimeMs };
  const res = runMeter(UNIT_DB_PATH as string, "--json");
  assert.equal(res.status, 0, res.stderr);
  assert.ok(JSON.parse(res.stdout).jobs.length > 0, "NON-VACUITY: it really read the file it is accused of touching");
  assert.ok(readFileSync(UNIT_DB_PATH as string).equals(before.bytes), "source bytes changed — a migration ran on the install being measured");
  assert.equal(statSync(UNIT_DB_PATH as string).mtimeMs, before.mtimeMs);
});

test("human output names the job and a headline; the window flag is honoured", () => {
  const res = runMeter(UNIT_DB_PATH as string);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /Meter Role/);
  assert.match(res.stdout, /\d+ of \d+ roles ran with zero human steps/);
  const empty = runMeter(UNIT_DB_PATH as string, "--window", "1", "--workspace", "no-such-team");
  assert.equal(empty.status, 0, empty.stderr);
  assert.match(empty.stdout, /not measured \(0 roles with events\)/);
  assert.doesNotMatch(empty.stdout, /\b0%|\b100%/);
});

test("a missing database is 'not measured', exit 0", () => {
  const res = runMeter(path.join(UNIT_DB_DIR, "does-not-exist.sqlite"));
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /not measured \(no database\)/);
});
