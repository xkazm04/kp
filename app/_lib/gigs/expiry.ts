// The expiry sweep: a gig still waiting on the operator (`new` or `qualified`) whose stated
// deadline has passed moves to `expired`. It runs at the start of every gig scan
// (gigs/scan.ts), so the desk stops offering work that can no longer be submitted, and the
// scan summary carries the count.
//
// What it deliberately leaves alone:
//   - every other status. Work already in flight (`dispatched`, `drafted`, `in_review`) is
//     the send-time lint's to judge - the operator may still be allowed a late submission,
//     and pulling a gig out from under a running agent is not a clock's decision; `suspect`
//     waits on the operator's review; the terminal states never move.
//   - an undated gig, or one whose deadline does not parse. "No deadline known" is not
//     "past its deadline".
//
// Every move is the ordinary CAS (db/gigs.ts transitionGig): the SQL re-asserts the status
// the sweep read, so a gig the operator dispatched between the read and the write is left
// where it went (`stale`) and simply not counted. Tenancy: every read and write is bound to
// `workspaceId`.
//
// Paging: the store's list is newest-touched first with a keyset cursor on `updated_at`;
// the sweep walks it in pages of GIG_EXPIRY_PAGE until a short page. Two rows that share an
// `updated_at` exactly at a page boundary can be read on neither page - such a gig is
// swept by the next scan, which is the sweep's cadence anyway.

import { listGigs, transitionGig } from "../db/gigs";
import type { Gig, GigStatus } from "./types";

/** The statuses a passed deadline expires. */
export const GIG_EXPIRABLE_STATUSES: readonly GigStatus[] = ["new", "qualified"];
/** Rows read per page (the store's maximum). */
export const GIG_EXPIRY_PAGE = 200;
/** Pages walked per sweep at most - a bound, never expected to bind (10 000 open gigs). */
const MAX_PAGES = 50;

export type GigExpiryDeps = {
  listGigs: typeof listGigs;
  transitionGig: typeof transitionGig;
};

function defaultDeps(): GigExpiryDeps {
  return { listGigs, transitionGig };
}

/** True when the gig's stated deadline is strictly before `nowMs`. Pure. */
export function gigDeadlinePassed(gig: Pick<Gig, "deadlineAt">, nowMs: number): boolean {
  if (typeof gig.deadlineAt !== "string" || !gig.deadlineAt) return false;
  const at = Date.parse(gig.deadlineAt);
  return Number.isFinite(at) && at < nowMs;
}

/** Move every `new`/`qualified` gig of this workspace whose deadline is before `now` to
 *  `expired`. Answers how many moved; a lost race (the gig moved meanwhile) is skipped. */
export function sweepExpiredGigs(workspaceId: string, now: Date | string = new Date(), deps: GigExpiryDeps = defaultDeps()): number {
  const nowMs = typeof now === "string" ? Date.parse(now) : now.getTime();
  if (!Number.isFinite(nowMs)) return 0;
  const due: string[] = [];
  let before: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const rows = deps.listGigs(workspaceId, { statuses: GIG_EXPIRABLE_STATUSES, limit: GIG_EXPIRY_PAGE, before });
    for (const gig of rows) {
      if (gigDeadlinePassed(gig, nowMs)) due.push(gig.id);
    }
    if (rows.length < GIG_EXPIRY_PAGE) break;
    before = rows[rows.length - 1].updatedAt;
  }
  // Moved AFTER the walk: a move rewrites `updated_at`, which is the cursor's own column.
  // `from` is both expirable statuses, so a gig qualified in the meantime still expires,
  // while one dispatched in the meantime is `stale` and left alone.
  let expired = 0;
  for (const id of due) {
    const moved = deps.transitionGig(workspaceId, id, { from: GIG_EXPIRABLE_STATUSES, to: "expired" });
    if (moved.ok) expired += 1;
  }
  return expired;
}
