import { getGig, transitionGig } from "../db/gigs";
import { getGigAttempt, transitionGigAttempt } from "../db/gigs-attempts";
import { dispatchGigAttempt, type DispatchGigAttemptResult, type DispatchGigDeps } from "./dispatch";
import {
  GIG_DISCLOSURE_ITEM,
  type Gig,
  type GigAttempt,
  type GigAttemptStatus,
  type GigReview,
  type GigReviewAction,
  type GigStatus,
} from "./types";

// The operator's review desk: what each review action does to the attempt AND its gig.
// Store-backed, synchronous except `revise`, whose re-dispatch is the one network call
// (made by dispatch.ts OUTSIDE any transaction, after the revision request is recorded).
//
//   action     attempt                               gig
//   ---------  ------------------------------------  ---------------------------------
//   approve    drafted -> approved (review stored)   drafted -> in_review
//   revise     drafted|approved -> revision_requested (the note is required and stored),
//              then a NEW attempt carrying the note is dispatched (dispatch.ts), which
//              claims the gig drafted|in_review -> dispatched
//   discard    drafted|approved -> discarded          drafted|in_review -> qualified
//   mark_sent  approved -> sent (sentAt = now)        in_review -> sent
//              REFUSED (GIG_DISCLOSURE_REQUIRED) unless the effective review - this
//              request's, else the one stored at approve - ticks GIG_DISCLOSURE_ITEM.
//
// Every move is a compare-and-swap through the WP1 stores. An attempt not in a state the
// action starts from answers GIG_ACTION_NOT_ALLOWED; a CAS lost to a concurrent move
// answers GIG_STATE_CHANGED (re-read, never forced).

const FROM: Readonly<Record<GigReviewAction, readonly GigAttemptStatus[]>> = {
  approve: ["drafted"],
  revise: ["drafted", "approved"],
  discard: ["drafted", "approved"],
  mark_sent: ["approved"],
};

const REVIEW_NOTE_MAX = 4000;
const REVIEW_CHECKLIST_MAX_KEYS = 50;

export type GigReviewInputBody = {
  checklist?: unknown;
  note?: unknown;
  reviewMs?: unknown;
};

/** A client review body made into a GigReview: boolean ticks only (at most 50 keys, each
 *  a short key), a bounded note, a finite non-negative duration. Null when no review was
 *  sent at all. */
export function normalizeGigReview(body: unknown, now: Date = new Date()): GigReview | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as GigReviewInputBody;
  const checklist: Record<string, boolean> = {};
  if (b.checklist && typeof b.checklist === "object" && !Array.isArray(b.checklist)) {
    for (const [k, v] of Object.entries(b.checklist as Record<string, unknown>)) {
      if (Object.keys(checklist).length >= REVIEW_CHECKLIST_MAX_KEYS) break;
      if (typeof v === "boolean" && /^[a-z][a-z0-9_]{0,63}$/.test(k)) checklist[k] = v;
    }
  }
  const note = typeof b.note === "string" && b.note.trim() ? b.note.trim().slice(0, REVIEW_NOTE_MAX) : null;
  const reviewMs =
    typeof b.reviewMs === "number" && Number.isFinite(b.reviewMs) && b.reviewMs >= 0 ? Math.round(b.reviewMs) : null;
  return { checklist, note, reviewMs, reviewedAt: now.toISOString() };
}

export type GigReviewRefusal =
  | "GIG_ATTEMPT_NOT_FOUND"
  | "GIG_ACTION_NOT_ALLOWED"
  | "GIG_STATE_CHANGED"
  | "GIG_DISCLOSURE_REQUIRED"
  | "GIG_REVISION_NOTE_REQUIRED";

export type ApplyGigReviewResult =
  | {
      ok: true;
      action: GigReviewAction;
      attempt: GigAttempt;
      gig: Gig | null;
      /** revise only: the re-dispatch's own answer (its refusal does not undo the
       *  revision request, which stands as the operator's decision). */
      dispatch?: DispatchGigAttemptResult;
    }
  | { ok: false; code: GigReviewRefusal; detail?: string };

