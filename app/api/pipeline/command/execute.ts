import type { PipelineEntry } from "@/app/_lib/db/core";
import { actOnPipelineEntry, recordAutomationEvent } from "@/app/_lib/db/pipeline";
import { dispatchRejection } from "@/app/_lib/comms-dispatch";
import { stageHasRole, type StageDef } from "@/app/_lib/pipeline-stages";

// The command bar's EXECUTE loop, lifted out of route.ts so its counting is
// testable without a NextRequest, a session or a live board.
//
// Why it exists: the bar used to report `count` alone. An entry whose guarded
// write REFUSED (the expectedStage CAS lost in the gap) and an entry whose
// action THREW were both dropped on the floor — the first silently, the second
// into console.error — so "rejected 12" could mean nine rejected, two lost to a
// race and one blown up. A bulk adverse action must never overstate itself:
// every target lands in exactly one of `count`, `failed` or (for advance_top)
// `heldAtOffer`, and `commsFailed` says how many of the counted rejections the
// candidate was NOT told about.

export type CommandExecutionCounts = {
  /** Targets whose guarded write actually applied. */
  count: number;
  /** Targets that did NOT apply: the CAS refused, or the action threw. */
  failed: number;
  /** Of the applied rejections, how many failed to queue a candidate notification. */
  commsFailed: number;
  /** advance_top only: targets standing on the offer step, held rather than advanced. */
  heldAtOffer: number;
};

/** The three store/comms calls this loop makes. Injectable so a test can drive a
 *  MIXED batch (applied / refused / threw / comms-blip) deterministically — none
 *  of those four outcomes can be forced through a real board in one pass. */
export type CommandExecutionDeps = {
  actOn: typeof actOnPipelineEntry;
  dispatchRejection: typeof dispatchRejection;
  recordEvent: typeof recordAutomationEvent;
};

const REAL_DEPS: CommandExecutionDeps = {
  actOn: actOnPipelineEntry,
  dispatchRejection,
  recordEvent: recordAutomationEvent,
};

export async function executeCommandTargets(
  args: {
    kind: "reject_below" | "advance_top";
    /** reject_below: the percentage the recruiter typed, for the audit detail. */
    threshold?: number;
    targets: readonly PipelineEntry[];
    axis: readonly StageDef[];
    workspaceId: string;
  },
  deps: CommandExecutionDeps = REAL_DEPS
): Promise<CommandExecutionCounts> {
  const { kind, threshold, targets, axis, workspaceId: ws } = args;
  let count = 0;
  let failed = 0;
  let commsFailed = 0;
  let heldAtOffer = 0;

  for (const e of targets) {
    try {
      if (kind === "reject_below") {
        const updated = deps.actOn(e.id, "reject", `Command bar: below ${threshold}%`, { expectedStage: e.stage, actor: "human" }, ws);
        if (!updated) {
          // The CAS lost in the gap (someone moved or closed this candidate
          // between the preview and now). Not an error — but the bar must not
          // count it as rejected either.
          failed += 1;
          continue;
        }
        count += 1;
        // A bulk reject must NEVER ghost the candidate (UAT M3): the command bar
        // used to flip status + audit only, while the screen-wave notified — so
        // the FASTEST reject surface was the one that went silent. Mirror the
        // wave: queue the rejection comm with per-candidate isolation so one
        // comms blip neither aborts the batch nor hides who wasn't told.
        try {
          await deps.dispatchRejection(updated);
        } catch (commsError) {
          commsFailed += 1;
          // The raw cause stays SERVER-SIDE. A pipeline event's `detail` is
          // copied verbatim onto GET /api/pipeline/events, which is the
          // unauthenticated Activity feed (pipeline-events-public.ts) — so
          // interpolating err.message here published better-sqlite3 internals
          // (SQLITE_* codes, constraint text, the absolute kp.sqlite path) and
          // relay endpoints to anyone who could reach the origin, the exact leak
          // error-message-hygiene.test.ts exists to prevent on the 500 path.
          console.warn(`[pipeline:command] rejection comms failed for ${e.id}:`, commsError);
          deps.recordEvent(
            e.id,
            "rejection_comms_failed",
            "Rejected via command bar, but the notification failed to queue — nudge manually.",
            ws
          );
        }
      } else {
        // The terminal stage is OUTCOME-bearing (same rule as the
        // /api/pipeline/[id] 422 guard): it is reached only when the CANDIDATE
        // accepts an extended offer. A bare accept on an offer-stage entry used
        // to fall through to the generic one-stage advance — silently "hiring"
        // the candidate and DESTROYING any drafted offer (actOnPipelineEntry
        // clears the offer_review approval). advance-top-N therefore advances UP
        // TO the offer step and STOPS there: targets standing on it are held and
        // reported (`heldAtOffer`) so the recruiter routes them through the offer
        // flow. Resolved by ROLE against this workspace's axis, never by the
        // literal "Offer" — a renamed offer column is still the offer step, and
        // reading its name let exactly the bare-advance above through again.
        if (stageHasRole(e.stage, "offer", axis)) {
          heldAtOffer += 1;
        } else if (deps.actOn(e.id, "accept", "Command bar: advance top", { expectedStage: e.stage, actor: "human" }, ws)) {
          count += 1;
        } else {
          failed += 1;
        }
      }
    } catch (err) {
      // One entry's unexpected throw never aborts the batch — but it IS a
      // failure, and the recruiter is told how many rather than only the log.
      failed += 1;
      console.error(`[pipeline:command] action failed for ${e.id}`, err);
    }
  }

  return { count, failed, commsFailed, heldAtOffer };
}
