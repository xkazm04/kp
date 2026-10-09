// The walkthrough data mode's pure half (spark analyze-v2-cohort, round 2). The walkthrough
// runs the REAL role-first flow (role picker, tray, run sheet, comparison) against fixture data
// instead of the routes: keyless, nothing written, always works. This module owns what is not
// React: the fixture's shape, the simulated run's schedule (who lands when), and the view the
// comparison draws at any moment of that run. React-free; pinned by cohortWalkthroughModel.test.ts.
//
// The landed state of every member is the engine's committed output (cohort20.done.json); the
// not-yet-landed state is the running fixture's pending shape. Claims, ranks, decoys and the
// neutral order are re-decided by the engine's own computeCohortClaims over the members the
// recruiter actually kept, so removing someone never leaves a claim about a person not drawn.
import { COHORT_DIMENSIONS, type CohortMember, type CohortProposal, type CohortRunRequest, type CohortView } from "./cohortTypes.ts";
import { computeCohortClaims, hashSeed } from "./cohortClaims.ts";
import { blindLabel } from "./cohortProject.ts";
import type { PopulationLite } from "./cohortProposalEdits.ts";
import type { CohortRole } from "./useCohortLists.ts";

/** public/dev/cohort/walkthrough.json — written by fixture/buildWalkthroughFixture.ts. */
export interface WalkthroughFixture {
  /** The files every id and label was derived from. */
  source: string[];
  /** The role library the picker lists (the /api/jds row shape). */
  roles: CohortRole[];
  /** The proposal per role slug; a role nobody applied to and nobody matches has an empty one. */
  proposals: Record<string, CohortProposal>;
  /** Who the add control can seat by hand (the population rows not proposed). */
  population: PopulationLite[];
}

export const proposalFor = (fx: WalkthroughFixture, jdSlug: string): CohortProposal | null => fx.proposals[jdSlug] ?? null;

// ---- the schedule --------------------------------------------------------------------

/** How a member ends in the run: its runState in the finished fixture. */
export type SimOutcome = "reused" | "done" | "failed";
export const outcomeOf = (m: Pick<CohortMember, "runState">): SimOutcome =>
  m.runState === "reused" ? "reused" : m.runState === "failed" ? "failed" : "done";

export interface SimEntry {
  memberId: string;
  outcome: SimOutcome;
  /** From here the member is drawn analyzing (before it, waiting). */
  startAt: number;
  /** From here the member is drawn as it ended (its finished-fixture state). */
  landAt: number;
}
export interface SimPlan {
  entries: SimEntry[];
  /** From here the run is done. */
  doneAt: number;
  /** Every moment (ms after Start, > 0) at which the drawing changes — the clock's ticks. */
  beats: number[];
}

/** Reused analyses spend nothing and land first, all together. */
export const SIM_REUSED_AT = 700;
/** The fresh ones land in small batches spread over this window, then the run settles. */
export const SIM_FIRST_FRESH_AT = 2000;
export const SIM_LAST_FRESH_AT = 9600;
export const SIM_SETTLE_MS = 800;
/** "A few at a time": the batch sizes, cycled. */
const BATCH_SIZES = [2, 3, 1, 3, 2] as const;

