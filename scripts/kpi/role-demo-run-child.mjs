// The CHILD HALF of scripts/kpi/role-demo-run.mjs: the engine loop, the gate stand-in and the
// simulated interview, run against whatever database KP_DB_PATH points at. It is its own
// module so a test can drive the whole loop on a throwaway database with the interview
// simulator's keyless doubles injected (`simDeps`) — the script itself injects nothing and
// so uses the real Claude CLI.
//
// NEVER import this where KP_DB_PATH is the operator's database: it WRITES (a role run, its
// artifacts, gate resolutions, simulated interview sessions). The script points it at a
// scratch copy before this module's first call; a test points it at a unit-db.
import { STAND_IN_APPROVER, scorecardRecommendationOf, screenRouteOf, standInDecision } from "./role-demo-run-reading.mjs";

export const MAX_PASSES = 20;

/**
 * @param {{
 *   jobId: string,
 *   workspaceId?: string,
 *   standInMode: null | "policy" | "all",
 *   simCap?: number,
 *   simDeps?: import("../../app/_lib/interview-sim/role-demo").RoleDemoSimDeps,
 *   cycle?: string,
 *   live?: boolean,
 * }} input
 */
export async function runDemoOnCopy({ jobId, workspaceId, standInMode, simCap, simDeps, cycle, live }) {
  const { getOrCreateRoleRun, listStageArtifacts } = await import("@/app/_lib/db/role-runs");
  const { DEFAULT_WORKSPACE_ID } = await import("@/app/_lib/db/workspaces");
  const { advanceRoleRun, DEFAULT_STAGE_RUNNERS } = await import("@/app/_lib/role-run-engine");
  // The product's own door: a gate commit followed by ONE pass, so the harness measures what a
  // recruiter's click does rather than a commit that leaves the run waiting for a re-trigger.
  const { commitRoleRunStageGateAndContinue } = await import("@/app/_lib/role-run-commit-continue");
  const { ROLE_RUN_STAGES, nextStageFor } = await import("@/app/_lib/role-run-stages");
  const { GATE_STAGE, roleRunGateToken } = await import("@/app/_lib/role-run-gates");
  const { roleRunCoverage, gateDwell, roleRunGoalOneSteps } = await import("@/app/_lib/role-run-metrics");
  const { createRoleDemoSimulator } = await import("@/app/_lib/interview-sim/role-demo");
  // --live: the producers over the keyless floor, the set a live trigger composes. Without it
  // the engine's DEFAULT_STAGE_RUNNERS, unchanged.
  const runners = live ? (await import("@/app/_lib/role-run-live")).liveRoleRunRunners() : DEFAULT_STAGE_RUNNERS;

  const ws = workspaceId ?? DEFAULT_WORKSPACE_ID;
  const { run } = getOrCreateRoleRun({ jobId, cycle: cycle ?? `demo-${Date.now()}` }, ws);
  let status = run.status;
  let passes = 0;
  // The newest pass a COMMIT took (not one the harness started). The loop consumes it as its
  // next pass, so the run moving on a commit's own pass is not a retrigger.
  let commitPass = null;
  let failure = null;
  // Every decision the stand-in took, in order: { gate, branchRef, action, reason }. Empty
  // unless a stand-in flag is on.
  const standInDecisions = [];
  // A branch the policy left parked shows up in every later pass's `awaiting`; it is decided
  // (and counted) once.
  const decidedLeft = new Set();
  // The harness's own log of every act it performs outside the engine, as closed codes
  // (INTERVENTION_CODES in the reading half). The ledger cannot see these; this is the only
  // place they are visible.
  const interventions = [];
  const intervene = (code, detail) => interventions.push({ code, ...detail });
  // The invite and offer gates have no policy version in the ledger — the engine records one
  // only on the screen — so they sign with the labels the engine's own tests use.
  const FALLBACK_POLICY = { interview_invite: "invite-1", offer: "offer-1" };

  // The simulated interviews exist only for the policy stand-in: --approve-all is mechanics
  // and its verdict is withheld, so it plays no interview.
  const simulator = standInMode === "policy" ? createRoleDemoSimulator({ cap: simCap, workspaceId: ws, deps: simDeps }) : null;

  /** Pass the stand-in's gates for the branches the pass left parked; returns how many it
   *  RESOLVED (approved or declined) — a branch it leaves resolves nothing. */
  const resolveAwaiting = async (awaiting) => {
    let resolved = 0;
    for (const { branchRef, gate } of awaiting) {
      const key = `${gate}|${branchRef}`;
      if (decidedLeft.has(key)) continue;
      const artifacts = listStageArtifacts(run.id, ws);
      const decision =
        standInMode === "all"
          ? { action: "approve", reason: "approve-all: no policy" }
          : standInDecision({ gate, screenRoute: screenRouteOf(artifacts, branchRef), scorecardRecommendation: scorecardRecommendationOf(artifacts, branchRef) });
      if (decision.action === "leave") {
        decidedLeft.add(key);
        standInDecisions.push({ gate, branchRef, ...decision });
        continue;
      }
      const parked = artifacts.filter((a) => a.kind === GATE_STAGE[gate] && a.branchRef === branchRef).sort((a, b) => b.seq - a.seq)[0];
      const recorded = parked?.payload?.policyVersion;
      const policyVersion = typeof recorded === "string" && recorded ? recorded : FALLBACK_POLICY[gate];
      if (!policyVersion) throw new Error(`no live policy version for the ${gate} gate`);
      const now = Date.now();
      // The simulated interview must be sealed BEFORE S5 runs, so the one commit it depends on
      // takes no pass of its own (only when interviews can be played: a cap of 0 plays none); the harness-started pass after it is then a real retrigger.
      const holdForInterview = Boolean(simulator && simulator.cap > 0 && gate === "interview_invite" && decision.action === "approve");
      const committed = await commitRoleRunStageGateAndContinue(
        {
          runId: run.id,
          branchRef,
          gate,
          decision: decision.action === "approve" ? "approved" : "declined",
          policyVersion,
          subjectRefs: [branchRef],
          token: roleRunGateToken(run.id, gate, policyVersion, [branchRef], now),
          approver: STAND_IN_APPROVER,
          now,
        },
        ws,
        { advance: { runners }, continueRun: !holdForInterview }
      );
      if (committed.pass.outcome === "advanced") commitPass = { ...committed.pass, produced: committed.pass.produced + (commitPass?.produced ?? 0) };
      else if (committed.pass.outcome === "failed") throw new Error(committed.pass.error);
      standInDecisions.push({ gate, branchRef, ...decision });
      intervene("gate_commit", { pass: passes, gate, branchRef });
      resolved += 1;
      // The ordering the simulated interview depends on: S5 runs in the pass AFTER this
      // commit, so the interview is held and sealed here, before the loop advances again.
      if (simulator && gate === "interview_invite" && decision.action === "approve") {
        const row = await simulator.run(branchRef);
        // Only an interview that was actually played is an act; a refusal or a capped branch spent nothing.
        if (row.skipped === null) intervene("simulated_interview", { pass: passes, branchRef });
      }
    }
    return resolved;
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

  let commitsBeforePass = 0;
  try {
    while (passes < MAX_PASSES && status === "running") {
      passes += 1;
      let result;
      const commits = interventions.filter((i) => i.code === "gate_commit").length;
      if (commitPass) {
        // The commit's own pass moved the run; the harness starts nothing, so nothing is counted.
        result = { status: commitPass.runStatus, awaiting: commitPass.awaiting, produced: { length: commitPass.produced } };
        commitPass = null;
      } else {
        // A pass the harness starts after a gate commit is a re-trigger: somebody had to start
        // the engine again for the run to move.
        if (passes > 1 && commits > commitsBeforePass) intervene("retrigger", { pass: passes });
        // The chosen runner set passed whole and nothing else: a runner that needs a key, Python
        // or the network surfaces as a throw here, and the reading says so instead of stubbing it.
        result = await advanceRoleRun(run.id, { runners }, ws);
      }
      commitsBeforePass = commits;
      status = result.status;
      const resolvedNow = standInMode ? await resolveAwaiting(result.awaiting) : 0;
      if (result.produced.length === 0 && resolvedNow === 0) break;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stage = standInMode ? stageOwedAfterThrow() : null;
    failure = `engine threw after ${passes} pass${passes === 1 ? "" : "es"}${stage ? ` at the ${stage} stage (inferred from the ledger)` : ""}: ${message}`;
  }
  const artifacts = listStageArtifacts(run.id, ws);
  return {
    run: { id: run.id, jobId, cycle: run.cycle, workspaceId: ws },
    status,
    passes,
    capped: passes >= MAX_PASSES && status === "running",
    failure,
    runnerSet: live ? "live" : "default",
    interventions,
    stageOrder: [...ROLE_RUN_STAGES],
    artifacts: artifacts.map((a) => ({ kind: a.kind, branchRef: a.branchRef, status: a.status, seq: a.seq, producedAt: a.producedAt, payload: a.payload })),
    coverage: roleRunCoverage(artifacts),
    dwell: gateDwell(artifacts),
    goalOne: roleRunGoalOneSteps(artifacts),
    ...(standInMode ? { standInDecisions } : {}),
    ...(simulator ? { simulatedInterviews: simulator.rows, simulatedInterviewCap: simulator.cap } : {}),
  };
}
