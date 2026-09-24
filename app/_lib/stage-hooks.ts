// POST-COMMIT hooks: what the system does on its own once an entry STANDS on a
// stage, as opposed to what the write itself does.
//
// There are two. Entering a `homework` column gets the candidate their work-sample
// assignment — designing one for the role first when the job has none (see
// stage-hooks-homework.ts, which holds the same three rules stated below and, like
// this module, introduces no pipeline event kind of its own).
//
// The other, implemented here: entering an interview column whose hiring-plan round
// is run by the AI mints the voice-screen link and invites the candidate —
// immediately when that column's gate is `auto`, parked for a human when it is
// `human`. The recruiter used to have to open the candidate modal and press
// "Create link" for every single candidate the board had just advanced into an AI
// round, which is the one step of the AI-interview loop that was still manual.
//
// THREE RULES THIS MODULE EXISTS TO HOLD
//
//  1. It runs AFTER the stage write has COMMITTED, never inside the transaction.
//     better-sqlite3 transactions are synchronous and minting involves an LLM
//     grounding build plus a comms round trip — an `await` between BEGIN and COMMIT
//     silently destroys the atomicity of the move. The store schedules this through
//     `afterResponse` once `tx.immediate()` has returned.
//  2. It is BEST-EFFORT. A mint failure, a dead relay, an empty billing meter —
//     none of them may turn a completed stage move into a failed one. Every outcome
//     is recorded as a pipeline event instead, so the candidate modal's history
//     tells the truth about what did and did not go out.
//  3. It never CLAIMS more than happened. The event kind carries the outbox's real
//     delivery status (`_sent` / `_queued` / `_failed`), never a blanket "sent".
//
// The mint itself is NOT re-implemented here: `mintAndInviteVoiceScreen`
// (interview-invite.ts) is the same door POST /api/interview/create goes through,
// so the board's manual button and this hook share the live-call guard, the
// billing reservation, the revoke-then-create reissue semantics and the truthful
// delivery claim. It is reached through a BOOT-REGISTERED seam
// (stage-hooks-invite.ts, registered by late-bound-boot.ts from
// instrumentation-node.ts) rather than a static import: db/pipeline.ts reaches this
// module, db/pipeline.ts is on nearly every route, and a static edge put the whole
// mint (grounding build, kit pin, agenda, director brief) on all of their compiles.
// An unregistered door throws inside the try below, so it lands where every other
// mint failure lands: the move stands, the candidate is parked for a human, the log
// names the missing registration.

import { afterResponse } from "./after-response";
import { meterGate } from "./billing/enforce";
import { candidateRecipient } from "./comms-dispatch";
import { isDeliverableAddress } from "./comms-recipient";
import { planStep } from "./decision-config-schema";
import { getDecisionConfigVersion } from "./decision-config-store";
import { getPipelineEntry, setApproval } from "./db/pipeline";
import { latestInterviewByEntry } from "./db/interviews";
import { listPipelineEventsForEntry } from "./db/pipeline-events";
import { getInterviewPlan } from "./interview-plan";
import { GROUNDED_DEFAULT_MIN } from "./interview-duration.mjs";
import { stageHookInvite } from "./stage-hooks-invite";
import { getPipelineAxis } from "./pipeline-axis-server";
import { stageHasRole } from "./pipeline-stages";
import { runHomeworkArrival, type HomeworkArrivalOutcome } from "./stage-hooks-homework";
import { scheduleRoleFillHook } from "./stage-hooks-role-fill";
import { isTerminalEntryStatus } from "./pipeline-status";

/** The event kind that means "an invite already went out for this entry at this
 *  stage".
 *
 *  It is NOT written here — `dispatchInterviewInvite` writes it on every invite it
 *  attempts, including the one a recruiter sends by hand from the board or the
 *  Schedule tab. Reading the SAME row both paths write is the point: a recruiter
 *  who already handed out the link while the candidate stood on this column must
 *  not have a second one mailed over the top of it.
 *
 *  Together with "does this entry still hold a live session" below, this is the
 *  idempotence key — (entry, stage) → at most one invite. Entering the same column
 *  twice, a retried poll and a bulk move all resolve to the same pair, and
 *  `pipeline_events.to_stage` is stamped by the recorder from the row's own stage,
 *  so the key needs no new column and no new table.
 *
 *  DELIBERATELY NO NEW EVENT KINDS. The event vocabulary is pinned by set equality
 *  across three registries (`decision-attribution.ts`, the feed's
 *  `pipelineEventCatalog.ts`, and a localized label per kind in all four catalogs),
 *  and a kind that exists in one but not the others is a red build or an UNKNOWN
 *  badge. So this hook reports itself through state the recruiter's surfaces
 *  already read rather than through a vocabulary only it understands:
 *    - SENT / QUEUED → the dispatcher's own `interview_invite_sent` row, whose
 *      truthful claim the Outbox carries (the hook never asserts a delivery);
 *    - HELD          → the `calendar` approval, i.e. the Schedule tab's AI-round
 *      docket, where the candidate appears under "Awaiting link" with the button
 *      that calls this very door;
 *    - FAILED        → the candidate simply STAYS in that docket (no session was
 *      minted), plus a server log line naming the entry and the reason. Nothing
 *      anywhere claims a link went out.
 *  Turning the failure cases into timeline rows of their own is a good follow-up;
 *  it needs `interview_invite_failed` added to all three registries at once. */
