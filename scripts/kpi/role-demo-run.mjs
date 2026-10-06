#!/usr/bin/env node
// THE DEMO RUN for goal 1, "one role runs end to end without a human step": it starts a role
// run for a seeded job, walks it with the engine's DEFAULT stage runners until it stops, and
// reads where it stopped. The thread-autonomy meter reads events the board already holds; this
// is the instrument that PRODUCES a run to read, because no role has ever been run end to end
// outside a test.
//
//   node --import ./scripts/test-alias-loader.mjs --experimental-transform-types --disable-warning=ExperimentalWarning scripts/kpi/role-demo-run.mjs [--job <id>] [--json] [--approve-gates [--sim-interviews <n>] | --approve-all]
//
//   --job <id>          which job to run (default job-001)
//   --workspace <id>    which workspace's board (default: the default workspace)
//   --json              the whole record: the reading, every stage produced, coverage, dwell, source
//   --approve-gates     opt in: after each pass, a labelled stand-in ("demo-stand-in") carries out
//                       the engine's own recorded proposal at each parked gate — see below. The
//                       only mode whose reading can count for goal 1
//   --sim-interviews <n> with --approve-gates: how many approved-invite branches get a SIMULATED
//                       interview (default 2, hard ceiling 5; 0 turns it off) — see below
//   --approve-all       MECHANICS ONLY: the stand-in approves every parked branch with no policy.
//                       Reports the stages reached per branch; its goal-1 verdict is withheld,
//                       never "met"
//
// WHAT RUNS. getOrCreateRoleRun with a fresh cycle ("demo-<timestamp>", so an existing run is
// never resumed), then advanceRoleRun with DEFAULT_STAGE_RUNNERS and nothing else — no runner
// override, no stub — until a pass produces nothing, the run is no longer running, or 20 passes
// have gone by. The defaults are keyless and deterministic (role-run-engine.ts), so the reading
// is the engine's own floor: how far a role gets with no human and no provider. A branch that
// parks at a human gate (rejection, interview invite, offer) is the finding, not a failure.
//
// --approve-gates. The three Art. 22 gates are allowed steps for goal 1 (ADR-0011 amendment
// 2026-10-06), but a run that is never approved stops at the rejection gate and says nothing
// about stages 3 to 6. With the flag, the CHILD half — the temp copy, never the real database —
// resolves each branch the pass listed as `awaiting` through commitRoleRunStageGate, with
// approver "demo-stand-in" and a token minted over that branch's own subject ref
// (roleRunGateToken, the same call the engine's tests make), then advances again, until a pass
// produces nothing and resolves nothing, the run stops running, or MAX_PASSES.
//
// THE SIMULATED INTERVIEW (--approve-gates only; ADR-0011 amendment 2026-10-06). Nothing in the
// demo ever holds an interview, so every S5 card would read "unrated" and no offer could be
// approved. Right after the stand-in approves an interview invite — between two advanceRoleRun
// passes, so S5 runs on the NEXT one and the engine is untouched — the child plays that
// branch's candidate from the CV on the entry through the existing interview simulator (the Claude
// CLI), seals the scorecard with the existing `scorecard` synthesis, and S5 reads it as it
// would a real one. Only a scorecard the model itself wrote ('llm') is accepted: a template
// scorecard, no CLI, KP_OFFLINE or a throwing provider leave the branch "unrated" with the
// reason recorded. Every reading labels the interview simulated and lists one row per
// branch (session, recommendation, turns, end) — never transcript text. The logic is
// app/_lib/interview-sim/role-demo.ts; this script only calls it.
//
// WHAT THE STAND-IN DECIDES is standInDecision in role-demo-run-reading.mjs, a stated policy,
// not "approve everything": it carries out the engine's recorded proposal and adds no judgment.
// It reads each branch's screen route and scorecard recommendation off the ledger and
// approves, declines (decision "declined") or LEAVES the branch parked. A hold is never decided
// — the fairness rule reserves it for a person — so a held branch stays parked and the
// reading counts it as held. An offer with no positive scorecard is declined. Every reading
// shows per gate the approved / declined / left counts and each decline and leave reason.
// Goal 1 reads "met" only when an offer was approved on that recorded basis.
//
// --approve-all is the OLD behaviour, kept for mechanics: it approves every parked branch with
// no policy, so a below-floor candidate walks on to an offer on no assessment. It reports the
// stages reached per branch and its goal-1 verdict is WITHHELD, never "met".
//
// Policy versions (both flags): the rejection gate's is the one the screen artifact itself
// recorded; the engine records none for the invite and offer gates, so those use the labels
// its tests sign with ("invite-1", "offer-1") — nothing is invented. No stage runner is
// stubbed or overridden: a default runner that throws is the finding, and the reading names
// the stage and the error.
//
// READ-ONLY, AND IT MEANS IT — the same protocol as thread-autonomy.mjs. The source database
// is resolved as KP_DB_PATH, else data/kp.sqlite, and is NEVER opened or migrated: the file
// (plus any -wal/-shm beside it) is copied to a fresh temp directory, KP_DB_PATH is pointed at
// the copy BEFORE anything under app/_lib/db is imported, the run happens in a child process
// (the stores hold private SQLite handles with no close API, and Windows will not delete a file
// a live handle holds), and the copy is deleted once the child has exited. The run, its
// artifacts and any migration land on the copy and die with it.
//
// WHAT IT WILL NOT DO IS ROUND AN EMPTY DENOMINATOR TO A NUMBER. A cancelled run, an empty
// slate, no database, or an engine that throws prints "not measured: <reason>" — and a coverage
// row with nothing to divide prints "n/a", never 0% or 100%. The headline logic is the pure
// summarizeRoleDemoRun in role-demo-run-reading.mjs, which is what the fixtures test.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MAX_PASSES, runDemoOnCopy } from "./role-demo-run-child.mjs";
import {
  STAND_IN_APPROVER,
  branchesByFurthest,
  formatCoverage,
  formatGateCounts,
  formatStandInTally,
  furthestPerBranch,
  goalOneHeadline,
  formatSimulatedInterviews,
  simulatedOfferCount,
  stagesReached,
  stoppedAt,
  summarizeRoleDemoRun,
  tallyStandIn,
} from "./role-demo-run-reading.mjs";

