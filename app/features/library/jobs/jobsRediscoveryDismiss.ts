// The rediscovery feed's reversible dismiss, as pure state transitions
// (lot JW, wave 22).
//
// Dismiss is optimistic: the row leaves the list before the PATCH lands, so the
// panel must remember enough to put it back — the row AND the index it sat at,
// not just the id. That much already existed inline in the hook.
//
// What did not: the add flow dismisses a row a beat AFTER marking it added, so a
// rollback restored a row that was still in the `added` set. It then rendered the
// green "Added ✓" badge and the red "Couldn't dismiss that match" note at the
// same time — two contradictory claims about one candidate. `dropAddedMark` is
// the other half of the rollback: the row comes back WITHOUT its badge, and the
// note is the only thing the feed is asserting.

export type RemovedRow<A> = { row: A; index: number };

/** Optimistically take `id` out of the list, remembering where it was. Returns
 *  the SAME array reference when nothing matched, so a no-op cannot re-render. */
export function extractRow<A extends { id: string }>(
  alerts: A[] | null,
  id: string
): { next: A[] | null; removed: RemovedRow<A> | null } {
  if (!alerts) return { next: alerts, removed: null };
  const index = alerts.findIndex((a) => a.id === id);
  if (index < 0) return { next: alerts, removed: null };
  return { next: alerts.filter((a) => a.id !== id), removed: { row: alerts[index], index } };
}

/** Put a removed row back at its old position. Idempotent: if the list already
 *  regained the row (a sweep landed while the PATCH was in flight) it is left
 *  alone rather than duplicated. */
export function restoreRow<A extends { id: string }>(
  alerts: A[] | null,
  removed: RemovedRow<A> | null
): A[] | null {
  if (!alerts || !removed) return alerts;
  if (alerts.some((a) => a.id === removed.row.id)) return alerts;
  const next = [...alerts];
  // The list may have shrunk since (other dismissals) — clamp rather than
  // splicing past the end, which would silently append.
  next.splice(Math.min(removed.index, next.length), 0, removed.row);
  return next;
}

/** Drop one candidate's "Added ✓" mark. Called with the candidate whose DEFERRED
 *  dismiss failed; `undefined` for a manual dismiss, which never marked anything. */
export function dropAddedMark(added: ReadonlySet<string>, candidateId: string | null | undefined): Set<string> {
  const next = new Set(added);
  if (candidateId) next.delete(candidateId);
  return next;
}