export type ApplyGigReviewDeps = {
  dispatch?: DispatchGigDeps;
  now?: () => Date;
};

function moveGig(workspaceId: string, gigId: string, from: GigStatus | readonly GigStatus[], to: GigStatus): Gig | null {
  const moved = transitionGig(workspaceId, gigId, { from, to });
  return moved.ok ? moved.gig : getGig(workspaceId, gigId);
}

export async function applyGigReview(
  workspaceId: string,
  attemptId: string,
  action: GigReviewAction,
  reviewBody: unknown,
  deps: ApplyGigReviewDeps = {}
): Promise<ApplyGigReviewResult> {
  const now = deps.now ? deps.now() : new Date();
  const attempt = getGigAttempt(workspaceId, attemptId);
  if (!attempt) return { ok: false, code: "GIG_ATTEMPT_NOT_FOUND" };
  if (!FROM[action].includes(attempt.status)) return { ok: false, code: "GIG_ACTION_NOT_ALLOWED", detail: attempt.status };
  const review = normalizeGigReview(reviewBody, now);

  if (action === "approve") {
    const res = transitionGigAttempt(workspaceId, attempt.id, {
      from: "drafted",
      to: "approved",
      patch: review ? { review } : undefined,
    });
    if (!res.ok) return { ok: false, code: res.reason === "not_found" ? "GIG_ATTEMPT_NOT_FOUND" : "GIG_STATE_CHANGED" };
    return { ok: true, action, attempt: res.attempt, gig: moveGig(workspaceId, attempt.gigId, "drafted", "in_review") };
  }

  if (action === "discard") {
    const res = transitionGigAttempt(workspaceId, attempt.id, {
      from: FROM.discard,
      to: "discarded",
      patch: review ? { review } : undefined,
    });
    if (!res.ok) return { ok: false, code: res.reason === "not_found" ? "GIG_ATTEMPT_NOT_FOUND" : "GIG_STATE_CHANGED" };
    return { ok: true, action, attempt: res.attempt, gig: moveGig(workspaceId, attempt.gigId, ["drafted", "in_review"], "qualified") };
  }

  if (action === "mark_sent") {
    const effective = review ?? attempt.review;
    if (effective?.checklist?.[GIG_DISCLOSURE_ITEM] !== true) return { ok: false, code: "GIG_DISCLOSURE_REQUIRED" };
    const gig = getGig(workspaceId, attempt.gigId);
    // The gig must be waiting on THIS review: an approved attempt on a gig that moved on
    // (withdrawn, declined) is not sendable.
    if (!gig || gig.status !== "in_review") return { ok: false, code: "GIG_ACTION_NOT_ALLOWED", detail: gig?.status ?? "missing" };
    const res = transitionGigAttempt(workspaceId, attempt.id, {
      from: "approved",
      to: "sent",
      patch: { review: effective, sentAt: now.toISOString() },
    });
    if (!res.ok) return { ok: false, code: res.reason === "not_found" ? "GIG_ATTEMPT_NOT_FOUND" : "GIG_STATE_CHANGED" };
    return { ok: true, action, attempt: res.attempt, gig: moveGig(workspaceId, attempt.gigId, "in_review", "sent") };
  }

  // revise
  const note = review?.note ?? null;
  if (!note) return { ok: false, code: "GIG_REVISION_NOTE_REQUIRED" };
  const res = transitionGigAttempt(workspaceId, attempt.id, {
    from: FROM.revise,
    to: "revision_requested",
    patch: { review, revisionNote: note },
  });
  if (!res.ok) return { ok: false, code: res.reason === "not_found" ? "GIG_ATTEMPT_NOT_FOUND" : "GIG_STATE_CHANGED" };
  // OUTSIDE any transaction: the recorded revision request is what bridges the gap.
  const dispatch = await dispatchGigAttempt(workspaceId, attempt.gigId, { revisionNote: note }, deps.dispatch);
  return { ok: true, action, attempt: res.attempt, gig: getGig(workspaceId, attempt.gigId), dispatch };
}
