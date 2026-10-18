import type { PipelineEntry } from "./db/core";
import { getPipelineEntry, hasEvent } from "./db/pipeline";
import { listOutboxFiltered } from "./db/devcase";
import {
  RELEASABLE_STATES,
  outreachLetterById,
  outreachLetterDraft,
  outreachLetterMarkFailed,
  outreachLetterMarkReleased,
  outreachLetterMarkSuppressed,
  type OutreachLetter,
} from "./db/outreach-letters";
import { dispatchOutreach } from "./comms-dispatch";
import { CommsBodyRejectedError, CommsSuppressedError } from "./comms";
import { resolveCommsLocale } from "./comms-locale";
import { commsTranslator } from "./comms-translator";

// Approve before first outreach (comms scope C2, backend half).
//
// The three outreach doors — the drawer's automation task, the board's batch outreach
// (tasks.ts batchOutreach) and the sourcing "Reach out" route — all run the `outreach`
// automation task, and that task used to SEND the letter the model had just written. It
// now only drafts: draftOutreachLetter() writes a held outreach_letters row and nothing
// leaves. A person approves one exact revision (db/outreach-letters.ts
// outreachLetterApprove, a CAS naming humanActor()), and releaseOutreachLetter() sends it.
//
// THE RELEASE IS THE ONLY SEND, and it goes through the same dispatchOutreach every
// outreach used: the consent gate (candidateOutreachSuppression) and the halted-sequence
// gate (outreachHaltFor, outreach-halt.ts) run first, then sendComm, carrying the
// message id minted at draft time — so the outbox row, the relay envelope and its
// Idempotency-Key all equal the draft's, and a retry after a dead letter re-sends the
// SAME message. Keyless, sendComm records a `queued` outbox row and makes no network
// call: the local outbox is the destination. The `outreach_sent` timeline event names
// the person who approved the letter.

/** Turn the model's outreach result into the letter that will be held for approval. The
 *  body is the model's; only the fallback subject localizes, in the CANDIDATE's language
 *  (the same rule dispatchOutreach applies). */
export async function composeOutreachDraft(
  entry: PipelineEntry,
  result: { subject?: unknown; body?: unknown }
): Promise<{ subject: string; body: string; lang: string }> {
  const lang = resolveCommsLocale(entry.locale, entry.workspaceId ?? undefined);
  const t = await commsTranslator(lang);
  const role = entry.jobTitle ?? t("aRole");
  const subject = String(result.subject ?? t("outreach.subjectFallback", { role })).trim();
  const body = String(result.body ?? "").trim();
  return { subject, body, lang };
}

/** Hold the drafted outreach for a person. Never sends. */
export async function draftOutreachLetter(
  entry: PipelineEntry,
  result: { subject?: unknown; body?: unknown },
  workspaceId: string
): Promise<{ letter: OutreachLetter; created: boolean; changed: boolean }> {
  const draft = await composeOutreachDraft(entry, result);
  return outreachLetterDraft({ entryId: entry.id, ...draft }, workspaceId);
}

export type OutreachReleaseResult =
  /** The letter left (`sent` to a relay) or landed in the keyless outbox (`queued`), or
   *  the relay dead-lettered it (`failed`, state delivery_failed — retry re-sends the same
   *  message id). All three are a 200: the release ran and the delivery says what it did. */
  | { ok: true; letter: OutreachLetter; delivery: "sent" | "queued" | "failed" }
  | {
      ok: false;
      status: 404 | 409 | 422;
      code: "PIPELINE_ENTRY_NOT_FOUND" | "PIPELINE_MOVE_CONFLICT" | "COMMS_SUPPRESSED" | "OUTREACH_BODY_TOO_LONG";
      extra?: Record<string, unknown>;
    };

/** A `sent` or `queued` outbox row for this application's outreach under `messageId`. */
function messageDelivered(entryId: string, messageId: string, workspaceId: string): boolean {
  return listOutboxFiltered({ ref: entryId, kind: "outreach", limit: 500 }, workspaceId).some(
    (m) => m.messageId === messageId && (m.status === "sent" || m.status === "queued")
  );
}

// Same-process single-flight per letter: two clicks on Release must not both pass the
// state check and send twice. The Idempotency-Key is the receiver's second line; this is
// ours. Released on completion and on failure, so a dead letter can be retried.
const releasing = new Set<string>();

