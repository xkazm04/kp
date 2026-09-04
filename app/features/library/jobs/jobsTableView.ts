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
import type { Job } from "./JobsTypes";

export type JobSortCol = "title" | "location" | "mode" | "seniority" | "family" | "salary" | "entry";

/** The band's floor, or null when the role carries no usable band. */
export function bandFloor(band?: number[]): number | null {
  return band && band.length >= 2 && typeof band[0] === "number" ? band[0] : null;
}

/** Entry-eligibility as a sortable number: the graduate-friendliness share for an
 *  eligible role, and null — not 0 — for one that is not eligible or was never
 *  profiled. "Not eligible" and "eligible, scored 0%" are different facts, and
 *  only the second belongs in the ranking. */
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
  entry: (j) => entryScore(j),
};
