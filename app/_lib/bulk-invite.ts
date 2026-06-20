// P2-2 — input coercion for the bulk scheduling-invite endpoint. High-volume
// hiring (retail/hospitality/e-commerce, hundreds of reqs) couldn't invite a
// cohort to self-schedule in one action — only the per-candidate POST existed.
// This bounds + sanitizes the entry-id set so a bulk request can't be unbounded
// or carry duplicates that would mint two links for the same candidate.

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
