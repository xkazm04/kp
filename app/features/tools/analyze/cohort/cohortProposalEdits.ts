// The proposal tray's edit operations (Cohort Studio shell, WP3): remove a member, add one
// from the candidate population, the cap and the head-to-head floor, and the cost estimate
// recomputed after every edit. Pure, React-free; pinned by cohortProposalEdits.test.ts.
import {
  COHORT_CAP,
  COHORT_MIN,
  MEMBERSHIPS,
  type CohortProposal,
  type CohortRunRequest,
  type CohortView,
  type Membership,
  type ProposalMember,
} from "./cohortTypes.ts";

/** A member on the tray. `reuseKnown` is false for a hand-added candidate: whether an analysis
 *  of that CV against THIS role exists is the server's call, so the estimate treats it as fresh
 *  and says the count is an upper bound. */
export type TrayMember = ProposalMember & { reuseKnown: boolean };

export interface Tray {
  members: TrayMember[];
  /** Proposal members the recruiter took out, kept so they can be put back with their rule. */
  removed: TrayMember[];
}

/** The member-id prefix the server resolves to a saved profile's CV. */
export const PROFILE_MEMBER_PREFIX = "profile:";

export function trayFromProposal(p: CohortProposal): Tray {
  return { members: p.members.map((m) => ({ ...m, reuseKnown: true })), removed: [] };
}

export const trayIsFull = (tray: Tray): boolean => tray.members.length >= COHORT_CAP;

export function removeMember(tray: Tray, memberId: string): Tray {
  const gone = tray.members.find((m) => m.memberId === memberId);
  if (!gone) return tray;
  // A hand-added member leaves for good (the population still offers it); a proposal member
  // is kept aside so it can be put back as what it was (an applicant stays an applicant).
  const removed = gone.membership === "added" ? tray.removed : [...tray.removed, gone];
  return { members: tray.members.filter((m) => m.memberId !== memberId), removed };
}

export type AddRefusal = "cap" | "duplicate";

export function addMember(tray: Tray, member: TrayMember): { tray: Tray; refused: AddRefusal | null } {
  if (tray.members.some((m) => m.memberId === member.memberId)) return { tray, refused: "duplicate" };
  if (trayIsFull(tray)) return { tray, refused: "cap" };
  return {
    tray: { members: [...tray.members, member], removed: tray.removed.filter((m) => m.memberId !== member.memberId) },
    refused: null,
  };
}

/** Whether the run may be offered: ok, below the head-to-head floor, or nobody at all. */
export type RunVerdict = "ok" | "belowMin" | "empty";
export function runVerdict(tray: Tray): RunVerdict {
  if (tray.members.length === 0) return "empty";
  return tray.members.length < COHORT_MIN ? "belowMin" : "ok";
}

/** What the run would analyse fresh and what it reuses. `upperBound` = a hand-added member's
 *  reuse is unknown, so `fresh` is at most this many. */
export function freshEstimate(tray: Tray): { fresh: number; reused: number; upperBound: boolean } {
  const reused = tray.members.filter((m) => m.reuseKnown && m.reusable).length;
  return {
    fresh: tray.members.length - reused,
    reused,
    upperBound: tray.members.some((m) => !m.reuseKnown),
  };
}

/** The tray grouped by the rule that put each member there, in MEMBERSHIPS order. */
export function groupByMembership(members: readonly TrayMember[]): Array<{ membership: Membership; members: TrayMember[] }> {
  return MEMBERSHIPS.map((membership) => ({ membership, members: members.filter((m) => m.membership === membership) })).filter(
    (g) => g.members.length > 0
  );
}

/** The slice of a candidate-population row the add control needs (PopulationRow satisfies it). */
export interface PopulationLite {
  key: string;
  source: "profile" | "analysis";
  slug: string | null;
  id: string | null;
  name: string;
  seniority: string | null;
  analyses: ReadonlyArray<{ slug: string }>;
}

/** A population row as a hand-added member, or null when it has no analysed CV to compare
 *  (a hand-built profile: the server could not resolve it and would refuse the run). */
export function memberFromPopulation(row: PopulationLite): TrayMember | null {
  if (!row.slug) return null;
  return {
    memberId: row.slug,
    label: row.name,
    source: { kind: "analysis", slug: row.slug },
    membership: "added",
    roleFamily: null,
    seniority: row.seniority,
    matchScore: null,
    reusable: false,
    reuseKnown: false,
  };
}

/** Whether a population row is already on the tray under any of its ids (its newest analysis,
 *  an older analysis of the same CV, or its profile). The server refuses two ids of one CV. */
export function populationOnTray(row: PopulationLite, tray: Tray): boolean {
  const ids = new Set(tray.members.map((m) => m.memberId));
  if (row.slug && ids.has(row.slug)) return true;
  if (row.id && ids.has(`${PROFILE_MEMBER_PREFIX}${row.id}`)) return true;
  return row.analyses.some((a) => ids.has(a.slug));
}

/** The add control's offer: rows with an analysed CV, not on the tray, matching the query. */
export function populationOffer(rows: readonly PopulationLite[], tray: Tray, query: string, limit = 8): PopulationLite[] {
  const q = query.trim().toLocaleLowerCase();
  return rows
    .filter((r) => r.slug && !populationOnTray(r, tray) && (!q || r.name.toLocaleLowerCase().includes(q)))
    .slice(0, limit);
}

export function runRequest(jdSlug: string, tray: Tray, opts: { blind: boolean; reportLang: string }): CohortRunRequest {
  return {
    jdSlug,
    members: tray.members.map((m) => ({ memberId: m.memberId, membership: m.membership })),
    blind: opts.blind,
    reportLang: opts.reportLang,
  };
}

/** A failed cohort's retry: a NEW run with the same members, role, blindness and language. */
export function retryRequest(view: CohortView): CohortRunRequest {
  return {
    jdSlug: view.jdSlug,
    members: view.members.map((m) => ({ memberId: m.memberId, membership: m.membership })),
    blind: view.blind,
    reportLang: view.reportLang,
  };
}
