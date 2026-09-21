// The corpus table's ordering contract — the per-column value extractors the
// shared sort engine (app/_components/table/useTableSort) reads.
//
// Pure and separate from the table so the rules are testable without React, and
// so the two facts this table gets wrong when hand-rolled stay stated once:
//
//  · A MISSING value is not a small value. A role with no location, no band and
//    no entry profile must sort to the BOTTOM in both directions rather than
//    leading an ascending sort — `compareCells` already does that, but only if
//    the accessor hands it `null` instead of `""` or `0`.
//  · A salary BAND sorts by its floor. That is the number a recruiter compares
//    ("what does this role start at"), and it is stable when two roles share a
//    ceiling; sorting by the midpoint would make an 40–200k outlier outrank a
//    120–140k role on a column headed "Salary".

import type { SortAccessors } from "@/app/_components/table/useTableSort";
import { roleStatusRank } from "./jobsRoleStatus";
import type { Job } from "./JobsTypes";

export type JobSortCol = "title" | "location" | "mode" | "seniority" | "family" | "salary" | "status";

/** The band's floor, or null when the role carries no usable band. */
export function bandFloor(band?: number[]): number | null {
  return band && band.length >= 2 && typeof band[0] === "number" ? band[0] : null;
}

/** Entry-eligibility as a sortable number: the graduate-friendliness share for an
 *  eligible role, and null — not 0 — for one that is not eligible or was never
 *  profiled. "Not eligible" and "eligible, scored 0%" are different facts, and
 *  only the second belongs in the ranking.
 *
 *  No longer a COLUMN — the eighth column is the role's own status since the desk
 *  became the register of open and historical roles — but still the one honest
 *  reading of the entry profile as a number, and the entry-eligible share is still
 *  a stat chip above the table. Kept here, beside the other accessors, rather than
 *  re-derived at whatever surface needs it next. */
export function entryScore(job: Job): number | null {
  const ep = job.entryProfile;
  if (!ep?.isEntryEligible) return null;
  return typeof ep.graduateFriendliness === "number" ? ep.graduateFriendliness : null;
}

export const JOB_SORT_ACCESSORS: SortAccessors<Job, JobSortCol> = {
  title: (j) => j.title || null,
  location: (j) => j.location || null,
  mode: (j) => j.workMode || null,
  seniority: (j) => j.seniority || null,
  family: (j) => j.roleFamily || null,
  salary: (j) => bandFloor(j.salaryBand),
  // The role's own lifecycle, ranked in the desk's READING order (open → draft →
  // filled → closed) rather than alphabetically: what a recruiter wants from an
  // ascending sort on this column is "everything still to be worked first, the
  // history last", which no alphabetisation of the labels gives in any of the four
  // locales. Never null — every role has a status, so this column has no bottom
  // bucket.
  status: (j) => roleStatusRank(j),
};
