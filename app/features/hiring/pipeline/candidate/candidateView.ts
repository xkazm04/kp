// The candidate modal's view state — which candidate is open, which cohort its
// pager walks, which tab is showing — and the pure transitions over it. The modal
// replaced the candidate drawer; this is the one piece of state PipelineTab holds
// for it. Pure, so the "a refresh keeps your place" rules are unit-tested.

import type { SchedEntry } from "@/app/features/hiring/schedule/ScheduleTypes";
import type { Entry } from "@/app/features/shared/pipelineTypes";

/** Every action lives in the modal's footer, so the tabs are only what there is to READ. */
export const CANDIDATE_TABS = ["overview", "activity", "record"] as const;
export type CandidateTab = (typeof CANDIDATE_TABS)[number];

export function isCandidateTab(value: unknown): value is CandidateTab {
  return typeof value === "string" && (CANDIDATE_TABS as readonly string[]).includes(value);
}

export type CandidateView = {
  entry: Entry;
  /** The pager's cohort. Null = the board's visible order (the tab supplies it). */
  cohort: readonly Entry[] | null;
  tab: CandidateTab;
};

export type ShowCandidateOptions = { cohort?: readonly Entry[] | null; tab?: CandidateTab };

/**
 * Open, swap or close the candidate.
 *
 * An option left out KEEPS what the open view had: an in-place refresh after a
 * stage move, a prev/next step or a rematch link hands in only the new entry, and
 * the recruiter must stay on the tab and in the cohort they were reading. A fresh
 * open (nothing showing) starts on Overview with the board's cohort.
 */
export function nextCandidateView(
  prev: CandidateView | null,
  entry: Entry | null,
  opts: ShowCandidateOptions = {},
): CandidateView | null {
  if (!entry) return null;
  return {
    entry,
    cohort: opts.cohort !== undefined ? opts.cohort : (prev?.cohort ?? null),
    tab: opts.tab ?? prev?.tab ?? "overview",
  };
}

/** The transcript modal's SchedEntry, adapted from the board record. It reads only
 *  id/candidateLabel/jobTitle and fetches the session itself; the approval fields
 *  are not on the board row and are unused by the modal, so they degrade to null. */
export function schedEntryOf(entry: Entry): SchedEntry {
  return {
    id: entry.id,
    candidateId: entry.candidateId,
    candidateLabel: entry.candidateLabel,
    archetype: entry.archetype,
    roleFamily: entry.roleFamily,
    jobId: entry.jobId,
    jobTitle: entry.jobTitle,
    stage: entry.stage,
    matchScore: entry.matchScore ?? null,
    status: entry.status,
    approvalKind: null,
    approvalDetail: null,
  };
}