const INVITE_SENT_EVENT_KIND = "interview_invite_sent";

/** How far back the idempotence read looks. An entry's history is short (a few
 *  dozen rows over a hiring cycle); 200 covers a pathological one without turning
 *  a post-commit hook into a table scan. */
const IDEMPOTENCE_EVENT_LOOKBACK = 200;

/** The default proposed slot the screening accept already writes when it arms the
 *  calendar gate (pipeline.ts / pipeline-entry-action.ts). Reused verbatim so a
 *  held invite renders on the Schedule tab exactly like every other parked
 *  candidate rather than as a row with an unfamiliar detail string. */
const DEFAULT_PROPOSED_SLOT = "Tue 14:00";

export type StageEnteredOutcome =
  /** The hook does not govern this arrival (wrong role, no AI round, stale, closed). */
  | { outcome: "skipped"; reason: "entry_gone" | "terminal" | "stage_moved" | "not_interview_role" | "no_ai_round" }
  /** The arrival was a `homework` column; the work-sample hook answered it. */
  | HomeworkArrivalOutcome
  /** An invite already exists for this (entry, stage) — the idempotence guard. */
  | { outcome: "already_invited" }
  /** The plan gates this column for a human: parked, nothing sent. */
  | { outcome: "held" }
  /** Minted and dispatched; `delivery` is the outbox's real claim. */
  | { outcome: "invited"; delivery: "sent" | "queued" | "failed"; token: string }
  /** Nothing was minted; the candidate was parked for a human and the reason logged. */
  | { outcome: "failed"; reason: "unaddressable" | "billing" | "call_in_progress" | "error" };

export type StageEnteredInput = {
  entryId: string;
  stage: string;
  workspaceId: string;
  /** Request origin when one exists; the hook normally has none. */
  origin?: string | null;
  /** Who caused the arrival, in the decision-chain vocabulary. Rides the event. */
  actorRef?: string | null;
};

/**
 * Schedule the arrival hooks for an already-COMMITTED stage move. Synchronous,
 * never throws, and returns immediately — the store calls it right after
 * `tx.immediate()` returns.
 *
 * `afterResponse` is what makes "best-effort" true rather than merely intended: on
 * a Node server the task runs once the response is finished, on serverless it
 * extends the invocation (a bare detached promise would be killed with it), and a
 * task that throws is logged instead of becoming an unhandled rejection. So the
 * recruiter's move returns at the speed of the SQLite write, and no outcome of the
 * mint can reach back into it.
 */
export function scheduleStageEnteredHook(input: StageEnteredInput): void {
  afterResponse("stage-entered", () => runStageEnteredHook(input));
  // The THIRD arrival hook, and the only one that acts on the ROLE rather than on
  // the candidate: a hire that meets the role's target hires retires the role (see
  // stage-hooks-role-fill.ts, which holds the same three rules stated above and
  // likewise introduces no pipeline event kind of its own). Scheduled beside the
  // others rather than called from inside runStageEnteredHook, because that
  // function returns early on every arrival it does not govern — including the
  // terminal one this hook exists for.
  scheduleRoleFillHook({ entryId: input.entryId, stage: input.stage, workspaceId: input.workspaceId });
}

/**
 * The gate that actually governs an AI interview column.
 *
 * KNOWN INCONSISTENCY, stated out loud because it is deliberate and because the
 * owner should decide whether to keep it:
 *
 *   The shipped default plan (`INTERVIEW_PLAN_DEFAULT`) gates its one AI interview
 *   round as "human", and the plan editor (`PipelineStepPolicy.tsx`) paints an
 *   untouched step as "human" for the same reason. But the owner's instruction for
 *   this hook is "hold when human, BY DEFAULT set as auto/AI step" — an AI step
 *   nobody has configured should run unattended.
 *
 *   So this resolves: an explicitly SAVED plan's gate is honored exactly as saved,
 *   and only a workspace that has never saved a hiring plan at all falls to "auto"
 *   for an AI round. `getDecisionConfigVersion` returning null is the discriminator
 *   — it is null only while no `interviewPlan` row exists for the workspace.
 *
 *   The asymmetry that remains: on a never-saved workspace the editor SHOWS "human"
 *   while this hook ACTS "auto". Closing it properly means changing the shipped
 *   default (a behaviour change for every existing install) or the editor's unsaved
 *   paint — both owned elsewhere. Flagged in docs/features/interviews/README.md.
 */
