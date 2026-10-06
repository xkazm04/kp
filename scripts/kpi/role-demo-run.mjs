#!/usr/bin/env node
// THE DEMO RUN for goal 1, "one role runs end to end without a human step": it starts a role
// run for a seeded job, walks it with the engine's DEFAULT stage runners until it stops, and
// reads where it stopped. The thread-autonomy meter reads events the board already holds; this
// is the instrument that PRODUCES a run to read, because no role has ever been run end to end
// outside a test.
//
//   node --import ./scripts/test-alias-loader.mjs --experimental-transform-types --disable-warning=ExperimentalWarning scripts/kpi/role-demo-run.mjs [--job <id>] [--json] [--approve-gates]
//
//   --job <id>          which job to run (default job-001)
//   --workspace <id>    which workspace's board (default: the default workspace)
//   --json              the whole record: the reading, every stage produced, coverage, dwell, source
//   --approve-gates     opt in: after each pass, approve every branch parked at a gate with a
//                       labelled stand-in ("demo-stand-in"), then advance again — see below
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
// resolves each branch the pass listed as `awaiting` through commitRoleRunStageGate, decision
// "approved", approver "demo-stand-in", with a token minted over that branch's own subject ref
// (roleRunGateToken, the same call the engine's tests make), then advances again, until a pass
// produces nothing and approves nothing, the run stops running, or MAX_PASSES. Policy versions:
// the rejection gate's is the one the screen artifact itself recorded; the engine records none
// for the invite and offer gates, so those use the labels its tests sign with ("invite-1",
// "offer-1") — nothing is invented. Every reading says the gates were approved by the stand-in,
// not a person, and counts the approvals per gate. No stage runner is stubbed or overridden: a
// default runner that throws is the finding, and the reading names the stage and the error.
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
import { STAND_IN_APPROVER, formatCoverage, formatGateCounts, goalOneHeadline, standInLine, stagesReached, stoppedAt, summarizeRoleDemoRun } from "./role-demo-run-reading.mjs";

const SELF = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SELF), "..", "..");
const args = process.argv.slice(2);
const asJson = args.includes("--json");
const approveGates = args.includes("--approve-gates");
const MAX_PASSES = 20;
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

const jobId = flagValue("--job") ?? "job-001";
const workspaceId = flagValue("--workspace");

