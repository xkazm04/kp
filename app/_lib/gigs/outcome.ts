import { getGig, transitionGig } from "../db/gigs";
import { listGigAttemptsForGig } from "../db/gigs-attempts";
import { appendGigLesson, appendGigOutcome, listGigOutcomes } from "../db/gigs-outcomes";
import { recordGigSourceVerdict } from "../db/gigs-sources";
import { getGigSpecialist } from "../db/gigs-specialists";
import { gigChecklist } from "./checklists";
import { deriveGigLessons } from "./lessons";
import type {
  Gig,
  GigAttempt,
  GigLesson,
  GigOutcome,
  GigOutcomeSource,
  GigOutcomeVerdict,
  GigStatus,
} from "./types";

// Recording the external judge's verdict on sent work - ONE path for the operator's
// manual record (POST /api/gigs/[id]/outcome) and the outcome pollers (pollers.ts), so a
// poller-found merge and a hand-typed "accepted" move the same rows the same way.
//
// What one verdict does, in order (each step atomic on its own; no await anywhere):
//   1. append the outcome (gig_outcomes is APPEND-ONLY - the verdict is the record);
//   2. move the gig: sent -> accepted | rejected (duplicate is a rejection) | expired
//      (no_response: the operator stopped waiting - the work is not pending any more,
//      and `expired` is the one terminal that says "no verdict came" rather than
//      claiming one);
//   3. fold the verdict into the gig's SOURCE invalid streak (auto-pause at
//      GIG_INVALID_STREAK_LIMIT - programs suspend accounts for a run of invalid
//      reports, so kp stops feeding that source before they do);
//   4. queue one lesson per recipe the specialist adopted (lessons.ts).
//
// A CORRECTION - a verdict recorded on a gig already accepted, rejected or expired - is
// appended (the KPI reads the latest verdict per attempt) and teaches its lessons, but
// moves no status (those are terminal) and does NOT touch the source streak: one piece
// of work judged twice is still one judgment of the source.

/** Gig statuses an outcome may be recorded on: sent, or a resolved one (a correction). */
export const OUTCOME_RECORDABLE_STATUSES: readonly GigStatus[] = ["sent", "accepted", "rejected", "expired"];

/** Where a verdict moves a `sent` gig. */
export const OUTCOME_GIG_STATUS: Readonly<Record<GigOutcomeVerdict, GigStatus>> = {
  accepted: "accepted",
  rejected: "rejected",
  duplicate: "rejected",
  no_response: "expired",
};

export type RecordGigOutcomeInput = {
  gigId: string;
  /** The sent attempt judged; null = the gig's latest sent attempt (when it has one). */
  attemptId: string | null;
  verdict: GigOutcomeVerdict;
  amount: number | null;
  currency: string | null;
  feedbackText: string | null;
  source: GigOutcomeSource;
};

export type RecordGigOutcomeRefusal = "GIG_NOT_FOUND" | "GIG_OUTCOME_NOT_SENT" | "GIG_ATTEMPT_NOT_FOUND";

export type RecordGigOutcomeResult =
  | {
      ok: true;
      outcome: GigOutcome;
      gig: Gig;
      /** False for a correction, or when the gig moved meanwhile (the CAS lost). */
      statusMoved: boolean;
      correction: boolean;
      /** True only when THIS verdict tripped the source's invalid-streak pause. */
      sourcePaused: boolean;
      lessons: GigLesson[];
    }
  | { ok: false; code: RecordGigOutcomeRefusal };

function sentOrder(a: GigAttempt): string {
  return `${a.sentAt ?? ""}\u0000${a.createdAt}\u0000${a.id}`;
}

/** The gig's latest SENT attempt (sentAt, then createdAt, then id - the KPI's order). */
export function latestSentAttempt(attempts: readonly GigAttempt[]): GigAttempt | null {
  let best: GigAttempt | null = null;
  for (const a of attempts) if (a.status === "sent" && (!best || sentOrder(a) > sentOrder(best))) best = a;
  return best;
}

/** Whether a poller already recorded a verdict for this attempt - pollers never append
 *  a second one (idempotent across ticks and restarts). */
export function hasPollerOutcome(outcomes: readonly GigOutcome[], attemptId: string): boolean {
  return outcomes.some((o) => o.attemptId === attemptId && o.source.startsWith("poller:"));
}

export function recordGigOutcome(workspaceId: string, input: RecordGigOutcomeInput): RecordGigOutcomeResult {
  const gig = getGig(workspaceId, input.gigId);
  if (!gig) return { ok: false, code: "GIG_NOT_FOUND" };
  if (!OUTCOME_RECORDABLE_STATUSES.includes(gig.status)) return { ok: false, code: "GIG_OUTCOME_NOT_SENT" };

  const attempts = listGigAttemptsForGig(workspaceId, gig.id);
  let attempt: GigAttempt | null;
  if (input.attemptId !== null) {
    attempt = attempts.find((a) => a.id === input.attemptId) ?? null;
    if (!attempt) return { ok: false, code: "GIG_ATTEMPT_NOT_FOUND" };
    // The KPI only reads verdicts on sent work; a verdict on a draft would vanish.
    if (attempt.status !== "sent") return { ok: false, code: "GIG_OUTCOME_NOT_SENT" };
  } else {
    attempt = latestSentAttempt(attempts);
  }

  const outcome = appendGigOutcome(workspaceId, {
    gigId: gig.id,
    attemptId: attempt?.id ?? null,
    verdict: input.verdict,
    amount: input.amount,
    currency: input.currency,
    feedbackText: input.feedbackText,
    source: input.source,
  });
  if (!outcome) return { ok: false, code: "GIG_NOT_FOUND" };

  const correction = gig.status !== "sent";
  let current = gig;
  let statusMoved = false;
  let sourcePaused = false;
  if (!correction) {
    const moved = transitionGig(workspaceId, gig.id, { from: "sent", to: OUTCOME_GIG_STATUS[input.verdict] });
    if (moved.ok) {
      current = moved.gig;
      statusMoved = true;
    } else {
      current = getGig(workspaceId, gig.id) ?? gig;
    }
    if (gig.sourceId) sourcePaused = recordGigSourceVerdict(workspaceId, gig.sourceId, input.verdict)?.paused === true;
  }

  const specialistId = attempt?.specialistId ?? gig.specialistId;
  const specialist = specialistId ? getGigSpecialist(workspaceId, specialistId) : null;
  const lessons: GigLesson[] = [];
  if (specialist) {
    const derived = deriveGigLessons({
      arena: gig.arena,
      verdict: input.verdict,
      recipes: specialist.spec.recipes,
      evidence: (attempt?.deliverable?.evidence ?? []).map((e) => ({ kind: e.kind, passed: e.passed })),
      checklist: { keys: gigChecklist(gig.arena), ticked: attempt?.review?.checklist ?? null },
      feedbackText: input.feedbackText,
      scrubNames: [gig.org, gig.title],
      qualification: gig.qualification,
    });
    for (const d of derived) {
      const lesson = appendGigLesson(workspaceId, {
        outcomeId: outcome.id,
        recipe: d.recipe,
        arena: gig.arena,
        verdict: input.verdict,
        bullets: d.bullets,
      });
      if (lesson) lessons.push(lesson);
    }
  }

  return { ok: true, outcome, gig: current, statusMoved, correction, sourcePaused, lessons };
}

/** The gig's verdict history (oldest first) - a re-export so a route reads outcomes
 *  through the same module it records them with. */
export function listOutcomesForGig(workspaceId: string, gigId: string): GigOutcome[] {
  return listGigOutcomes(workspaceId, { gigId });
}