const SELF = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SELF), "..", "..");
const args = process.argv.slice(2);
const asJson = args.includes("--json");
if (args.includes("--approve-gates") && args.includes("--approve-all")) {
  console.error("--approve-gates and --approve-all are different stand-ins; pick one");
  process.exit(2);
}
/** null: nobody passes gates; "policy": --approve-gates; "all": --approve-all (mechanics only). */
const standInMode = args.includes("--approve-gates") ? "policy" : args.includes("--approve-all") ? "all" : null;
const RESULT_MARK = "KP_ROLE_DEMO_RESULT ";

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

const MAX_SIM_INTERVIEWS = 5; // restated from role-demo.ts (the parent half loads no TS); the simulator clamps again
const simInterviewsArg = flagValue("--sim-interviews");
if (simInterviewsArg !== undefined && standInMode !== "policy") {
  console.error("--sim-interviews only applies with --approve-gates");
  process.exit(2);
}
const simInterviews = simInterviewsArg === undefined ? undefined : Number(simInterviewsArg);
if (simInterviews !== undefined && !(Number.isInteger(simInterviews) && simInterviews >= 0)) {
  console.error("--sim-interviews needs a whole number, 0 or more");
  process.exit(2);
}
const simCap = simInterviews === undefined ? undefined : Math.min(simInterviews, MAX_SIM_INTERVIEWS);

const jobId = flagValue("--job") ?? "job-001";
const workspaceId = flagValue("--workspace");

// CHILD HALF (`--run-copy`, internal): KP_DB_PATH is already the scratch copy, so importing the
// stores is safe. The loop itself is role-demo-run-child.mjs (a test drives the same function
// with the simulator's doubles); the result goes out as one marked line so a store's own
// logging cannot be mistaken for it.
if (args.includes("--run-copy")) {
  const record = await runDemoOnCopy({ jobId, workspaceId, standInMode, simCap });
  console.log(RESULT_MARK + JSON.stringify(record));
  process.exit(0);
}

