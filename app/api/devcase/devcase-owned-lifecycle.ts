// ONE OWNER GUARD FOR THE DEV-CASE BY-ID DOORS (/perfect 2026-09-02, api-devcase-1).
//
// Every id in this area is a globally-unique point-read key, not a per-tenant one:
// `getLifecycle(id)`, `getSubmission(id)` and `getDevCase(id)` will happily return
// another team's row. Three of the six by-id doors already knew that and each carried
// its own hand-written three-line comparison — feedback (`route.ts:23`), promote
// (`:23`), publish (`:22`). The other three did not: approve, close and redesign loaded
// a lifecycle by id and acted on it with NO workspace comparison at all, so a known
// lifecycle id from another studio could be approved into a live case, closed (which
// dispatches rejection notes to THEIR candidates), or redesigned — the last one debiting
// the CALLER's `case_designs` meter while rewriting someone else's brief.
//
// The rule is the same for all six, so it is written once here. Two properties matter
// and both come from having a single producer:
//
//   * A cross-tenant id answers exactly what a nonexistent one answers — the same 404,
//     same body. Anything else (403, a different message, a different status) turns the
//     route into an existence oracle for other teams' ids.
//   * The caller's tenant is compared, and the ROW's tenant still drives the writes.
//     `close` deliberately derives its posting enumeration and outbox filing from
//     `lc.workspaceId`; that stays. This guard only decides whether the caller may act
//     on the row at all.
//
// A sibling module rather than exports from a route file: Next's generated route types
// reject any non-handler export in a route module (backlog item 57).
import { getDevCase, getLifecycle, getSubmission, type DevCaseRecord, type DevSubmission, type LifecycleRecord } from "@/app/_lib/db/devcase";

/** The lifecycle `id` names, but only if `ws` owns it. `null` covers BOTH "no such
 *  lifecycle" and "not yours" — the caller answers one 404 for both, deliberately. */
export function ownedLifecycle(id: string, ws: string): LifecycleRecord | null {
  const lc = getLifecycle(id);
  return lc && lc.workspaceId === ws ? lc : null;
}

/** Same rule for a submission id (promote, feedback). */
export function ownedSubmission(id: string, ws: string): DevSubmission | null {
  const sub = getSubmission(id);
  return sub && sub.workspaceId === ws ? sub : null;
}

/** Same rule for a case id (publish). */
export function ownedDevCase(id: string, ws: string): DevCaseRecord | null {
  const kase = getDevCase(id);
  return kase && kase.workspaceId === ws ? kase : null;
}
