// P2-2 — input coercion for the bulk scheduling-invite endpoint. High-volume
// hiring (retail/hospitality/e-commerce, hundreds of reqs) couldn't invite a
// cohort to self-schedule in one action — only the per-candidate POST existed.
// This bounds + sanitizes the entry-id set so a bulk request can't be unbounded
// or carry duplicates that would mint two links for the same candidate.

import { isDeliverableAddress } from "./comms-recipient";

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

/** The fields `candidateRecipient` consults. Kept structural so this planner
 *  never imports the dispatcher (or any DB module). */
export type BulkInviteTarget = {
  contact?: string | null;
  candidateLabel?: string | null;
  candidateId?: string | null;
};

function bulkInviteRecipient(entry: BulkInviteTarget): string {
  return (entry.contact ?? "").trim() || (entry.candidateLabel ?? "").trim() || (entry.candidateId ?? "").trim() || "candidate";
}

/** Split a cohort into people a relay can mail, people it would dead-letter, and
 *  inviteable overflow past `cap`. Addressability uses the same cascade + check
 *  as outbound comms; it does NOT refuse an opted-out candidate — schedule mail
 *  is transactional and still owed. Pure, no DB. */
export function partitionBulkInviteTargets<T extends BulkInviteTarget>(
  entries: readonly T[],
  cap: number = BULK_INVITE_CAP
): { inviteable: T[]; unaddressable: T[]; overflow: T[] } {
  const inviteable: T[] = [];
  const unaddressable: T[] = [];
  for (const entry of entries) {
    if (isDeliverableAddress(bulkInviteRecipient(entry))) inviteable.push(entry);
    else unaddressable.push(entry);
  }
  return {
    inviteable: inviteable.slice(0, cap),
    unaddressable,
    overflow: inviteable.slice(cap),
  };
}