// CHILD HALF (`--run-copy`, internal): KP_DB_PATH is already the scratch copy, so importing the
// stores is safe. The result goes out as one marked line so a store's own logging cannot be
// mistaken for it.
if (args.includes("--run-copy")) {
  const { getOrCreateRoleRun, listStageArtifacts } = await import("@/app/_lib/db/role-runs");
  const { DEFAULT_WORKSPACE_ID } = await import("@/app/_lib/db/workspaces");
  const { advanceRoleRun, commitRoleRunStageGate, DEFAULT_STAGE_RUNNERS } = await import("@/app/_lib/role-run-engine");
  const { ROLE_RUN_STAGES, nextStageFor } = await import("@/app/_lib/role-run-stages");
  const { GATE_STAGE, ROLE_RUN_GATES, roleRunGateToken } = await import("@/app/_lib/role-run-gates");
  const { roleRunCoverage, gateDwell, roleRunGoalOneSteps } = await import("@/app/_lib/role-run-metrics");

  const ws = workspaceId ?? DEFAULT_WORKSPACE_ID;
  const { run } = getOrCreateRoleRun({ jobId, cycle: `demo-${Date.now()}` }, ws);
  let status = run.status;
  let passes = 0;
  let failure = null;
  // Stand-in approvals per gate; only ever non-zero under --approve-gates.
  const standIn = Object.fromEntries(ROLE_RUN_GATES.map((g) => [g, 0]));
  // The invite and offer gates have no policy version in the ledger — the engine records one
  // only on the screen — so they sign with the labels the engine's own tests use.
  const FALLBACK_POLICY = { interview_invite: "invite-1", offer: "offer-1" };

  /** Approve every branch the pass left parked; returns how many were approved. */
  const approveAwaiting = (awaiting) => {
    let approved = 0;
    for (const { branchRef, gate } of awaiting) {
      const parked = listStageArtifacts(run.id, ws)
        .filter((a) => a.kind === GATE_STAGE[gate] && a.branchRef === branchRef)
        .sort((a, b) => b.seq - a.seq)[0];
      const recorded = parked?.payload?.policyVersion;
      const policyVersion = typeof recorded === "string" && recorded ? recorded : FALLBACK_POLICY[gate];
      if (!policyVersion) throw new Error(`no live policy version for the ${gate} gate`);
      const now = Date.now();
      commitRoleRunStageGate(
        {
          runId: run.id,
          branchRef,
          gate,
          decision: "approved",
          policyVersion,
          subjectRefs: [branchRef],
          token: roleRunGateToken(run.id, gate, policyVersion, [branchRef], now),
          approver: STAND_IN_APPROVER,
          now,
        },
        ws
      );
      standIn[gate] += 1;
      approved += 1;
    }
    return approved;
  };

  /** The stage a throw most likely came from, read off the ledger: the run-wide stage still
   *  owed, else the owed branch stage on the chain with the fewest rows (the pass is
   *  round-robin, so the thrower is the first branch left behind). Inferred, and said so. */
  const stageOwedAfterThrow = () => {
    const arts = listStageArtifacts(run.id, ws);
    const wide = nextStageFor(arts, null);
    if (wide.action === "produce") return wide.kind;
    const slate = arts.filter((a) => a.kind === "slate" && a.branchRef === null && a.status === "complete").sort((a, b) => b.seq - a.seq)[0];
    const refs = (slate?.payload?.candidates ?? []).map((c) => c.candidateRef).filter(Boolean);
    const owed = refs
      .map((ref) => ({ next: nextStageFor(arts, ref), rows: arts.filter((a) => a.branchRef === ref).length }))
      .filter((o) => o.next.action === "produce")
      .sort((a, b) => a.rows - b.rows)[0];
    return owed ? owed.next.kind : null;
  };

  try {
    while (passes < MAX_PASSES && status === "running") {
      passes += 1;
      // DEFAULT_STAGE_RUNNERS passed whole and nothing else: a runner that needs a key, Python
      // or the network surfaces as a throw here, and the reading says so instead of stubbing it.
      const result = await advanceRoleRun(run.id, { runners: DEFAULT_STAGE_RUNNERS }, ws);
      status = result.status;
      const approvedNow = approveGates ? approveAwaiting(result.awaiting) : 0;
      if (result.produced.length === 0 && approvedNow === 0) break;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stage = approveGates ? stageOwedAfterThrow() : null;
    failure = `engine threw after ${passes} pass${passes === 1 ? "" : "es"}${stage ? ` at the ${stage} stage (inferred from the ledger)` : ""}: ${message}`;
  }
  const artifacts = listStageArtifacts(run.id, ws);
  console.log(
    RESULT_MARK +
      JSON.stringify({
        run: { id: run.id, jobId, cycle: run.cycle, workspaceId: ws },
        status,
        passes,
        capped: passes >= MAX_PASSES && status === "running",
        failure,
        stageOrder: [...ROLE_RUN_STAGES],
        artifacts: artifacts.map((a) => ({ kind: a.kind, branchRef: a.branchRef, status: a.status, seq: a.seq, producedAt: a.producedAt, payload: a.payload })),
        coverage: roleRunCoverage(artifacts),
        dwell: gateDwell(artifacts),
        goalOne: roleRunGoalOneSteps(artifacts),
        ...(approveGates ? { standIn } : {}),
      })
  );
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
  const child = spawnSync(process.execPath, [...process.execArgv, SELF, ...args, "--run-copy"], {
    cwd: REPO_ROOT,
    env: { ...process.env, KP_DB_PATH: copy },
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

const standIn = approveGates ? record.standIn : null;

if (asJson) {
  const standInFields = standIn
    ? { approvedBy: STAND_IN_APPROVER, standInApprovals: standIn, stagesReached: stagesReached(record.artifacts), stoppedAt: stoppedAt({ runStatus: record.status, parkedByGate: reading.parkedByGate, failure: record.failure, capped: record.capped }) }
    : {};
  console.log(JSON.stringify({ ...reading, run: record.run, status: record.status, passes: record.passes, coverage: record.coverage, dwell: record.dwell, goalOne: record.goalOne, goalOneHeadline: goalOneHeadline(record.goalOne, reading, standIn), ...standInFields, artifacts: record.artifacts, source: { db: sourceDb } }, null, 2));
  process.exit(0);
}

const rel = path.relative(REPO_ROOT, sourceDb);
console.log(approveGates ? "Role demo run — default runners, gates approved by the demo stand-in (not a person), on a copy" : "Role demo run — default runners, no human step, on a copy");
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
  console.log(`  ${standInLine(standIn)}`);
  console.log(`  stages reached: ${stagesReached(record.artifacts).map((s) => `${s.kind} ${s.chains}`).join(" · ") || "none"}`);
  console.log(`  stopped: ${stoppedAt({ runStatus: record.status, parkedByGate: reading.parkedByGate, failure: record.failure, capped: record.capped })}`);
}