export function effectiveInterviewGate(
  step: { gate: "auto" | "human" },
  workspaceId: string
): "auto" | "human" {
  const saved = getDecisionConfigVersion("interviewPlan", workspaceId) !== null;
  return saved ? step.gate : "auto";
}

/**
 * Run the post-commit hooks for "entry <id> now stands on stage <stage>".
 *
 * `stage` is the stage the CALLER committed. It is re-read and compared against the
 * row's current stage before anything is minted: this runs outside the transaction,
 * so a second move may have landed in the gap, and a decision computed for a stage
 * the candidate has left must not be applied to whatever stage they are in now
 * (the same discipline as `actOnPipelineEntry`'s `expectedStage` CAS).
 *
 * Never throws: the move already committed and stands, so the worst case is an
 * outcome nobody acted on plus a line in the server log.
 */
export async function runStageEnteredHook(input: StageEnteredInput): Promise<StageEnteredOutcome> {
  const { entryId, stage, workspaceId } = input;
  try {
    const entry = getPipelineEntry(entryId, workspaceId);
    if (!entry) return { outcome: "skipped", reason: "entry_gone" };
    // A rejected / declined / rematched candidate is not invited to an interview,
    // whatever column the row happens to sit on.
    if (isTerminalEntryStatus(entry.status)) return { outcome: "skipped", reason: "terminal" };
    // The stale-decision guard (see the docblock): they already moved on.
    if (entry.stage !== stage) return { outcome: "skipped", reason: "stage_moved" };

    // Does this arrival even mean "an interview starts here"? Asked of THIS
    // workspace's axis by ROLE, never of a column literally called "Interview" — a
    // team that renamed or added columns must get the same behaviour.
    const axis = getPipelineAxis(workspaceId).stages;

    // THE WORK-SAMPLE ARRIVAL, asked first and by ROLE for the same reason the
    // interview branch is: a team that renamed or reordered its columns must get the
    // same behaviour. A `homework` column gets the candidate their assignment — see
    // stage-hooks-homework.ts, which holds the same three rules this module states and
    // likewise introduces no pipeline event kind of its own.
    if (stageHasRole(stage, "homework", axis)) {
      return runHomeworkArrival(entry, stage, workspaceId, { origin: input.origin ?? null });
    }

    if (!stageHasRole(stage, "interview", axis)) return { outcome: "skipped", reason: "not_interview_role" };

    // …and is the round HERE run by the AI? A column with no step, or whose first
    // round is a human conversation, is somebody else's job: a person books it on
    // the Schedule tab's calendar and no link is minted.
    const step = planStep(getInterviewPlan(workspaceId), stage);
    if (!step || step.rounds[0]?.kind !== "ai") return { outcome: "skipped", reason: "no_ai_round" };

    // IDEMPOTENCE, before any spend — both halves, because they catch different
    // races. The EVENT half catches an invite that already went out while the
    // candidate stood on this column, whoever sent it (this hook, the board's
    // Create-link button, the Schedule docket). The SESSION half catches the case
    // the event cannot: a link minted moments ago whose dispatch has not recorded
    // yet, or one minted while the entry stood elsewhere and still live now.
    const invitedHere = listPipelineEventsForEntry(entryId, IDEMPOTENCE_EVENT_LOOKBACK, workspaceId).some(
      (e) => e.kind === INVITE_SENT_EVENT_KIND && e.toStage === stage
    );
    const openSession = latestInterviewByEntry(entryId, workspaceId);
    // A REVOKED session is not a live credential — the recruiter pulled it, and a
    // later arrival at this column may legitimately mint a fresh one.
    if (invitedHere || (openSession && openSession.status !== "revoked")) {
      return { outcome: "already_invited" };
    }

    // Unaddressable candidates are skipped BEFORE the mint, not after: minting
    // burns an LLM grounding build and reserves voice minutes for a link that has
    // no way of reaching anybody. Same predicate the comms layer itself uses, so
    // "unaddressable" means here exactly what it means in the Outbox.
    if (!isDeliverableAddress(candidateRecipient(entry))) {
      return failOpenToTheHumanQueue(entry, workspaceId, "unaddressable", "no deliverable contact address is on file");
    }

    if (effectiveInterviewGate(step, workspaceId) === "human") {
      // HELD. No link, no mail, no spend — the candidate is parked on the existing
      // `calendar` gate, which IS the Schedule tab's AI-round docket: they appear
      // under "Awaiting link", beside the button that calls this very mint door.
      // Reusing that approval kind rather than inventing a seventh is deliberate —
      // the human surface for "this candidate is waiting for their interview link"
      // already exists, already works, and is already wired to the right action.
      //
      // CAS on `null`: only an entry with NO pending gate is parked. An entry that
      // already carries an approval (the screening accept arms `calendar` on the way
      // in; a scorecard or offer review may be open) is already waiting on a human,
      // and overwriting that with our own gate would erase theirs.
      if (entry.approvalKind === null) {
        setApproval(entryId, "calendar", DEFAULT_PROPOSED_SLOT, workspaceId, { expectedApprovalKind: null });
      }
      return { outcome: "held" };
    }

    // AUTO. Same cheap pre-gate the route runs before its own (possibly LLM-backed)
    // build: voice minutes are the one meter with real per-unit cost, and an
    // automatic hook firing across a bulk move must not be the thing that drives it
    // negative. The AUTHORITATIVE reservation against this session's real booked
    // length happens inside the mint door.
    if (meterGate("interview_minutes", { minUnits: GROUNDED_DEFAULT_MIN, workspace: workspaceId })) {
      return failOpenToTheHumanQueue(entry, workspaceId, "billing", "the interview-minutes allowance is exhausted");
    }

    const minted = await stageHookInvite()({
      entryId,
      workspaceId,
      origin: input.origin ?? null,
      // No `force`: a candidate mid-call must never have their session revoked and a
      // second invite mailed over the top of it by an automatic move.
    });

    if (!minted.ok) {
      return minted.refusal === "INTERVIEW_CALL_IN_PROGRESS"
        ? failOpenToTheHumanQueue(entry, workspaceId, "call_in_progress", "the candidate is already on a live call")
        : failOpenToTheHumanQueue(entry, workspaceId, "billing", `the ${minted.quota.meter} allowance is exhausted on the ${minted.quota.plan} plan`);
    }

    // The invite's own ledger row was written by `dispatchInterviewInvite`, carrying
    // the Outbox's real status. Nothing is added here, and in particular nothing
    // here claims a delivery: `minted.delivery` is handed back to the caller exactly
    // as the outbox reported it — `queued` when no relay is configured, `failed`
    // when the provider is unconfigured or the relay threw. A failed delivery still
    // leaves a live link on the candidate card for the recruiter to hand over.
    return { outcome: "invited", delivery: minted.delivery, token: minted.session.token };
  } catch (error) {
    // The stage move already committed and stands. All this can do is leave the
    // candidate where a human will see them and say what went wrong in the log.
    console.error(`[stage-hooks] interview invite failed for ${entryId} at ${stage}:`, error instanceof Error ? error.message : error);
    try {
      const entry = getPipelineEntry(entryId, workspaceId);
      if (entry) failOpenToTheHumanQueue(entry, workspaceId, "error", "the link could not be created automatically");
    } catch {
      /* best-effort: parking the candidate is a courtesy, never the reason a committed move is reported as broken */
    }
    return { outcome: "failed", reason: "error" };
  }
}

/**
 * FAIL OPEN, TOWARDS THE HUMAN. Nothing was minted and nothing was sent, so the
 * candidate is left exactly where a `human`-gated step would have left them: on
 * the `calendar` gate, i.e. the Schedule tab's AI-round docket under "Awaiting
 * link". The automation quietly declines to act rather than dropping the candidate
 * out of every queue, and no surface anywhere claims an invite went out.
 *
 * The reason itself goes to the server log rather than to the candidate's
 * timeline: the event vocabulary is pinned by set equality across three registries
 * (see INVITE_SENT_EVENT_KIND) and this hook deliberately introduces none.
 */
function failOpenToTheHumanQueue(
  entry: { id: string; approvalKind: string | null },
  workspaceId: string,
  reason: "unaddressable" | "billing" | "call_in_progress" | "error",
  why: string
): StageEnteredOutcome {
  console.warn(`[stage-hooks] ${entry.id}: AI interview link not minted (${reason}) — ${why}. Parked for a human.`);
  if (entry.approvalKind === null) {
    setApproval(entry.id, "calendar", DEFAULT_PROPOSED_SLOT, workspaceId, { expectedApprovalKind: null });
  }
  return { outcome: "failed", reason };
}