const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * When each member lands. Reused first (at SIM_REUSED_AT), then the fresh ones (done and failed
 * alike — a failure is only known when it happens) in batches of 1-3 across the window, in a
 * seeded order that encodes no verdict (the member id's hash, never the rank or the tray order).
 * The batch about to land is drawn analyzing; the rest wait. Reduced motion: everyone lands at
 * once and the run is done at once — no clock at all.
 */
export function simSchedule(members: ReadonlyArray<{ memberId: string; outcome: SimOutcome }>, opts: { reducedMotion: boolean }): SimPlan {
  if (opts.reducedMotion) {
    return { entries: members.map((m) => ({ memberId: m.memberId, outcome: m.outcome, startAt: 0, landAt: 0 })), doneAt: 0, beats: [] };
  }
  const fresh = members
    .filter((m) => m.outcome !== "reused")
    .map((m) => m.memberId)
    .sort((a, b) => hashSeed(`walkthrough:${a}`) - hashSeed(`walkthrough:${b}`) || byId(a, b));
  const batchOf = new Map<string, number>();
  let batches = 0;
  for (let i = 0; i < fresh.length; batches++) {
    const size = BATCH_SIZES[batches % BATCH_SIZES.length];
    for (const id of fresh.slice(i, i + size)) batchOf.set(id, batches);
    i += size;
  }
  const gap = batches > 1 ? (SIM_LAST_FRESH_AT - SIM_FIRST_FRESH_AT) / (batches - 1) : 0;
  const landOf = (b: number) => Math.round(SIM_FIRST_FRESH_AT + b * gap);
  const entries = members.map((m): SimEntry => {
    const b = batchOf.get(m.memberId);
    if (b === undefined) return { memberId: m.memberId, outcome: m.outcome, startAt: SIM_REUSED_AT, landAt: SIM_REUSED_AT };
    return { memberId: m.memberId, outcome: m.outcome, startAt: b === 0 ? 0 : landOf(b - 1), landAt: landOf(b) };
  });
  const doneAt = (entries.length ? Math.max(...entries.map((e) => e.landAt)) : 0) + SIM_SETTLE_MS;
  const beats = [...new Set(entries.flatMap((e) => [e.startAt, e.landAt]).concat(doneAt))].filter((t) => t > 0).sort((a, b) => a - b);
  return { entries, doneAt, beats };
}

// ---- the view at a moment ------------------------------------------------------------

/** A not-yet-landed member's cells / detail / why: the running fixture's own pending shape. */
export type PendingShape = Pick<CohortMember, "cells" | "detail" | "why">;

export function pendingShape(running: CohortView): PendingShape {
  const p = running.members.find((m) => m.runState === "queued");
  if (p) return { cells: p.cells, detail: p.detail, why: p.why };
  // A running fixture with nobody waiting: the same shape, built (absent "pending", no detail, no why).
  const none = Object.fromEntries(COHORT_DIMENSIONS.map((d) => [d, null]));
  return {
    cells: Object.fromEntries(
      COHORT_DIMENSIONS.map((d) => [d, { dimension: d, rating: null, tier: "absent", absentReason: "pending", label: { key: "none" } }])
    ) as CohortMember["cells"],
    detail: none as CohortMember["detail"],
    why: none as CohortMember["why"],
  };
}

export interface WalkthroughRun {
  /** The finished fixture: every member's landed state, and the role's facts. */
  done: CohortView;
  pending: PendingShape;
  /** What the run sheet started (the edited tray, blind, language). */
  request: CohortRunRequest;
}

/** Blind: letters by neutral order, and GitHub is not read (the run sheet's promise). */
function blinded(m: CohortMember): CohortMember {
  if (m.runState === "failed" || m.cells.publicWork.absentReason === "pending") return m;
  return {
    ...m,
    cells: { ...m.cells, publicWork: { dimension: "publicWork", rating: null, tier: "absent", absentReason: "blind", label: { key: "none" } } },
    detail: { ...m.detail, publicWork: null },
    why: { ...m.why, publicWork: null },
  };
}

/** The run holds exactly the fixture's members, unblinded: only then were its written parts made for it. */
export function isFixtureSet(run: WalkthroughRun): boolean {
  const ids = new Set(run.request.members.map((m) => m.memberId));
  return !run.request.blind && ids.size === run.done.members.length && run.done.members.every((m) => ids.has(m.memberId));
}

/** The fixture's narrative and dimension notes are withheld (they name and count people not in this run). */
export const narrativeWithheld = (run: WalkthroughRun): boolean => run.done.narrative !== null && !isFixtureSet(run);

/**
 * The comparison `at` ms after Start. Members in the order the tray started them; each is its
 * finished-fixture state once landed (with the membership the tray gave it), else the pending
 * shape, analyzing or waiting. A member the fixture does not hold is not drawn (the fixture
 * test pins that every member the walkthrough can seat is there).
 */
export function simView(run: WalkthroughRun, plan: SimPlan, at: number): CohortView {
  const fixed = new Map(run.done.members.map((m) => [m.memberId, m]));
  const entries = new Map(plan.entries.map((e) => [e.memberId, e]));
  const kept = run.request.members.flatMap(({ memberId, membership }): CohortMember[] => {
    const base = fixed.get(memberId);
    if (!base) return [];
    const e = entries.get(memberId);
    if (!e || at >= e.landAt) return [{ ...base, membership }];
    return [{ ...base, ...run.pending, membership, runState: at >= e.startAt ? "analyzing" : "queued", analysisSlug: null, roleFamily: null }];
  });
  const members = run.request.blind ? kept.map(blinded) : kept;
  const { claims, fitRank, decoyOf, neutralIndex } = computeCohortClaims(members, run.done.cohortId);
  const finished = at >= plan.doneAt;
  const own = finished && isFixtureSet(run);
  if (own) {
    for (const d of COHORT_DIMENSIONS) {
      const note = run.done.claims.byDimension[d].note;
      if (note) claims.byDimension[d] = { ...claims.byDimension[d], note };
    }
  }
  return {
    ...run.done,
    status: finished ? "done" : "running",
    blind: run.request.blind,
    finishedAt: finished ? run.done.finishedAt : null,
    members: members.map((m) => {
      const ni = neutralIndex.get(m.memberId) ?? 0;
      return { ...m, label: run.request.blind ? blindLabel(ni) : m.label, neutralIndex: ni, fitRank: fitRank.get(m.memberId) ?? null, decoyOf: decoyOf.get(m.memberId) ?? null };
    }),
    claims,
    narrative: own ? run.done.narrative : null,
    progress: {
      total: members.length,
      done: members.filter((m) => m.runState === "done" || m.runState === "reused").length,
      reused: members.filter((m) => m.runState === "reused").length,
      failed: members.filter((m) => m.runState === "failed").length,
    },
  };
}

/** The plan for a run: each started member's outcome read off the finished fixture. */
export function planFor(run: WalkthroughRun, opts: { reducedMotion: boolean }): SimPlan {
  const fixed = new Map(run.done.members.map((m) => [m.memberId, m]));
  const members = run.request.members.flatMap(({ memberId }) => {
    const m = fixed.get(memberId);
    return m ? [{ memberId, outcome: outcomeOf(m) }] : [];
  });
  return simSchedule(members, opts);
}
