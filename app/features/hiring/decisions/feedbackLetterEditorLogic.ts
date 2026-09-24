// The pure half of the feedback-letter editor (spark interview-feedback-letter, WP-beta):
// what the length counter says, how a door's answer folds into "done" or a coded failure,
// which sentence a delivery outcome earns, and where a redraft stands. React-free so every
// rule the recruiter reads is pinned by feedbackLetterEditorLogic.test.ts.

import { LETTER_MAX_CHARS, type LetterDelivery } from "@/app/_lib/interview-letter-types";
import { letterTextProblem, type LetterTextProblem } from "@/app/_lib/interview-letter-policy";

/** The counter under the editor. Counts what the approve door will store — the text
 *  trimmed at its ends — so the cap is shown BEFORE the server refuses, never after. */
export type LetterLength = { length: number; max: number; over: number; problem: LetterTextProblem | null };

export function letterLength(text: string): LetterLength {
  const trimmed = text.trim();
  return {
    length: trimmed.length,
    max: LETTER_MAX_CHARS,
    over: Math.max(0, trimmed.length - LETTER_MAX_CHARS),
    problem: letterTextProblem(trimmed),
  };
}

/** What the approve door reports about the email, in the comms layer's own words. */
export type DeliveryOutcome = { delivery: LetterDelivery; suppressed: boolean; readableOnStatusPage: boolean };

/** A door that did not land: the machine code the reader's language resolves, the HTTP
 *  status (null when no response arrived at all), the capability a 403 names, and the
 *  letter's current state when the door says it moved. */
export type LetterDoorFailure = { code: string | null; status: number | null; capability?: string | null; state?: string | null };

export type LetterDoorResult =
  | { ok: true; delivery: DeliveryOutcome | null; taskId: string | null }
  | { ok: false; failure: LetterDoorFailure };

const DELIVERIES: ReadonlySet<string> = new Set(["sent", "queued", "failed"]);

function readDelivery(value: unknown): DeliveryOutcome | null {
  const d = value as { delivery?: unknown; suppressed?: unknown; readableOnStatusPage?: unknown } | null;
  if (!d || typeof d !== "object" || typeof d.delivery !== "string" || !DELIVERIES.has(d.delivery)) return null;
  return { delivery: d.delivery as LetterDelivery, suppressed: d.suppressed === true, readableOnStatusPage: d.readableOnStatusPage === true };
}

/** Fold one door's answer. `res` null = the request never landed (offline, aborted): a
 *  failure with no code, which the editor states as "that did not go through" rather than
 *  swallowing. A 2xx whose body is not the door's shape is a failure too — "approved" is
 *  claimed only on the door's own `ok: true`. */
export function foldLetterDoor(res: { ok: boolean; status: number } | null, body: unknown): LetterDoorResult {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (res && res.ok && b.ok === true) {
    return { ok: true, delivery: readDelivery(b.delivery), taskId: typeof b.taskId === "string" ? b.taskId : null };
  }
  return {
    ok: false,
    failure: {
      code: typeof b.code === "string" ? b.code : null,
      status: res ? res.status : null,
      capability: typeof b.capability === "string" ? b.capability : null,
      state: typeof b.state === "string" ? b.state : null,
    },
  };
}

/** Whether a failure means the list on screen is stale (the letter moved or is gone), so
 *  the queue should be read again. */
export function failureStalesQueue(failure: LetterDoorFailure): boolean {
  return failure.code === "FEEDBACK_LETTER_MOVED" || failure.code === "FEEDBACK_LETTER_NOT_FOUND";
}

/** The catalog keys (under decisions.feedbackLetters.editor) an approve outcome earns: the
 *  email's truth first, then whether the status page shows the letter. Never "sent" for a
 *  row the relay did not accept, and never a green line for a suppressed send. */
export type DeliveryNoticeKey = "doneSent" | "doneQueued" | "doneFailed" | "doneSuppressed";
export type ReadabilityNoticeKey = "doneReadable" | "doneUnreadable";

export function deliveryNotice(outcome: DeliveryOutcome): { email: DeliveryNoticeKey; page: ReadabilityNoticeKey } {
  const email: DeliveryNoticeKey = outcome.suppressed
    ? "doneSuppressed"
    : outcome.delivery === "sent"
      ? "doneSent"
      : outcome.delivery === "queued"
        ? "doneQueued"
        : "doneFailed";
  return { email, page: outcome.readableOnStatusPage ? "doneReadable" : "doneUnreadable" };
}

/** Where a redraft this editor asked for stands, from the task watcher's fields.
 *
 *   idle      nothing asked
 *   running   queued / running / its result still being fetched
 *   saved     a new draft is on the letter — the queue read brings it in
 *   notSaved  the task finished but stored nothing: the letter was decided or closed
 *   failed    the task failed (or was interrupted / cancelled); the old text stands
 *   unknown   the task finished but its record could not be fetched; read the queue and
 *             let the letter itself say whether a new draft landed
 *
 *  A redraft never blocks approving or declining: a late draft loses to a decision at the
 *  store's compare-and-swap, so nothing here has to wait. */
export type RedraftPhase = "idle" | "running" | "saved" | "notSaved" | "failed" | "unknown";

export function redraftPhase(
  taskId: string | null,
  watch: { status: string | null; active: boolean; loading: boolean; full: { result?: unknown } | null; resultUnavailable: boolean }
): RedraftPhase {
  if (!taskId) return "idle";
  if (watch.resultUnavailable) return "unknown";
  if (watch.status == null || watch.active || watch.loading) return "running";
  if (watch.status === "succeeded") {
    if (!watch.full) return "running";
    return (watch.full.result as { saved?: unknown } | null | undefined)?.saved === true ? "saved" : "notSaved";
  }
  return "failed";
}
