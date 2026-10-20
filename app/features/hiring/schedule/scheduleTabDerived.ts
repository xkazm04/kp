// The two derived lists the Schedule tab renders from, lifted out of useScheduleTab.ts
// (/perfect 2026-09-03, schedule-ui-2). Both were inline `useMemo` bodies inside a
// "use client" hook — the tab's two most consequential filters, and neither had a test.
//
// Pure and data-only, so they are unit-pinnable: no React, no store import (the
// ScheduleInvite type is type-only, so better-sqlite3 stays out of the client bundle).

import { interviewScoringState, type InterviewScoringRow, type InterviewScoringState } from "@/app/_lib/interview-scoring-state";
import { isoToDateSlot } from "@/app/_lib/schedule-slots";
import type { ScheduleInvite } from "@/app/_lib/schedule-store";
import type { SchedEntry } from "./ScheduleTypes";

/** A read-only occupied cell on the week grid. */
export type BookedMarker = { id: string; dateSlot: string; candidateLabel: string };

export type SchedInterviewedEntry = SchedEntry & {
  scoringState?: InterviewScoringState;
};

/** Confirmed invites drawn as READ-ONLY occupied cells.
 *
 *  The point of this list: a candidate who self-booked through their own token has
 *  usually advanced out of the pending list, so nothing on the grid would show their
 *  hour — and the recruiter would book straight over it. Every confirmed invite with a
 *  resolvable instant therefore occupies its cell.
 *
 *  Excluded: an invite whose entry is ALREADY drawn as an assignable chip
 *  (`calendarEntryIds`), which would otherwise render the same candidate twice in the
 *  same cell; and an invite whose `slotAt` does not resolve to a grid cell, which has
 *  nowhere to be drawn. An invite with NO entry id is kept — it is exactly the
 *  self-booked/orphaned case the list exists for. */
export function bookedMarkersFrom(
  invites: readonly ScheduleInvite[],
  calendarEntryIds: ReadonlySet<string>
): BookedMarker[] {
  const out: BookedMarker[] = [];
  for (const i of invites) {
    if (i.status !== "confirmed" || !i.slotAt) continue;
    if (i.entryId && calendarEntryIds.has(i.entryId)) continue;
    const dateSlot = isoToDateSlot(i.slotAt);
    if (dateSlot === null) continue;
    out.push({ id: i.token, dateSlot, candidateLabel: i.candidateLabel ?? "—" });
  }
  return out;
}

/** Candidates who have HAD their interview and are waiting on a verdict.
 *
 *  Voice interviews with saved transcripts (scored, actively scoring, or unscored and
 *  waiting on re-score) PLUS recruiter-filled human scorecards. A human-led round
 *  produces no transcript at all, so a transcript-only test made every human-led candidate
 *  vanish from the tab the moment their verdict gated the entry to `scorecard_review`.
 *  An unscored voice interview is admitted so recruiters can trigger Re-score. */
export function interviewedEntriesFrom(
  entries: readonly SchedEntry[],
  interviews: Record<string, InterviewScoringRow | { hasTranscript: boolean } | undefined>,
  prepared: Record<string, { hasHumanScorecard: boolean } | undefined>,
  nowMs?: number
): SchedInterviewedEntry[] {
  const out: SchedInterviewedEntry[] = [];
  for (const e of entries) {
    const row = interviews[e.id];
    const rowState = row ? interviewScoringState(row as InterviewScoringRow, nowMs) : "not_scorable";

    if (rowState === "unscored" || rowState === "scoring") {
      out.push({ ...e, scoringState: rowState });
    } else if (
      e.approvalKind === "scorecard_review" &&
      (rowState === "scored" || row?.hasTranscript === true || prepared[e.id]?.hasHumanScorecard === true)
    ) {
      out.push({ ...e, scoringState: "scored" });
    }
  }
  return out;
}
