import { createHash } from "node:crypto";
import { HUMAN_ROLE_ACTOR, isNamedApprover } from "./auth/operator-approver";

// The approval BINDING of a held first-contact outreach (comms scope C2, night package 3).
//
// An approval used to be a state flip on (id, revision): the release then sent whatever the
// row and the application said at send time. The revision covered the text — every edit
// bumps it — but not the RECIPIENT (read off the application's contact when the letter
// leaves) and not the approver's identity (`human:recruiter`, the bare role, was accepted as
// an approver). So the gate is now a binding the send seam re-derives:
//
//   - WHO: the approver is a NAMED person — `human:<name>` where the name is a real identity
//     or the deployment's KP_OPERATOR_NAME, never the role token and never the "single-
//     operator deployment" placeholder (namedOutreachApprover).
//   - WHAT: a digest of exactly what will leave — letter id, message id, recipient, subject,
//     body and the language it renders in — computed when the person approves and stored
//     on the row (outreach_letters.approved_digest). dispatchOutreach recomputes it from the
//     row and the application it is about to send to, and refuses on any difference
//     (outreachSendRefusal). The legal footers are NOT in the digest: they carry capability
//     tokens minted at send time, so they cannot be byte-identical to the preview by design;
//     they are kp's own template text, not anything the approver wrote or edited.
//
// Pure apart from node:crypto, so the store, the release and the dispatcher share ONE
// definition and the tests can pin it without a database.

/** The digest scheme. A row approved under another scheme (or before digests existed) does
 *  not match and is re-closed at the send seam. */
export const OUTREACH_APPROVAL_SCHEME = "kp.outreach-approval/1";

/** What an approval covers. Every field is what the send path reads. */
export type OutreachApprovalContent = {
  letterId: string;
  messageId: string;
  /** candidateRecipient(entry) at approval / at send; null = no recipient exists. */
  recipient: string | null;
  subject: string | null;
  body: string | null;
  lang: string;
};

/** The digest of an approval's content. JSON array framing, so no field can bleed into the
 *  next (a subject ending in the body's first word hashes differently from the split). */
export function outreachApprovalDigest(c: OutreachApprovalContent): string {
  const framed = JSON.stringify([OUTREACH_APPROVAL_SCHEME, c.letterId, c.messageId, c.recipient, c.subject, c.body, c.lang]);
  return `v1:${createHash("sha256").update(framed, "utf8").digest("hex")}`;
}

/** Does this actor token name a PERSON? `human:` plus a name that is neither the role token
 *  (`human:recruiter`, what humanActor() answers for a session without identity) nor the
 *  deployment placeholder. An automation actor (`auto:…`, `engine:…`) never qualifies. */
export function namedOutreachApprover(actor: string | null | undefined): boolean {
  if (typeof actor !== "string" || !actor.startsWith("human:")) return false;
  if (actor === HUMAN_ROLE_ACTOR) return false;
  return isNamedApprover(actor.slice("human:".length));
}

/** Why the send seam refuses a letter, as the wire code the release door answers with. */
export type OutreachSendRefusal =
  /** No letter, not this application's, erased, or not in a state an approval covers. */
  | "OUTREACH_LETTER_CONFLICT"
  /** Approved, but not by a named person, or the text / recipient / language moved since. */
  | "OUTREACH_APPROVAL_STALE";

/** The approval-bearing fields of a letter row the seam reads. */
export type OutreachGateLetter = {
  id: string;
  entryId: string;
  state: string;
  subject: string | null;
  body: string | null;
  lang: string;
  messageId: string;
  approvedBy: string | null;
  approvedDigest: string | null;
  erasedAt: string | null;
};

/** States an approval still covers: approved, or a release of it that did not land. */
const APPROVED_STATES: ReadonlySet<string> = new Set(["approved", "delivery_failed", "suppressed"]);

/**
 * The ONE predicate the send seam asks (comms-dispatch.ts dispatchOutreach): may THIS row be
 * sent to THIS application's recipient right now? Null = yes. Pure.
 */
export function outreachSendRefusal(
  letter: OutreachGateLetter | null,
  entryId: string,
  recipient: string | null
): OutreachSendRefusal | null {
  if (!letter || letter.entryId !== entryId || letter.erasedAt || letter.subject == null || letter.body == null) {
    return "OUTREACH_LETTER_CONFLICT";
  }
  if (!APPROVED_STATES.has(letter.state)) return "OUTREACH_LETTER_CONFLICT";
  if (!namedOutreachApprover(letter.approvedBy) || !letter.approvedDigest) return "OUTREACH_APPROVAL_STALE";
  const now = outreachApprovalDigest({
    letterId: letter.id,
    messageId: letter.messageId,
    recipient,
    subject: letter.subject,
    body: letter.body,
    lang: letter.lang,
  });
  return now === letter.approvedDigest ? null : "OUTREACH_APPROVAL_STALE";
}

/** The outbox row a re-send door (Comms Center resend, backlog flush) is about to send
 *  again: `ref` is the application, `messageId` the letter's own message identity. */
export type OutreachResendRow = { ref?: string | null; messageId?: string | null };

/**
 * May a stored `outreach` outbox row be sent AGAIN, to `recipient`? Null = yes. Pure.
 *
 * The rule: the original approval covers the identical message to the identical approved
 * recipient - the row must be this application's letter (the message id minted with it),
 * the approval must still stand and name a person, and the digest of the letter with
 * `recipient` must equal the stored one. A corrected address nobody approved fails the
 * digest; so does a letter whose approval was since cleared (re-opened, edited, erased).
 * The re-send never re-opens the letter: it sends nothing and the letter stays as it is.
 */
export function outreachResendRefusal(
  letter: OutreachGateLetter | null,
  row: OutreachResendRow,
  recipient: string | null
): "OUTREACH_RESEND_NOT_APPROVED" | null {
  const refused = "OUTREACH_RESEND_NOT_APPROVED" as const;
  if (!letter || !row.ref || letter.entryId !== row.ref || letter.erasedAt) return refused;
  if (!row.messageId || letter.messageId !== row.messageId) return refused;
  if (!namedOutreachApprover(letter.approvedBy) || !letter.approvedDigest || letter.subject == null || letter.body == null) return refused;
  const digest = outreachApprovalDigest({
    letterId: letter.id,
    messageId: letter.messageId,
    recipient,
    subject: letter.subject,
    body: letter.body,
    lang: letter.lang,
  });
  return digest === letter.approvedDigest ? null : refused;
}

/** Thrown by the send seam when outreachSendRefusal answers. Nothing was sent or recorded. */
export class OutreachApprovalError extends Error {
  readonly code: OutreachSendRefusal;
  constructor(code: OutreachSendRefusal) {
    super(`outreach send refused: ${code}`);
    this.name = "OutreachApprovalError";
    this.code = code;
  }
}
