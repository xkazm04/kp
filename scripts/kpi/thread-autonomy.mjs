#!/usr/bin/env node
// THE METER for goal 1, "one role runs end to end without a human step": the per-role
// thread-autonomy reading the board's pipeline events give, one line per role.
//
//   node --import ./scripts/test-alias-loader.mjs --experimental-transform-types --disable-warning=ExperimentalWarning scripts/kpi/thread-autonomy.mjs [--json]
//
//   --json              the whole ThreadAutonomyReport plus { source: { db } } — the record a KPI writer stores
//   --window <days>     how far back to read (default 30; the read clamps it to 1..365)
//   --workspace <id>    which workspace's board (default: the default workspace)
//
// It reads app/_lib/db/thread-autonomy.ts (listThreadAutonomyByJob), which is also what the
// unit gate runs, so the meter and the gate cannot disagree about what a human step is.
//
// READ-ONLY, AND IT MEANS IT. The source database is resolved as KP_DB_PATH, else
// data/kp.sqlite, and is NEVER opened through ensureDb(): that runs the migrator, so a
// reading would write to the install it measures. The file (plus any -wal/-shm beside it) is
// copied to a fresh temp directory, KP_DB_PATH is pointed at the copy BEFORE anything under
// app/_lib/db is imported, and the copy is deleted when the read is done. If a migration
// needs to run it runs on the copy.
//
// WHAT IT WILL NOT DO IS ROUND AN EMPTY DENOMINATOR TO A NUMBER. No database, or a window
// with no role that has an event, prints "not measured" — never 0% and never 100%.
//
// "ZERO HUMAN STEPS" below means a role that reached at least one rung, whose firstHumanStage
// is null and whose unknownEvents is 0: an unattributable event is never counted as autonomous
// (thread-autonomy.ts), and a role with nothing placed on the ladder proves nothing.
// `truncated` means the window holds more events than the read's cap, so the figures cover
// only the OLDEST events and are not the whole window.
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const asJson = args.includes("--json");

function flagValue(name) {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const value = args[i + 1];
  if (value === undefined || value.startsWith("--")) {
    console.error(`${name} needs a value`);
    process.exit(2);
  }
  return value;
}

const windowArg = flagValue("--window");
const windowDays = windowArg === undefined ? 30 : Number(windowArg);
if (!Number.isFinite(windowDays) || windowDays < 1) {
  console.error(`--window must be a number of days, 1 or more (got "${windowArg}")`);
  process.exit(2);
}
const workspaceId = flagValue("--workspace");

const sourceDb = path.resolve(process.env.KP_DB_PATH ?? path.join(REPO_ROOT, "data", "kp.sqlite"));

if (!existsSync(sourceDb)) {
  if (asJson) {
    console.log(JSON.stringify({ measured: false, note: "not measured (no database)", source: { db: null } }, null, 2));
  } else {
    console.log("not measured (no database)");
  }
  process.exit(0);
}

const scratch = mkdtempSync(path.join(tmpdir(), "kp-thread-autonomy-"));
let report;
try {
  const copy = path.join(scratch, "kp.sqlite");
  for (const suffix of ["", "-wal", "-shm"]) {
    if (existsSync(sourceDb + suffix)) copyFileSync(sourceDb + suffix, copy + suffix);
  }
  // LOAD-BEARING ORDER: db-path computes its path from KP_DB_PATH when it is first evaluated.
  process.env.KP_DB_PATH = copy;
  const { listThreadAutonomyByJob } = await import("@/app/_lib/db/thread-autonomy");
  try {
    report = listThreadAutonomyByJob({ workspaceId, windowDays });
  } finally {
    // Windows will not delete a file a live handle still holds.
    try {
      globalThis.__kpDb?.close();
    } catch {
      /* already closed */
    }
  }
} finally {
  try {
    rmSync(scratch, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    /* best-effort: it is a scratch copy in the OS temp dir, the OS reclaims it */
  }
}

if (asJson) {
  console.log(JSON.stringify({ ...report, source: { db: sourceDb } }, null, 2));
  process.exit(0);
}

const rel = path.relative(REPO_ROOT, sourceDb);
console.log("Thread autonomy — one role runs end to end without a human step");
console.log(`  source: ${rel.startsWith("..") ? sourceDb : rel} (read from a copy)`);
console.log(`  workspace: ${report.workspaceId} · window: ${report.since} .. ${report.until} (${windowDays}d)`);

if (report.truncated) {
  console.log("  !! TRUNCATED: the window holds more events than the read's cap. These figures cover only the OLDEST events — do not read them as the whole window.");
}

if (report.jobs.length === 0) {
  console.log("  not measured (0 roles with events)");
} else {
  for (const job of report.jobs) {
    const human = job.firstHumanStage ? `first human: ${job.firstHumanStage} (${job.firstHumanKind})` : "no human step";
    console.log(
      `  ${job.jobTitle ?? "(untitled)"} [${job.jobId}]  events ${job.events} · rungs ${job.stagesAutonomous}/${job.stagesReached} autonomous · ${human}` +
        ` · candidate ${job.candidateEvents} · unknown ${job.unknownEvents} · unplaced ${job.unplacedEvents}`
    );
  }
  const zero = report.jobs.filter((j) => j.stagesReached > 0 && j.firstHumanStage === null && j.unknownEvents === 0).length;
  console.log(`  ${zero} of ${report.jobs.length} roles ran with zero human steps${report.truncated ? " (over the oldest events only)" : ""}`);
}
