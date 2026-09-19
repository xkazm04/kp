// POST-COMMIT hook: a role that has hired everyone it set out to hire retires
// itself.
//
// Opening a role states how many people it has to hire (POST
// /api/jobs/[id]/publish, `targetHires`). The brief the desk is built on is that a
// role stays open "until the number of hired candidates is reached or until the
// role is closed manually" — so the first half needs an actor, and this is it.
// Without it a two-hire req kept its apply links live, kept ranking the pool and
// kept chasing candidates for a seat that no longer existed, and the only way to
// stop it was for someone to remember.
//
// THE SAME THREE RULES stage-hooks.ts states, for the same reasons:
//
//  1. It runs AFTER the stage write has COMMITTED. The hire IS the stage move, and
//     better-sqlite3 transactions are synchronous — reconciling the rest of the
//     pipeline from inside the move's transaction would make the move's atomicity
//     a fiction the moment anything here awaited.
//  2. It is BEST-EFFORT. The candidate is hired either way; a failure to retire
//     the role must never turn a completed hire into a failed one.
//  3. It never CLAIMS more than happened, and it introduces NO pipeline event kind
//     of its own: the withdrawal it triggers writes the `role_closed` events that
//     a manual close writes, through the same store function, so the candidate
//     timelines cannot tell the two closes apart — which is correct, because to a
//     withdrawn candidate they are the same event.
//
// RACE SAFETY is the property worth reading closely. Two candidates dropped onto
// the terminal column at the same moment both commit, and both post-commit hooks
// then read the same "3 of 3". The flip is therefore a COMPARE-AND-SWAP —
// `closeRoleIfOpen` re-asserts in its WHERE the "still open" predicate this
// function read — and only the call whose UPDATE changed a row goes on to withdraw
// the stragglers. The loser stops, silently and correctly. Without that, one filled
// role would run two withdrawal sweeps.

import { afterResponse } from "./after-response";
import { closeRoleIfOpen, getRoleOpenConfig, roleTargetHires } from "./db/jobs";
import { closeEntriesByJobId, getPipelineEntry, listJobPipelineStats } from "./db/pipeline";
import { getPipelineAxis } from "./pipeline-axis-server";
import { stageHasRole } from "./pipeline-stages";
import { isTerminalEntryStatus } from "./pipeline-status";

export type RoleFillOutcome =
  /** The arrival does not govern a role's fill state. */
  | { outcome: "skipped"; reason: "entry_gone" | "terminal" | "stage_moved" | "not_hire_role" | "no_job" }
  /** The role is live and still short of its target. */
  | { outcome: "open"; hired: number; target: number }
  /** The target is met but another writer retired the role first (or a human had). */
  | { outcome: "already_closed"; hired: number; target: number }
  /** THIS call retired the role; `withdrawn` is how many in-flight candidates it
   *  withdrew, or null when the withdrawal itself failed after the close committed. */
  | { outcome: "filled"; hired: number; target: number; withdrawn: number | null };

export type RoleFillInput = {
  entryId: string;
  /** The stage the caller committed — re-checked, never trusted (see below). */
  stage: string;
  workspaceId: string;
};

/**
 * Schedule the fill check for an already-COMMITTED stage move. Synchronous, never
 * throws, returns immediately: `afterResponse` runs the work once the response is
 * finished (and extends the invocation on serverless, where a detached promise
 * would simply be killed).
 */
export function scheduleRoleFillHook(input: RoleFillInput): void {
  afterResponse("role-fill", () => runRoleFillHook(input));
}

/**
 * Retire the role if this arrival filled it.
 *
 * `stage` is re-read and compared against the row's current stage for the same
 * reason `runStageEnteredHook` does it: this runs outside the transaction, a second
 * move may have landed in the gap, and closing a role on the strength of a hire the
 * recruiter has already undone would be a decision applied to a stage the candidate
 * has left.
 *
 * Never throws — the hire already committed and stands.
 */
export async function runRoleFillHook(input: RoleFillInput): Promise<RoleFillOutcome> {
  const { entryId, stage, workspaceId } = input;
  try {
    const entry = getPipelineEntry(entryId, workspaceId);
    if (!entry) return { outcome: "skipped", reason: "entry_gone" };
    // A rejected / declined / withdrawn candidate is not a hire, whatever column
    // the row happens to sit on. (A real hire keeps status 'active'.)
    if (isTerminalEntryStatus(entry.status)) return { outcome: "skipped", reason: "terminal" };
    if (entry.stage !== stage) return { outcome: "skipped", reason: "stage_moved" };
    const jobId = entry.jobId;
    if (!jobId) return { outcome: "skipped", reason: "no_job" };

    // "Did someone get HIRED here?" asked of THIS workspace's axis by ROLE, never
    // of a column literally called "Hired": a team that renamed or reordered its
    // board must get the same behaviour, and a name comparison on a renamed
    // terminal column would silently disable the whole feature (G8).
    const axis = getPipelineAxis(workspaceId).stages;
    if (!stageHasRole(stage, "terminal", axis)) return { outcome: "skipped", reason: "not_hire_role" };

    // The SAME rollup the Roles desk shows the recruiter (listJobPipelineStats,
    // which resolves the terminal role off the same axis) — so the number this
    // decision is taken on is the number on screen. A second, private counter here
    // is exactly how a "2 / 3" role ends up closed.
    const hired = listJobPipelineStats(workspaceId)[jobId]?.hired ?? 0;
    const target = roleTargetHires(getRoleOpenConfig(jobId).targetHires);
    if (hired < target) return { outcome: "open", hired, target };

    // THE COMPARE-AND-SWAP. Everything below runs at most once per role.
    if (!closeRoleIfOpen(jobId)) return { outcome: "already_closed", hired, target };

    try {
      // The same reconciliation a manual close performs, through the same store
      // function: the still-in-flight candidates are withdrawn as `role_closed` —
      // a distinct terminal status, so they read as "lost the role to timing", stay
      // out of the reject rate and resurface as rediscovery silver medalists. The
      // hired candidates themselves keep `status='active'` and are left alone.
      return { outcome: "filled", hired, target, withdrawn: closeEntriesByJobId(jobId, workspaceId) };
    } catch (error) {
      // The role IS closed and stands; its pipeline is not reconciled. Say so in the
      // log rather than reporting a close that happened as a failure — the same
      // `withdrawalFailed` split POST /api/jobs/[id]/close reports to its caller.
      console.error(`[stage-hooks-role-fill] role ${jobId} auto-closed but withdrawing its entries failed:`, error);
      return { outcome: "filled", hired, target, withdrawn: null };
    }
  } catch (error) {
    // The hire already committed and stands. All this can do is leave the role open
    // for a human to close and say what went wrong.
    console.error(
      `[stage-hooks-role-fill] fill check failed for ${entryId} at ${stage}:`,
      error instanceof Error ? error.message : error
    );
    return { outcome: "skipped", reason: "entry_gone" };
  }
}