/**
 * Release an APPROVED outreach letter. `actor` is the person clicking release (a
 * `human:` token, as humanActor() returns); the timeline names the APPROVER, who owns the
 * text that went out.
 */
export async function releaseOutreachLetter(letterId: string, workspaceId: string, actor: string): Promise<OutreachReleaseResult> {
  if (typeof actor !== "string" || !actor.startsWith("human:")) {
    throw new TypeError("an outreach letter is released by a human actor (human:…)");
  }
  const letter = outreachLetterById(letterId, workspaceId);
  if (!letter) return { ok: false, status: 404, code: "PIPELINE_ENTRY_NOT_FOUND" };
  const entry = getPipelineEntry(letter.entryId, workspaceId);
  if (!entry) return { ok: false, status: 404, code: "PIPELINE_ENTRY_NOT_FOUND" };
  if (!RELEASABLE_STATES.includes(letter.state) || letter.erasedAt || letter.body == null || releasing.has(letter.id)) {
    return { ok: false, status: 409, code: "PIPELINE_MOVE_CONFLICT", extra: { state: letter.state } };
  }
  // A first touch is sent once. The marker is written only by a delivered outreach, so it
  // being here means this letter (or an older direct send) already reached the person —
  // close the row truthfully instead of sending a second first-contact.
  if (hasEvent(entry.id, "outreach_sent", workspaceId)) {
    const closed = outreachLetterMarkReleased(letter.id, workspaceId) ?? letter;
    return { ok: false, status: 409, code: "PIPELINE_MOVE_CONFLICT", extra: { state: closed.state } };
  }
  // …and the marker is not the only way this message can have landed. A dead-lettered
  // release leaves a `failed` outbox row the Comms Center can resend (/api/comms/[id]/
  // resend) under the SAME message id, which records no `outreach_sent` and leaves the
  // letter at delivery_failed. A delivered row carrying this letter's message id means it
  // reached the person: close the row instead of sending it again.
  if (messageDelivered(entry.id, letter.messageId, workspaceId)) {
    const closed = outreachLetterMarkReleased(letter.id, workspaceId) ?? letter;
    return { ok: false, status: 409, code: "PIPELINE_MOVE_CONFLICT", extra: { state: closed.state } };
  }

  releasing.add(letter.id);
  try {
    let outcome;
    try {
      outcome = await dispatchOutreach(
        entry,
        { subject: letter.subject ?? undefined, body: letter.body },
        { messageId: letter.messageId, actor: letter.approvedBy ?? actor }
      );
    } catch (err) {
      // The channel's own send gate (commsSendSuppression) can still refuse after the
      // dispatcher's pre-checks: the same suppression, reported the same way.
      if (err instanceof CommsSuppressedError) {
        outreachLetterMarkSuppressed(letter.id, workspaceId);
        return { ok: false, status: 409, code: "COMMS_SUPPRESSED", extra: { suppressed: err.reason } };
      }
      // Over the length cap after cleaning: deterministic, nothing was recorded, and the
      // letter stays approved — a retry of the same text cannot succeed.
      if (err instanceof CommsBodyRejectedError) return { ok: false, status: 422, code: "OUTREACH_BODY_TOO_LONG" };
      throw err;
    }
    if (outcome.sent) {
      const released = outreachLetterMarkReleased(letter.id, workspaceId) ?? letter;
      return { ok: true, letter: released, delivery: outcome.status };
    }
    if (outcome.reason === "delivery_failed") {
      // A relay dead letter is NOT a consent refusal: the person can be contacted, this
      // attempt did not land. The approval stands and a retry re-sends the same message.
      const failed = outreachLetterMarkFailed(letter.id, workspaceId) ?? letter;
      return { ok: true, letter: failed, delivery: "failed" };
    }
    // Consent expired, erased, or a halted sequence (replied / manual / the candidate's
    // own opt-out). dispatchOutreach already recorded `outreach_suppressed` on the timeline.
    outreachLetterMarkSuppressed(letter.id, workspaceId);
    return { ok: false, status: 409, code: "COMMS_SUPPRESSED", extra: { suppressed: outcome.reason } };
  } finally {
    releasing.delete(letter.id);
  }
}
