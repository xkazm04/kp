// MAY WE CONTACT THIS CANDIDATE — asked BEFORE a door mints them a link.
//
// `commsSendSuppression` (comms.ts) is the ONE send predicate the channel enforces:
// consent lapsed or erased refuses every candidate-facing kind, and the outreach
// SEQUENCE halt (they opted out / answered / a recruiter stopped it) refuses `outreach`
// only. But it runs inside `sendComm` — i.e. after a door has already minted a live
// capability link. The bulk and single scheduling-invite routes, the AI-interview
// arrival hook and the homework arrival hook each asked a narrower question first
// (status, or addressability), minted, and only then met the gate as a thrown
// `CommsSuppressedError` in a best-effort catch — so a candidate whose consent had
// lapsed but who had not yet been swept by `anonymizeExpiredConsents` still received a
// working /schedule/<token> on the recruiter's copy panel, a reserved voice session, or
// a published apply token, and the bulk result counted the invite as sent.
//
// This module is the pre-mint question, in two halves:
//
//   • `contactVerdict` — PURE. Orders every reason a candidate cannot be written to by
//     how irreversible it is: an AI agent on the slate (no mailbox, ever) ▸ consent
//     lapsed / erased (the send gate's own verdict) ▸ the outreach halt, for kind
//     `outreach` only ▸ unaddressable (no deliverable address — the copy panel is
//     still a legitimate fallback, so it carries NO refusal code).
//   • `entryContactability` — the adapter. It gathers the suppression fact by ASKING
//     THE SEND GATE (`commsSendSuppression`), never by re-deriving consent: one
//     predicate, so "suppressed" here means exactly what the Outbox would say.
//
// Verdict-then-mint is a read followed by a write with no lock between them — by
// design. The dispatch-time gate in `sendComm` stays as the RE-CHECK, so a consent
// that lapses between this verdict and the send is still refused at the channel.

import { commsSendSuppression } from "./comms";
import { AGENT_POPULATION, isDeliverableAddress, resolveCandidateRecipient } from "./comms-recipient";

/** The send-gate reasons that apply to EVERY candidate-facing kind. */
export type ConsentSuppression = "anonymized" | "consent_expired";

/** What the verdict is computed from. `contact` is the RESOLVED recipient (the
 *  cascade in comms-recipient.ts), `halt` the outreach sequence's halt reason. */
export type ContactFacts = {
  population?: string | null;
  contact: string | null;
  suppression?: ConsentSuppression | null;
  halt?: string | null;
};

export type ContactRefusalReason = "agent_population" | ConsentSuppression | "unaddressable" | (string & {});

/** `code` is present exactly when the SEND GATE refuses — the one code
 *  (`COMMS_SUPPRESSED`, already in REFUSAL_ERRORS and all four catalogs) a door answers
 *  with. An agent or an unaddressable person carries none: each door already has its
 *  own vocabulary for those, and an unaddressable human still gets a copyable link. */
export type ContactVerdict =
  | { ok: true }
  | { ok: false; reason: ContactRefusalReason; code?: "COMMS_SUPPRESSED" };

const OUTREACH_KIND = "outreach";

/** Whether (and why not) a candidate may be sent a message of `kind`. Pure. */
export function contactVerdict(facts: ContactFacts, kind: string): ContactVerdict {
  if ((facts.population ?? "").trim().toLowerCase() === AGENT_POPULATION) {
    return { ok: false, reason: "agent_population" };
  }
  if (facts.suppression) return { ok: false, reason: facts.suppression, code: "COMMS_SUPPRESSED" };
  if (kind === OUTREACH_KIND && facts.halt) return { ok: false, reason: facts.halt, code: "COMMS_SUPPRESSED" };
  if (!isDeliverableAddress(facts.contact)) return { ok: false, reason: "unaddressable" };
  return { ok: true };
}

/** The fields the adapter reads off a pipeline entry. */
export type ContactableEntry = {
  id: string;
  workspaceId?: string | null;
  contact?: string | null;
  candidateLabel?: string | null;
  candidateId?: string | null;
  population?: string | null;
};

/** The verdict for one pipeline entry and one message kind, with the suppression fact
 *  taken from THE send gate (`commsSendSuppression`) asked the way `sendComm` will ask
 *  it — so the pre-mint answer and the send-time answer cannot disagree. That gate
 *  fails CLOSED on an unreadable store, and so does this. */
export function entryContactability(entry: ContactableEntry, kind: string): ContactVerdict {
  const contact = resolveCandidateRecipient(entry);
  const gate = commsSendSuppression({
    to: contact ?? "",
    subject: "",
    body: "",
    kind,
    ref: entry.id,
    workspaceId: entry.workspaceId ?? null,
  });
  const suppression = gate === "anonymized" || gate === "consent_expired" ? gate : null;
  return contactVerdict(
    { population: entry.population ?? null, contact, suppression, halt: suppression ? null : gate },
    kind
  );
}