const sourceDb = path.resolve(process.env.KP_DB_PATH ?? path.join(REPO_ROOT, "data", "kp.sqlite"));

if (!existsSync(sourceDb)) {
  if (asJson) {
    console.log(JSON.stringify({ measured: false, headline: "not measured: no database", source: { db: null } }, null, 2));
  } else {
    console.log("not measured: no database");
  }
  process.exit(0);
}

const scratch = mkdtempSync(path.join(tmpdir(), "kp-role-demo-run-"));
let record;
try {
  const copy = path.join(scratch, "kp.sqlite");
  for (const suffix of ["", "-wal", "-shm"]) {
    if (existsSync(sourceDb + suffix)) copyFileSync(sourceDb + suffix, copy + suffix);
  }
  // KP_DB_PATH reaches the child through its environment, before it imports anything under
  // app/_lib/db (db-path computes its path from it when first evaluated).
  //
  // KP_ROLE_DEMO_SCRATCH_DB is the POSITIVE marker the simulator's own guard demands
  // (assertRoleDemoScratchDb): "this exact file is a copy I made for this run". Only the
  // parent half may set it, and it names the copy, never the source.
  //
  // KP_NO_COMMS_EGRESS seals outbound candidate messages for the child. Nothing on the
  // demo path dispatches comms today — the engine's invite stage drafts and parks, the
  // gate commit only appends a ledger row — but the child inherits the operator's
  // COMMS_WEBHOOK_URL and runs on a copy of their relay CONFIG, so the only thing
  // standing between an approved invite and a real candidate's address was the absence
  // of a send call. With the flag the relay resolves to nothing and every message would
  // queue in the copy's own outbox, which dies with it.
  const child = spawnSync(process.execPath, [...process.execArgv, SELF, ...args, "--run-copy"], {
    cwd: REPO_ROOT,
    env: { ...process.env, KP_DB_PATH: copy, KP_ROLE_DEMO_SCRATCH_DB: copy, KP_NO_COMMS_EGRESS: "1" },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const line = (child.stdout ?? "").split("\n").find((l) => l.startsWith(RESULT_MARK));
  if (child.status !== 0 || !line) {
    console.error(child.stderr || `runner exited with ${child.status}`);
    process.exitCode = 1;
  } else {
    record = JSON.parse(line.slice(RESULT_MARK.length));
  }
} finally {
  try {
    rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    /* best-effort: it is a scratch copy in the OS temp dir, the OS reclaims it */
  }
}
if (!record) process.exit(1);

const reading = summarizeRoleDemoRun({
  runStatus: record.status,
  artifacts: record.artifacts,
  failure: record.failure ?? (record.capped ? `run still running after ${MAX_PASSES} passes` : null),
});

const simulatedInterviews = record.simulatedInterviews ?? null;
const standIn = standInMode
  ? { mode: standInMode, tally: tallyStandIn(record.standInDecisions), simulatedOffers: simulatedInterviews ? simulatedOfferCount(record.standInDecisions, simulatedInterviews) : 0 }
  : null;

if (asJson) {
  const standInFields = standIn
    ? { approvedBy: STAND_IN_APPROVER, standInMode: standIn.mode, mechanicsOnly: standIn.mode === "all", standInTally: standIn.tally, standInDecisions: record.standInDecisions, ...(simulatedInterviews ? { simulatedInterviews, simulatedInterviewCap: record.simulatedInterviewCap } : {}), stagesReached: stagesReached(record.artifacts), furthestPerBranch: furthestPerBranch(record.artifacts), stoppedAt: stoppedAt({ runStatus: record.status, parkedByGate: reading.parkedByGate, failure: record.failure, capped: record.capped }) }
    : {};
  console.log(JSON.stringify({ ...reading, run: record.run, status: record.status, passes: record.passes, coverage: record.coverage, dwell: record.dwell, goalOne: record.goalOne, goalOneHeadline: goalOneHeadline(record.goalOne, reading, standIn), ...standInFields, artifacts: record.artifacts, source: { db: sourceDb } }, null, 2));
  process.exit(0);
}

const rel = path.relative(REPO_ROOT, sourceDb);
console.log(
  standInMode === "all"
    ? "Role demo run — MECHANICS ONLY: default runners, every gate approved by the demo stand-in with no policy (not a person), on a copy"
    : standInMode === "policy"
      ? "Role demo run — default runners, gates passed by the demo stand-in under its policy (not a person), on a copy"
      : "Role demo run — default runners, no human step, on a copy"
);
console.log(`  source: ${rel.startsWith("..") ? sourceDb : rel} (read from a copy; the run was deleted with it)`);
console.log(`  job: ${record.run.jobId} · workspace: ${record.run.workspaceId} · cycle: ${record.run.cycle}`);
console.log(`  passes: ${record.passes} · final run status: ${record.status}`);
if (reading.produced.length === 0) {
  console.log("  stages produced: none");
} else {
  console.log(`  stages produced (${reading.produced.length}):`);
  for (const p of reading.produced) console.log(`    ${p.kind}${p.branchRef ? ` [${p.branchRef}]` : ""} — ${p.status}`);
}
const gates = Object.entries(reading.parkedByGate);
if (gates.length === 0) {
  console.log("  awaiting gate approval: none");
} else {
  console.log("  awaiting gate approval:");
  for (const [gate, branches] of gates) console.log(`    ${gate}: ${branches.length} (${branches.join(", ")})`);
}
console.log(`  autonomous coverage: ${formatCoverage(record.coverage.overall)}`);
for (const kind of record.stageOrder) {
  const row = record.coverage.byKind[kind];
  if (row.total > 0) console.log(`    ${kind}: ${formatCoverage(row)}`);
}
const dwell = record.dwell;
console.log(`  gate dwell: ${dwell.open} open · ${dwell.closed} closed · ${dwell.unmeasurable} unmeasurable · median closed ${dwell.medianClosedMs === null ? "n/a" : `${dwell.medianClosedMs} ms`}`);
const goalOne = record.goalOne;
const approvals = Object.fromEntries(Object.entries(goalOne.gateApprovals).map(([g, t]) => [g, t.approved]));
console.log(`  human steps outside gates: ${goalOne.humanStepsOutsideGates}`);
console.log(`  gate approvals: ${formatGateCounts(approvals)} (declined ${Object.values(goalOne.gateApprovals).reduce((n, t) => n + t.declined, 0)})`);
console.log(`  open gates: ${formatGateCounts(goalOne.openGates)}`);
console.log(`  ${reading.headline}`);
console.log(`  ${goalOneHeadline(goalOne, reading, standIn)}`);
if (standIn) {
  console.log(`  gates passed by the demo stand-in, not a person${standIn.mode === "all" ? " (--approve-all: NO policy, mechanics only)" : ""}:`);
  for (const line of formatStandInTally(standIn.tally)) console.log(`    ${line}`);
  if (simulatedInterviews) {
    console.log(`  simulated interviews (candidate played by the model from the CV on the entry; cap ${record.simulatedInterviewCap}; no transcript text is printed):`);
    if (simulatedInterviews.length === 0) console.log("    none: no interview invite was approved");
    for (const line of formatSimulatedInterviews(simulatedInterviews)) console.log(`    ${line}`);
  }
  console.log(`  stages reached: ${stagesReached(record.artifacts).map((s) => `${s.kind} ${s.chains}`).join(" · ") || "none"}`);
  console.log(`  furthest stage per branch: ${branchesByFurthest(record.artifacts).map((r) => `${r.kind} ${r.branches}`).join(" · ") || "none"}`);
  console.log(`  stopped: ${stoppedAt({ runStatus: record.status, parkedByGate: reading.parkedByGate, failure: record.failure, capped: record.capped })}`);
}
