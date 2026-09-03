// The board's optimistic-move machine — pure, so node --test can pin it.
//
// usePipelineBoardData owns the ONLY mutator of the entries array, and its
// drag-to-move is the densest decision in the tab: paint the move immediately, POST
// with the card's PRIOR stage as `expectedStage` (the CAS guard the bulk move and the
// AI actions share), then take ONE of three paths depending on what comes back —
// APPLY the row the route hands us, RECONCILE against the server, or ROLL BACK and
// say why on the card. All three were inline in a 60-line async function with three
// early returns and a catch, which is precisely the shape that acquires a fourth path
// nobody notices. The choice, the optimistic restage and the field-selective merge
// live here now; the hook keeps the fetch, the state sets and the error copy.
//
// The merge is deliberately field-SELECTIVE: the route answers with the raw store row,
// not the score-stamped board projection, so a whole-object swap blanks the card's
// canonicalScore/transferScore and visibly changes the badge.

import type { Entry } from "@/app/features/shared/pipelineTypes";

/** What the server row (if any) tells the board to do after a set_stage POST. */
export type MoveOutcome =
  /** The route handed back a usable moved row — apply it, no board refetch. */
  | { kind: "applied"; entry: Partial<Entry> }
  /** A 2xx with no usable row (an older route, an unparseable body): don't trust the
   *  optimistic write, re-read the board. */
  | { kind: "reconcile" }
  /** A refusal (or a throw): put the card back where it was, name the reason, and
   *  reconcile — a lost CAS means somebody else moved the row, so our view is suspect. */
  | { kind: "rollback" };

/** The one decision. `ok` is the HTTP verdict; `serverEntry` is `body.entry` (or null
 *  when the body was absent/unparseable). A row without a string `stage` is not a
 *  usable row — applying it would write `undefined` into the column key. */
export function moveOutcome(ok: boolean, serverEntry: Partial<Entry> | null | undefined): MoveOutcome {
  if (!ok) return { kind: "rollback" };
  if (serverEntry && typeof serverEntry.stage === "string") return { kind: "applied", entry: serverEntry };
  return { kind: "reconcile" };
}

/** The optimistic paint AND its rollback — the same transform in both directions, so
 *  a rollback can never diverge from the move it undoes. Returns the SAME array when
 *  the id isn't present (a card that vanished under a concurrent poll), so React bails
 *  out rather than re-bucketing the whole board for nothing. */
export function restageEntries(entries: Entry[] | null, id: string, stage: string): Entry[] | null {
  if (!entries) return entries;
  if (!entries.some((e) => e.id === id && e.stage !== stage)) return entries;
  return entries.map((e) => (e.id === id ? { ...e, stage } : e));
}

/** Apply the route's moved row onto the board — ONLY the fields a set_stage can
 *  change. Everything else (the score stamps the projection added, the notes, the
 *  GitHub evidence) is kept from the card we already drew. */
export function mergeMovedRow(entries: Entry[] | null, id: string, server: Partial<Entry>): Entry[] | null {
  if (!entries) return entries;
  return entries.map((e) =>
    e.id === id
      ? {
          ...e,
          stage: server.stage as string,
          stageChangedAt: server.stageChangedAt ?? e.stageChangedAt,
          status: server.status ?? e.status,
          // A move can CLEAR an approval (the row is no longer awaiting one), so these
          // two are not `?? e.x` — an absent field means "no approval", not "keep".
          approvalKind: server.approvalKind ?? null,
          approvalDetail: server.approvalDetail ?? null,
        }
      : e
  );
}

/** The poll's content-equality gate: commit only when the rendered content actually
 *  changed. `last === null` (nothing committed yet, or an optimistic write just
 *  invalidated the record) always commits. */
export function shouldCommitBoard(next: string, last: string | null): boolean {
  return last === null || next !== last;
}
