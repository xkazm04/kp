// P2-2 — input coercion for the bulk scheduling-invite endpoint. High-volume
// hiring (retail/hospitality/e-commerce, hundreds of reqs) couldn't invite a
// cohort to self-schedule in one action — only the per-candidate POST existed.
// This bounds + sanitizes the entry-id set so a bulk request can't be unbounded
// or carry duplicates that would mint two links for the same candidate.

import { isDeliverableAddress, resolveCandidateRecipient } from "./comms-recipient";

/** Hard ceiling on one bulk invite — generous for a real cohort, a backstop
 *  against an accidental "invite everyone in a 10k pool" request. */
export const BULK_INVITE_CAP = 100;

/** Deduped, trimmed, non-empty string ids, capped at {@link BULK_INVITE_CAP}.
 *  Pure + order-preserving (first occurrence wins) so it's directly unit-tested
 *  and the endpoint never loops over junk. */
export function coerceBulkEntryIds(raw: unknown, cap: number = BULK_INVITE_CAP): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const id = v.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= cap) break;
  }
  return out;
}

/** The fields the recipient cascade consults — resolved through THE cascade in
 *  comms-recipient.ts (the one comms-dispatch's `candidateRecipient` applies), never a
 *  private copy of it. Structural, so this planner stays pure and DB-free. */
export type BulkInviteTarget = {
  contact?: string | null;
  candidateLabel?: string | null;
  candidateId?: string | null;
  population?: string | null;
};

/** A send-gate verdict for one target, as the caller asks it (comms-contactability.ts's
 *  `entryContactability`). Only a CODED refusal matters here — consent lapsed, erased —
 *  because addressability is decided below through the same cascade; `null` = no gate. */
export type BulkInviteSendGate<T> = (entry: T) => { ok: boolean; code?: string } | null;

/** Split a cohort into people a relay can mail, people the SEND GATE refuses
 *  (`suppressed` — consent lapsed or erased; asked FIRST, because it is the
 *  irreversible reason), people it would dead-letter, and inviteable overflow past
 *  `cap`. Addressability uses the same cascade + check as outbound comms; it does NOT
 *  refuse an opted-out candidate — schedule mail is transactional and still owed, and
 *  the send gate agrees (its halt applies to `outreach` only). Pure, no DB: the gate is
 *  handed in by the route. */
export function partitionBulkInviteTargets<T extends BulkInviteTarget>(
  entries: readonly T[],
  cap: number = BULK_INVITE_CAP,
  sendGate: BulkInviteSendGate<T> = () => null
): { inviteable: T[]; suppressed: T[]; unaddressable: T[]; overflow: T[] } {
  const inviteable: T[] = [];
  const suppressed: T[] = [];
  const unaddressable: T[] = [];
  for (const entry of entries) {
    const gate = sendGate(entry);
    if (gate && !gate.ok && gate.code) suppressed.push(entry);
    else if (isDeliverableAddress(resolveCandidateRecipient(entry))) inviteable.push(entry);
    else unaddressable.push(entry);
  }
  return {
    inviteable: inviteable.slice(0, cap),
    suppressed,
    unaddressable,
    overflow: inviteable.slice(cap),
  };
}
