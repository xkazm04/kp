// The candidate modal's view state — which candidate is open, which cohort its
// pager walks, which tab is showing — and the pure transitions over it. The modal
// replaced the candidate drawer; this is the one piece of state PipelineTab holds
// for it. Pure, so the "a refresh keeps your place" rules are unit-tested.

import { stageHasRole, type StageDef } from "@/app/_lib/pipeline-stages";
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

/** Does this candidate's action bar offer the human interview scorecard?
 *
 *  The form lives in the prep modal, and the Schedule tab opens that modal only from
 *  its human-round branch. The shipped plan runs an AI round alone, so a recruiter
 *  with no LLM key, whose candidates can never finish a voice interview, had no way
 *  to record the rating the offer rests on. Read by column ROLE, the same predicate
 *  the scorecard POST gates on, so a renamed interview column keeps its door. */
export function offersHumanScorecard(entry: Pick<Entry, "stage" | "status">, axis: readonly StageDef[]): boolean {
  return entry.status === "active" && stageHasRole(entry.stage, "interview", axis);
}

/** May a recruiter draft this offer by hand? The AI action needs an analyzed profile and
 *  this does not. Same conditions the server's draft_offer action refuses on. */
export function offersManualOfferDraft(entry: Pick<Entry, "stage" | "status" | "approvalKind">, axis: readonly StageDef[]): boolean {
  return entry.status === "active" && entry.approvalKind == null && stageHasRole(entry.stage, "offer", axis);
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
