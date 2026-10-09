// STUB (spark analyze-v2-cohort): final signatures; WP1 implements.
import type { Analysis } from "@/app/_lib/schemas";
import type { CohortComments, CohortMember, CohortView, Membership, MemberRunState, RoleBand } from "./cohortTypes";

export interface ProjectInput {
  memberId: string;
  label: string;
  membership: Membership;
  runState: MemberRunState;
  analysisSlug: string | null;
  analysis: Analysis | null;
  blind: boolean;
  roleBand: RoleBand | null;
}
export type ProjectedMember = Omit<CohortMember, "neutralIndex" | "fitRank" | "decoyOf">;

export function projectCohortMember(input: ProjectInput): ProjectedMember {
  void input;
  throw new Error("cohortProject: not implemented (WP1)");
}

export function assembleCohortView(
  base: Omit<CohortView, "members" | "claims" | "narrative" | "progress">,
  members: ProjectedMember[],
  comments: CohortComments | null
): CohortView {
  void base;
  void members;
  void comments;
  throw new Error("cohortProject: not implemented (WP1)");
}
