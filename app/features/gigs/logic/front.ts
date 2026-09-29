import type { Gig, GigAttempt, GigStatus } from "@/app/_lib/gigs/types";
import { deadlineView } from "./facts";

// ---------------------------------------------------------------------------
// The front page: what waits on the operator, and in which order
// ---------------------------------------------------------------------------

/** The front page's index columns, in the order they are read: work closest to done
 *  first. `record` (a verdict to record) appears only while something is out. */
export const FRONT_COLUMNS = ["ready", "proof", "quar", "record"] as const;
export type FrontColumn = (typeof FRONT_COLUMNS)[number];

export const COLUMN_STATUS: Readonly<Record<FrontColumn, GigStatus>> = {
  ready: "in_review",
  proof: "drafted",
  quar: "suspect",
  record: "sent",
};

export function frontColumnOf(status: GigStatus): FrontColumn | null {
  for (const c of FRONT_COLUMNS) if (COLUMN_STATUS[c] === status) return c;
  return null;
}

/** Ties within one deadline: the move closest to done goes first. */
const STEP_WEIGHT: Readonly<Record<FrontColumn, number>> = { ready: 0, proof: 1, quar: 2, record: 3 };

function waitingSince(gig: Gig, latest: GigAttempt | null): string {
  if (gig.status === "sent") return latest?.sentAt ?? latest?.updatedAt ?? gig.updatedAt;
  return latest?.createdAt ?? gig.updatedAt;
}

/** Every gig that waits on the operator, most urgent first: the nearest OPEN deadline
 *  first (a gig with no deadline, or one already closed, after every dated one), then the
 *  move closest to done (send, review, clear, record), then the one waiting longest. The
 *  header's "First", the lead proof and `N` all read this one order. */
export function urgencyQueue(gigs: readonly Gig[], attemptsByGig: Readonly<Record<string, GigAttempt>>, now: Date): Gig[] {
  const rows = gigs.flatMap((g) => {
    const col = frontColumnOf(g.status);
    if (!col) return [];
    const d = deadlineView(g.deadlineAt, now);
    const dated = d.state === "soon" || d.state === "open";
    const at = dated ? Date.parse(g.deadlineAt as string) : Number.POSITIVE_INFINITY;
    return [{ g, at, w: STEP_WEIGHT[col], since: waitingSince(g, attemptsByGig[g.id] ?? null) }];
  });
  rows.sort((a, b) => a.at - b.at || a.w - b.w || (a.since < b.since ? -1 : a.since > b.since ? 1 : a.g.id < b.g.id ? -1 : 1));
  return rows.map((r) => r.g);
}

/** The index columns, each in the urgency order. */
export function frontColumns(gigs: readonly Gig[], attemptsByGig: Readonly<Record<string, GigAttempt>>, now: Date): Record<FrontColumn, Gig[]> {
  const out: Record<FrontColumn, Gig[]> = { ready: [], proof: [], quar: [], record: [] };
  for (const g of urgencyQueue(gigs, attemptsByGig, now)) out[frontColumnOf(g.status)!].push(g);
  return out;
}

export type WaitCounts = { clear: number; review: number; send: number; record: number; total: number };

/** The header's "wait on you": the three judgements and the verdicts to record. Work
 *  sitting with an agent or the scan never pads it. */
export function waitCounts(cols: Readonly<Record<FrontColumn, readonly Gig[]>>): WaitCounts {
  const clear = cols.quar.length;
  const review = cols.proof.length;
  const send = cols.ready.length;
  const record = cols.record.length;
  return { clear, review, send, record, total: clear + review + send + record };
}

/** `N`: the gig after the one last opened in the urgency order, wrapping round; the first
 *  when nothing was opened yet; null when nothing waits. */
export function nextInQueue(queue: readonly Gig[], lastGigId: string | null): Gig | null {
  if (queue.length === 0) return null;
  const at = lastGigId ? queue.findIndex((g) => g.id === lastGigId) : -1;
  return queue[(at + 1) % queue.length];
}

/** The nearest open deadline among the gigs that wait on the operator, or null. */
export function firstClosing(queue: readonly Gig[], now: Date): { gig: Gig; days: number } | null {
  for (const g of queue) {
    const d = deadlineView(g.deadlineAt, now);
    if (d.state === "soon" || d.state === "open") return { gig: g, days: Math.max(0, d.days) };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Walking a list from a proof: ← / →
// ---------------------------------------------------------------------------

export type ListPosition = { prev: string | null; next: string | null; index: number; total: number };

/** Where a gig sits in the list its proof was opened from. No wrap: the ends answer null.
 *  Null when the gig is not in the list (it moved out of it after a write). */
export function listNeighbours(ids: readonly string[], id: string): ListPosition | null {
  const i = ids.indexOf(id);
  if (i < 0) return null;
  return { prev: i > 0 ? ids[i - 1] : null, next: i < ids.length - 1 ? ids[i + 1] : null, index: i + 1, total: ids.length };
}

/** After a decline or a write that moves the gig out of its list: the next gig, else the
 *  previous, else nothing (the front page). */
export function afterLeavingList(pos: ListPosition | null): string | null {
  return pos?.next ?? pos?.prev ?? null;
}
