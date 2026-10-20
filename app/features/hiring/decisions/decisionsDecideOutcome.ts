// The ONE decide-outcome fold for the Decisions tab (decisions-review-ui/A).
//
// Every door that decides a review — the ledger's quick accept/reject, the
// candidate modal, the analysis modal, the group-eval rationale dialog (all via
// useDecisionsQueue's act()) and the batch bar (bulkDecideReviews) — turns a
// server response into one of two things here: a typed forward HANDOFF, or a
// coded FAILURE. Pure: no React, no fetch, no catalog.
//
// Two rules live here and nowhere else:
//
// 1. A failure is a CODE (plus the capability a gated door named, plus the HTTP
//    status), never the server's `error`/`reason` prose. The caller resolves it
//    through useErrorMessage in the reader's language. act() used to throw the
//    refusal body away and fail silently; the batch band used to join the English
//    per-id `reason` in every locale.
// 2. The post-accept handoff — queue the candidate on Schedule, backfill the
//    interview-prep artifact, surface an extended offer's secure link — is decided
//    by handoffFor() for BOTH the single and the batch path. It used to be written
//    twice and the copies drifted: the batch path only knew screening_review, so a
//    batch-accepted AI scorecard routed to the human round was never narrated.
import type { PipelineBatchResult } from "@/app/_lib/useAddToPipeline";
import type { Entry } from "@/app/features/shared/decisionsTypes";

export type DecideAction = "accept" | "reject" | "approve_event";

/** What the tab does after a CONFIRMED decision. */
export type DecideHandoff = {
  /** Name the candidate in the "queued on Schedule" banner. */
  queueForSchedule: boolean;
  /** Start the background interview_prep task. */
  prepTask: boolean;
  /** The extended offer's secure accept/decline link (string or nothing). */
  offerLink: string | null;
};

/** Why a decision did not land — a code to resolve, never prose to paint. */
export type DecideFailure = { code: string | null; capability: string | null; status: number | null };

export type DecideOutcome = { ok: true; handoff: DecideHandoff } | { ok: false; failure: DecideFailure };

type DecideTarget = Pick<Entry, "id" | "approvalKind" | "candidateLabel">;

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/** The single handoff rule, shared by act() and the batch bar. */
export function handoffFor(approvalKind: Entry["approvalKind"], action: DecideAction, body: unknown): DecideHandoff {
  const b = rec(body);
  const none: DecideHandoff = { queueForSchedule: false, prepTask: false, offerLink: null };
  if (action !== "accept") return none;
  if (approvalKind === "screening_review") {
    // An accepted screening flows to Schedule; its prep pack is built in the background.
    return { queueForSchedule: true, prepTask: true, offerLink: null };
  }
  if (approvalKind === "scorecard_review") {
    // HYBRID HANDOFF: only when the server actually routed the AI scorecard back to
    // the human round's calendar gate (the plan decides; the client never guesses).
    return { ...none, queueForSchedule: b.routedToHumanRound === true };
  }
  if (approvalKind === "offer_review" && b.offerExtended === true) {
    return { ...none, offerLink: str(b.link) };
  }
  return none;
}

/** Fold one single-row decide response. `res` null = the request never landed. */
export function foldDecideResponse(
  entry: Pick<Entry, "approvalKind">,
  action: DecideAction,
  res: { ok: boolean; status: number } | null,
  body: unknown
): DecideOutcome {
  if (res?.ok) return { ok: true, handoff: handoffFor(entry.approvalKind, action, body) };
  const b = rec(body);
  return {
    ok: false,
    failure: { code: str(b.code), capability: str(b.capability), status: res ? res.status : null },
  };
}

export type BatchDecideFold = {
  okIds: string[];
  failedIds: string[];
  /** Distinct per-id refusal codes, in first-seen order. Empty on a request failure. */
  codes: string[];
  /** Set when the WHOLE call fell (gate refusal or transport) — overrides per-id codes. */
  requestFailure: { code: string | null; capability: string | null } | null;
  /** Candidate labels to name in the queued-on-Schedule banner. */
  queuedLabels: string[];
  /** Entry ids whose interview_prep task should start. */
  prepIds: string[];
};

/** Fold a batch decide response over the targets that were sent. */
export function foldBatchDecide(targets: readonly DecideTarget[], action: DecideAction, res: PipelineBatchResult): BatchDecideFold {
  if (!res.ok) {
    return {
      okIds: [],
      failedIds: targets.map((e) => e.id),
      codes: [],
      requestFailure: { code: res.code ?? null, capability: res.capability ?? null },
      queuedLabels: [],
      prepIds: [],
    };
  }
  const byId = new Map(res.results.map((r) => [r.id, r]));
  const okIds: string[] = [];
  const failedIds: string[] = [];
  const codes: string[] = [];
  const queuedLabels: string[] = [];
  const prepIds: string[] = [];
  for (const e of targets) {
    const r = byId.get(e.id);
    if (r?.ok) {
      okIds.push(e.id);
      const h = handoffFor(e.approvalKind, action, r);
      if (h.queueForSchedule) queuedLabels.push(e.candidateLabel);
      if (h.prepTask) prepIds.push(e.id);
    } else {
      // Refused — or never reported, which is not a success either.
      failedIds.push(e.id);
      if (r?.code && !codes.includes(r.code)) codes.push(r.code);
    }
  }
  return { okIds, failedIds, codes, requestFailure: null, queuedLabels, prepIds };
}
