// WHO IS ON THIS BOARD — the one predicate the header counts by and the rail
// names by (/perfect 2026-09-03, pipeline-board-3).
//
// The pipeline tab stacks two answers to the same question. The "Today" rail
// (PipelineTodayRail) counted REAL rows — the guided demo's `(SIM)`-marked
// residue excluded, gsim-l2-105 — whose `status === "active"`. The stat header's
// `activeCount` / `staleCount` counted every row NOT standing on a terminal-role
// stage: sim rows included, and every rejected or withdrawn candidate still
// parked on "Screened" included, because nothing moves a rejected card off its
// column. Mid-demo, or on any board with a few un-tidied rejections, the header
// said "Active 14" directly above a rail that named four people — and the aging
// chip aged rows the rail had already written off.
//
// Neither predicate was tested. Both now come from here, so they cannot drift
// again: `boardPopulation` is the membership rule, `deriveRailRows` is the
// bucketing built on top of it. Pure and import-free of React, so the node
// runner loads it directly (pipelineBoardPopulation.test.ts).

import { isSimTitle } from "@/app/features/shell/simulation/constants";
import { DEFAULT_STAGE_AXIS, stageHasRole, stageWithRole, type StageDef } from "@/app/_lib/pipeline-stages";
import type { Entry } from "@/app/features/shared/pipelineTypes";
import type { WorkspaceTabId } from "@/app/features/shell/tabs";

const DAY_MS = 86_400_000;
/** How long a hire stays "this week's news" on the rail. */
export const HIRED_WINDOW_DAYS = 7;

export type BoardPopulation = {
  /** Every row that is real hiring data — the demo's own artifacts removed. The
   *  board still RENDERS sim rows (visibly marked) so a running simulation can
   *  see itself; they are simply never counted or narrated as real work. */
  real: Entry[];
  /** The live funnel: real rows the pipeline is still working. A rejected or
   *  withdrawn candidate is real history, not live work, whatever column their
   *  card happens to be sitting on. */
  active: Entry[];
};

export function boardPopulation(entries: Entry[] | null | undefined): BoardPopulation {
  const real = (entries ?? []).filter((e) => !isSimTitle(e.jobTitle));
  return { real, active: real.filter((e) => e.status === "active") };
}

export type RailBucketKey = "inbound" | "scorecards" | "offerReviews" | "awaitingSlot" | "offersOut" | "hired";

export type RailBucket = {
  key: RailBucketKey;
  entries: Entry[];
  /** An in-board stage focus (the resolved column id on THIS workspace's axis)… */
  stage?: string;
  /** …or a cross-tab jump. Exactly one of the two is set. */
  tab?: WorkspaceTabId;
};

/**
 * The rail's buckets, in display order, non-empty only.
 *
 * Stage questions resolve by ROLE on the workspace's own axis (pipeline-stages),
 * never by the shipped names — a board whose offer column is called anything else
 * read 0 offers out forever (UAT KAT-L1-002).
 *
 * `now` is injected so the 7-day hired window is deterministic in tests.
 */
export function deriveRailRows(
  entries: Entry[] | null | undefined,
  axis: readonly StageDef[] = DEFAULT_STAGE_AXIS,
  now: number = Date.now()
): RailBucket[] {
  const { real, active } = boardPopulation(entries);
  const entryStage = stageWithRole("entry", axis);
  const offerStage = stageWithRole("offer", axis);
  const terminalStage = stageWithRole("terminal", axis);

  const inbound = active.filter((e) => stageHasRole(e.stage, "entry", axis));
  const scorecards = active.filter((e) => e.approvalKind === "scorecard_review");
  const offerReviews = active.filter((e) => e.approvalKind === "offer_review");
  const awaitingSlot = active.filter((e) => e.approvalKind === "calendar");
  // Offers out WITH the candidate: sent, no approval pending on our side.
  const offersOut = active.filter((e) => stageHasRole(e.stage, "offer", axis) && !e.approvalKind);
  // Reads `real`, not `active`: a hire's status legitimately leaves "active" while
  // the hire is still this week's news.
  const hired = real.filter((e) => {
    if (!stageHasRole(e.stage, "terminal", axis)) return false;
    const changed = e.stageChangedAt ? Date.parse(e.stageChangedAt) : NaN;
    if (!Number.isFinite(changed)) return false;
    return Math.floor((now - changed) / DAY_MS) <= HIRED_WINDOW_DAYS;
  });

  // The `&& <stage>` guards only satisfy the type: a non-empty bucket means at
  // least one entry stands on a column carrying that role, so the id is never null
  // when there is a row to show.
  const all: (RailBucket | null)[] = [
    inbound.length > 0 && entryStage ? { key: "inbound", entries: inbound, stage: entryStage } : null,
    scorecards.length > 0 ? { key: "scorecards", entries: scorecards, tab: "decisions" } : null,
    offerReviews.length > 0 ? { key: "offerReviews", entries: offerReviews, tab: "decisions" } : null,
    awaitingSlot.length > 0 ? { key: "awaitingSlot", entries: awaitingSlot, tab: "schedule" } : null,
    offersOut.length > 0 && offerStage ? { key: "offersOut", entries: offersOut, stage: offerStage } : null,
    hired.length > 0 && terminalStage ? { key: "hired", entries: hired, stage: terminalStage } : null,
  ];
  return all.filter((r): r is RailBucket => r !== null);
}
