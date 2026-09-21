// The Roles desk's status column, as pure rules.
//
// The table's eighth column used to be "Entry" — a yes/no fairness fact about the
// role's requirements. Useful, but it is not what a recruiter opens this desk to
// read: the desk is the register of OPEN and HISTORICAL roles, so the column that
// earns the width is the role's own lifecycle, with its progress against the number
// of people it has to hire.
//
// Nothing here touches React or the network, so the two rules that actually decide
// what a reader sees are testable on their own:
//
//  · FILLED IS DERIVED, never stored. A role is filled when its hired count reaches
//    its target, whether or not the post-commit auto-close has retired it yet. The
//    gap between the hire committing and the hook running is real (the hook runs
//    after the response), and during it a stored flag would contradict the count on
//    screen. See ROLE_STATUSES in app/_lib/status-tone.ts.
//  · A TARGET IS AT LEAST 1. A stored NULL means "never stated", which is the
//    default of one hire — so the progress fraction always has a reachable
//    denominator and "0 / 0" can never render.

import type { RoleStatus } from "@/app/_lib/status-tone";
import type { Job } from "./JobsTypes";

export type { RoleStatus };

/** The role's target, folded the same way the store folds it (db/jobs.ts
 *  `roleTargetHires`) — restated here because the client receives a decorated row,
 *  and a row that predates the column arrives with the field absent. */
export function targetHiresOf(job: Pick<Job, "targetHires">): number {
  const t = job.targetHires;
  return typeof t === "number" && Number.isFinite(t) && t >= 1 ? Math.trunc(t) : 1;
}

/** How many candidates this role has hired. Absent (the route did not decorate it)
 *  is 0 — an unknown count must never be presented as progress. */
export function hiredCountOf(job: Pick<Job, "hired">): number {
  const h = job.hired;
  return typeof h === "number" && Number.isFinite(h) && h > 0 ? Math.trunc(h) : 0;
}

/**
 * The role's status as the desk reads it.
 *
 * `jobs.status` NULL is the seeded corpus row, which is live by contract
 * (isJobOpenForApplications) — so it takes the same branch as 'published'. A draft
 * is a draft whatever its hired count says: a role that was never live cannot have
 * been filled BY that live period, and reading a stray pipeline entry as "filled"
 * would badge a role the recruiter has not even taken to market.
 */
export function roleStatusOf(job: Pick<Job, "status" | "targetHires" | "hired">): RoleStatus {
  if (job.status === "draft") return "draft";
  const reached = hiredCountOf(job) >= targetHiresOf(job);
  if (job.status === "closed") return reached ? "filled" : "closed";
  return reached ? "filled" : "open";
}

/** The sort key for the status column. Not alphabetical and not the stored value:
 *  the desk's own reading order is what a recruiter wants an ascending sort to give
 *  them — everything still to be worked first, the history last. */
const ROLE_STATUS_ORDER: Record<RoleStatus, number> = { open: 0, draft: 1, filled: 2, closed: 3 };

export function roleStatusRank(job: Pick<Job, "status" | "targetHires" | "hired">): number {
  return ROLE_STATUS_ORDER[roleStatusOf(job)];
}

/** The status values the column's filter menu offers, in the same reading order. */
export const ROLE_STATUS_FILTER_ORDER: readonly RoleStatus[] = ["open", "draft", "filled", "closed"];
