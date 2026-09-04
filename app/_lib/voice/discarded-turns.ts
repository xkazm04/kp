// Telling a DUPLICATE apart from a LOSER at the completion door.
//
// /api/interview/complete answered every "this session is already finished" case
// with `{ok: true, alreadyCompleted: true}`. That is exactly right for the honest
// duplicate — the End fetch and the unload beacon both fire, a flaky network
// retries, a stashed body is replayed on the next mount — and a retrying client
// must settle rather than error.
//
// But the SAME reply was given to a second live call on the same link: a call
// with its own conversation, its own minutes, its own turns, none of which are
// in the stored transcript. Its candidate hung up, read "saved", and their
// interview did not exist. `ok: true` is a green lie there, and the route had no
// way to see the difference because it never compared the two transcripts.
//
// The rule is the comparison, not the count: a body whose turns the stored
// transcript ALREADY CONTAINS, in order, from the start, is a duplicate — the
// same call, possibly snapshotted a turn or two earlier by the beacon. Anything
// else is a different conversation, and every turn in it is being dropped.
//
// Pure and separate from the route so both halves can be pinned without a DB, a
// request, or a provider (the shape voice/finalize-status.ts established).

/** The minimum turn shape this comparison needs. Deliberately structural: the
 *  incoming body is untrusted and already clamped by the route, so this must not
 *  depend on VoiceTurn's optional fields. */
type ComparableTurn = { role?: string; text?: string };

function sameTurn(a: ComparableTurn, b: ComparableTurn): boolean {
  return a.role === b.role && (a.text ?? "") === (b.text ?? "");
}

/** How many of `incoming`'s turns would be LOST if it is not persisted, given
 *  what is already stored.
 *
 *  0 — nothing is lost: an empty body (a beacon from a call that never spoke), or
 *      a body the stored transcript already contains from its first turn on (the
 *      duplicate POST / earlier snapshot of the SAME call).
 *  n — `incoming.length`: a transcript that diverges from — or extends — what is
 *      stored is a DIFFERENT conversation, and refusing it drops all of it. Its
 *      whole length is reported rather than the diverging tail, because the
 *      candidate is not told "we kept part of your interview": none of their
 *      call is in the record that gets scored. */
export function discardedTurnCount(stored: ComparableTurn[] | null | undefined, incoming: ComparableTurn[]): number {
  if (incoming.length === 0) return 0;
  const have = stored ?? [];
  // Longer than what is stored ⇒ it carries turns the record does not have, even
  // if the shared prefix matches. That is the second-tab case whose extra turns
  // are exactly what would be lost.
  if (incoming.length > have.length) return incoming.length;
  for (let i = 0; i < incoming.length; i += 1) {
    if (!sameTurn(incoming[i], have[i])) return incoming.length;
  }
  return 0;
}
