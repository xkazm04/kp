// STUB (spark analyze-v2-cohort): final signatures; WP1 implements.
import type { CohortClaims } from "./cohortTypes";
import type { ProjectedMember } from "./cohortProject";

export function neutralOrder(cohortId: string, memberIds: string[]): string[] {
  void cohortId;
  return [...memberIds];
}

export function computeCohortClaims(
  members: ProjectedMember[],
  cohortId: string
): { claims: CohortClaims; fitRank: Map<string, number>; decoyOf: Map<string, string>; neutralIndex: Map<string, number> } {
  void members;
  void cohortId;
  throw new Error("cohortClaims: not implemented (WP1)");
}
