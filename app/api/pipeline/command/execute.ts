import type { PipelineEntry } from "@/app/_lib/db/core";
import { runPipelineEntryAction, type EntryActionResult } from "@/app/_lib/pipeline-entry-action";
import { commandRejectDetail } from "@/app/_lib/pipeline-command";

// The command bar's EXECUTE loop, lifted out of route.ts so its counting is
// testable without a NextRequest, a session or a live board.
//
// Why it exists: the bar used to report `count` alone. An entry whose guarded
// write REFUSED (the expectedStage CAS lost in the gap) and an entry whose
// action THREW were both dropped on the floor — the first silently, the second
// into console.error — so "rejected 12" could mean nine rejected, two lost to a
// race and one blown up. A bulk adverse action must never overstate itself:
// every target lands in exactly one of `count`, `failed`, `heldAtOffer` or
// `routedToHumanRound`, and `commsFailed` says how many of the counted rejections
// the candidate was NOT told about.
//
// ONE WRITE DOOR (challenge-r05 pipeline-actions-commands/A). Every target goes
// through runPipelineEntryAction — the same core the per-entry and batch routes use —
// never through the store directly. The bar used to call the store write itself,
// so a typed `reject below 40%` sealed no decision record, wrote a NULL actor, never
// fired `candidate.rejected` to the ATS and left the group-eval cache stale; and
// `advance top N` guarded only "is it on the offer column", so a composed board
// could bare-advance onto its terminal column (a phantom hire) or destroy a drafted
// offer on a board with no offer column. The core owns all of that now; this loop
// owns only the bar's own rule (a drafted offer is never extended from here) and the
// arithmetic.

export type CommandExecutionCounts = {
  /** Targets whose guarded write actually applied. */
  count: number;
  /** Targets that did NOT apply: the core refused (a lost CAS, a vanished row), or threw. */
  failed: number;
  /** Of the applied rejections, how many failed to queue a candidate notification. */
  commsFailed: number;
  /** advance_top only: targets at the offer step (a drafted offer, or an advance the
   *  terminal guard refused), held rather than advanced. */
  heldAtOffer: number;
  /** advance_top only: accepts the hiring plan routed back to the human interview
   *  round. The approval was ratified but the candidate did not move a column, so
   *  counting them as advanced would overstate what the bar did. */
  routedToHumanRound: number;
};

/** The one call this loop makes. Injectable so a test can drive a MIXED batch
 *  (applied / refused / held / threw / comms-blip) deterministically — none of those
 *  outcomes can all be forced through a real board in one pass. */
export type CommandExecutionDeps = {
  runAction: typeof runPipelineEntryAction;
};

const REAL_DEPS: CommandExecutionDeps = { runAction: runPipelineEntryAction };

type Bucket = "count" | "failed" | "heldAtOffer" | "routedToHumanRound";

/** Map the core's transport-agnostic result to the bar's bucket. */
function bucketOf(r: EntryActionResult): Bucket {
  if (r.status === 200) return r.body.routedToHumanRound === true ? "routedToHumanRound" : "count";
  // The terminal stage is outcome-bearing: the core refuses an accept that stands on
  // the offer step or would land on the terminal column. For the bar that is the
  // documented stop ("advances up to Offer"), not a failure.
  if (r.status === 422 && r.body.code === "PIPELINE_TERMINAL_NOT_ADVANCE") return "heldAtOffer";
  return "failed";
}

export async function executeCommandTargets(
  args: {
    kind: "reject_below" | "advance_top";
    /** reject_below: the percentage the recruiter typed, for the audit detail and the seal. */
    threshold?: number;
    targets: readonly PipelineEntry[];
    workspaceId: string;
    /** The request origin the core requires (it mints offer links; the bar never does). */
    origin: string;
  },
  deps: CommandExecutionDeps = REAL_DEPS
): Promise<CommandExecutionCounts> {
  const { kind, threshold, targets, workspaceId: ws, origin } = args;
  const counts: CommandExecutionCounts = { count: 0, failed: 0, commsFailed: 0, heldAtOffer: 0, routedToHumanRound: 0 };

  for (const e of targets) {
    try {
      if (kind === "reject_below") {
        // The core seals the rejection (policyVersion "command-bar", the typed
        // threshold as a decisive input), names the session's actor, queues the
        // rejection comm with its failure guarded, fires the ATS event and expires
        // the group-eval cache. The expectedStage CAS is kept: a candidate moved
        // between preview and confirm is refused, and counted as failed.
        const r = await deps.runAction({
          id: e.id,
          action: "reject",
          expectedStage: e.stage,
          // The ONE literal the undo (./reverse.ts → planWaveReversal) matches against.
          detail: commandRejectDetail(threshold),
          via: "command_bar",
          threshold,
          origin,
          workspaceId: ws,
        });
        const bucket = bucketOf(r);
        counts[bucket] += 1;
        if (bucket === "count" && r.body.commsFailed === true) counts.commsFailed += 1;
      } else {
        // A drafted offer is HELD, before the core is asked: accepting an
        // offer_review approval EXTENDS the offer to the candidate, and the bar's
        // preview promises "advances up to Offer", never an unattended offer
        // extension. Gated on the approval, not the column, so a board with no
        // offer-role column (valid) cannot slip a drafted offer through.
        if (e.approvalKind === "offer_review") {
          counts.heldAtOffer += 1;
          continue;
        }
        const r = await deps.runAction({
          id: e.id,
          action: "accept",
          expectedStage: e.stage,
          detail: "Command bar: advance top",
          via: "command_bar",
          origin,
          workspaceId: ws,
        });
        counts[bucketOf(r)] += 1;
      }
    } catch (err) {
      // One entry's unexpected throw never aborts the batch — but it IS a
      // failure, and the recruiter is told how many rather than only the log.
      counts.failed += 1;
      console.error(`[pipeline:command] action failed for ${e.id}`, err);
    }
  }

  return counts;
}
